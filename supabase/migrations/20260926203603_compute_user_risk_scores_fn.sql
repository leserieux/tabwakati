-- Moteur de scoring de risque : règles simples et documentées (pas de modèle statistique/ML,
-- conformément à la recommandation de ne pas prétendre à une précision qu'on n'a pas).
-- 5 composantes 0-100, score global = moyenne simple, non pondérée (v1, ajustable plus tard).
--
-- Limitation connue : aucun utilisateur n'a de dossier user_kyc à ce jour → kyc_score sera
-- constant (60) pour tout le monde tant que le KYC n'est pas utilisé. Documenté, pas caché.
create or replace function public.compute_user_risk_scores()
returns integer
language plpgsql
as $$
declare
  r record;
  v_kyc_score numeric;
  v_txn_score numeric;
  v_withdrawal_score numeric;
  v_loan_score numeric;
  v_behavior_score numeric;
  v_overall numeric;
  v_level text;
  v_reasons jsonb;
  v_rapid_count integer;
  v_rapid_tx_ids uuid[];
  v_count integer := 0;
begin
  for r in select id as user_id from public.users loop
    v_reasons := '[]'::jsonb;

    -- 1) KYC : 0 vérifié / 40 en attente / 90 rejeté / 60 aucun dossier
    select case
      when k.verification_status = 'verified' then 0
      when k.verification_status = 'pending' then 40
      when k.verification_status = 'rejected' then 90
      else 60
    end into v_kyc_score
    from (select 1) d
    left join public.user_kyc k on k.user_id = r.user_id;

    -- 2) Retraits : dépôt suivi d'un retrait sous 24h, sur les 30 derniers jours (35 pts/occurrence, plafond 100)
    with recent_withdrawals as (
      select t.id, t.created_at
      from public.transactions t
      where t.user_id = r.user_id and t.type = 'withdrawal' and t.status = 'completed'
        and t.created_at > now() - interval '30 days'
    ),
    rapid as (
      select rw.id as withdrawal_id, d.id as deposit_id
      from recent_withdrawals rw
      join lateral (
        select id from public.transactions d
        where d.user_id = r.user_id and d.type = 'deposit' and d.status = 'completed'
          and d.created_at <= rw.created_at
          and d.created_at >= rw.created_at - interval '24 hours'
        order by d.created_at desc limit 1
      ) d on true
    )
    select count(*), coalesce(array_agg(withdrawal_id), '{}') || coalesce(array_agg(deposit_id), '{}')
    into v_rapid_count, v_rapid_tx_ids
    from rapid;

    v_withdrawal_score := least(100, v_rapid_count * 35);
    if v_rapid_count > 0 then
      v_reasons := v_reasons || jsonb_build_object('code', 'rapid_deposit_withdrawal', 'count', v_rapid_count);

      if not exists (
        select 1 from public.user_risk_flags
        where user_id = r.user_id and flag_type = 'rapid_deposit_withdrawal' and status = 'open'
      ) then
        insert into public.user_risk_flags (user_id, flag_type, severity, title, description, source_transaction_ids, rule_version)
        values (
          r.user_id, 'rapid_deposit_withdrawal',
          case when v_rapid_count >= 3 then 'high' else 'medium' end,
          'Dépôt suivi d''un retrait rapide',
          format('%s retrait(s) effectué(s) dans les 24h suivant un dépôt, sur les 30 derniers jours.', v_rapid_count),
          v_rapid_tx_ids, 'v1'
        );
      end if;
    end if;

    -- 3) Prêts : défaut (50 pts), liquidation (50 pts), en grâce actuellement (20 pts), plafond 100
    select least(100,
      (select count(*) from public.score_loans where user_id = r.user_id and status = 'defaulted') * 50
      + (select count(*) from public.loans where user_id = r.user_id and status = 'liquidated') * 50
      + (select count(*) from public.admin_score_loans_risk where user_id = r.user_id and risk_state in ('en_grace', 'grace_expiree')) * 20
    ) into v_loan_score;

    if v_loan_score > 0 then
      v_reasons := v_reasons || jsonb_build_object('code', 'loan_risk', 'score', v_loan_score);
      if not exists (
        select 1 from public.user_risk_flags
        where user_id = r.user_id and flag_type = 'loan_risk' and status = 'open'
      ) then
        insert into public.user_risk_flags (user_id, flag_type, severity, title, description, rule_version)
        values (
          r.user_id, 'loan_risk',
          case when v_loan_score >= 50 then 'high' else 'medium' end,
          'Historique de prêt à risque',
          'Défaut, liquidation ou grâce en cours détecté sur les prêts de cet utilisateur.',
          'v1'
        );
      end if;
    end if;

    -- 4) Comportement : taux d'échec des transactions sur 30 jours (x300, plafond 100)
    select case when count(*) > 0
      then least(100, round((count(*) filter (where status = 'failed')::numeric / count(*)) * 300))
      else 0 end
    into v_behavior_score
    from public.transactions
    where user_id = r.user_id and created_at > now() - interval '30 days';

    if v_behavior_score >= 30 then
      v_reasons := v_reasons || jsonb_build_object('code', 'high_failed_transaction_rate', 'score', v_behavior_score);
      if not exists (
        select 1 from public.user_risk_flags
        where user_id = r.user_id and flag_type = 'high_failed_transaction_rate' and status = 'open'
      ) then
        insert into public.user_risk_flags (user_id, flag_type, severity, title, description, rule_version)
        values (
          r.user_id, 'high_failed_transaction_rate', 'medium',
          'Taux d''échec de transaction élevé',
          'Plus de 10% des transactions des 30 derniers jours ont échoué.',
          'v1'
        );
      end if;
    end if;

    -- 5) Volume : pic d'activité du jour vs moyenne des jours précédents (30j glissants, propre à l'utilisateur)
    with daily as (
      select date_trunc('day', created_at) as d, sum(amount) as amt
      from public.transactions
      where user_id = r.user_id and status = 'completed' and created_at > now() - interval '31 days'
      group by 1
    ),
    stats as (
      select
        coalesce((select amt from daily where d = date_trunc('day', now())), 0) as today_amt,
        coalesce(avg(amt) filter (where d < date_trunc('day', now())), 0) as avg_amt
      from daily
    )
    select case
      when avg_amt > 0 and today_amt > avg_amt * 5 then 70
      when avg_amt > 0 and today_amt > avg_amt * 3 then 40
      else 0
    end into v_txn_score
    from stats;

    v_overall := round((v_kyc_score + v_txn_score + v_withdrawal_score + v_loan_score + v_behavior_score) / 5.0);
    v_level := case
      when v_overall >= 75 then 'critical'
      when v_overall >= 55 then 'high'
      when v_overall >= 30 then 'watch'
      else 'normal'
    end;

    insert into public.user_risk_score_history (
      user_id, score, level, kyc_score, transaction_score, withdrawal_score, loan_score, behavior_score, reasons, scoring_version
    ) values (
      r.user_id, v_overall, v_level, v_kyc_score, v_txn_score, v_withdrawal_score, v_loan_score, v_behavior_score, v_reasons, 'v1'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.compute_user_risk_scores() is 'Calcule un score de risque par règles simples (KYC, retraits rapides, prêts, échecs de transaction, pics de volume) pour chaque utilisateur, insère dans user_risk_score_history et ouvre des flags dans user_risk_flags si un seuil est franchi. v1 : moyenne non pondérée des 5 composantes.';
