-- Phase 3C : cohortes, rétention, churn, LTV (valeur vie) et monétisation.
-- Lecture seule. Réservées à service_role (le dashboard) : aucun accès anon/authenticated.
--
-- Définitions (alignées sur lib/fees.ts) :
--  * « Actif » = au moins une transaction TERMINÉE initiée par l'utilisateur (dépôt, retrait, swap, jeu, staking, prêt, achat WAKATI…).
--    Les mouvements automatiques (récompenses, bonus, gains de jeu, frais, ajustements) ne comptent pas comme de l'activité.
--  * Revenu = frais réels de platform_fees : hors lignes de test, hors game_net_loss (signal de crédit) et hors game_house_edge
--    (déjà compris dans les mises du P&L). Valorisé au cours ACTUEL (asset_prices_resolved), comme la page Frais.

create or replace function public.admin_activity_types()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'deposit','withdrawal','transfer','p2p_transfer','swap_debit',
    'staking','staking_lock','stake','unstake_request','unstake','instant_unstake',
    'game_bet','wakati_purchase','buy_wakati','asset_conversion','airtime_purchase',
    'loan_collateral_lock','loan_borrowed','loan_repaid','score_loan_borrowed','score_loan_repaid'
  ]::text[]
$$;

-- ─────────────── Rétention par cohorte ───────────────
create or replace function public.admin_cohort_retention(p_granularity text default 'month', p_periods int default 12)
returns table(cohort date, cohort_size int, period_n int, active_users int, retention_pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare g text := lower(coalesce(p_granularity, 'month'));
begin
  if g not in ('week', 'month') then raise exception 'Granularité invalide : week ou month'; end if;
  p_periods := least(greatest(coalesce(p_periods, 12), 1), 60);

  return query
  with u as (
    select id as user_id, date_trunc(g, created_at)::date as cohort from public.users where created_at is not null
  ),
  sizes as (select cohort, count(*)::int as n from u group by cohort),
  act as (
    select distinct t.user_id, date_trunc(g, t.created_at)::date as period
    from public.transactions t
    where t.status = 'completed' and t.type = any (public.admin_activity_types())
  ),
  idx as (
    select u.cohort, a.user_id,
      case when g = 'month'
        then ((extract(year from a.period) * 12 + extract(month from a.period)) - (extract(year from u.cohort) * 12 + extract(month from u.cohort)))::int
        else ((a.period - u.cohort) / 7)::int end as n
    from u join act a on a.user_id = u.user_id
    where a.period >= u.cohort
  ),
  grid as (
    select s.cohort, s.n as size, gs as k
    from sizes s, generate_series(0, p_periods) gs
    where (case when g = 'month' then s.cohort + (gs * interval '1 month') else s.cohort + (gs * 7) * interval '1 day' end)::date
          <= date_trunc(g, now())::date
  ),
  cnt as (select cohort, n, count(distinct user_id)::int as c from idx group by cohort, n)
  select gr.cohort, gr.size, gr.k, coalesce(c.c, 0), round(100.0 * coalesce(c.c, 0) / gr.size, 1)
  from grid gr left join cnt c on c.cohort = gr.cohort and c.n = gr.k
  order by gr.cohort, gr.k;
end $$;

-- ─────────────── LTV par cohorte (revenu par période depuis l'inscription) ───────────────
create or replace function public.admin_cohort_ltv(p_granularity text default 'month', p_periods int default 12)
returns table(cohort date, cohort_size int, period_n int, revenue_usd numeric, payers int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare g text := lower(coalesce(p_granularity, 'month'));
begin
  if g not in ('week', 'month') then raise exception 'Granularité invalide : week ou month'; end if;
  p_periods := least(greatest(coalesce(p_periods, 12), 1), 60);

  return query
  with u as (
    select id as user_id, date_trunc(g, created_at)::date as cohort from public.users where created_at is not null
  ),
  sizes as (select cohort, count(*)::int as n from u group by cohort),
  fees as (
    select pf.source_user_id as user_id, date_trunc(g, pf.collected_at)::date as period,
           pf.amount * pr.price_usd as usd
    from public.platform_fees pf
    join public.asset_prices_resolved pr on pr.asset_symbol = pf.asset_symbol and pr.price_usd > 0
    where pf.is_test = false and pf.fee_type not in ('game_net_loss', 'game_house_edge') and pf.source_user_id is not null
  ),
  idx as (
    select u.cohort, f.user_id, f.usd,
      case when g = 'month'
        then ((extract(year from f.period) * 12 + extract(month from f.period)) - (extract(year from u.cohort) * 12 + extract(month from u.cohort)))::int
        else ((f.period - u.cohort) / 7)::int end as n
    from u join fees f on f.user_id = u.user_id
    where f.period >= u.cohort
  ),
  grid as (
    select s.cohort, s.n as size, gs as k
    from sizes s, generate_series(0, p_periods) gs
    where (case when g = 'month' then s.cohort + (gs * interval '1 month') else s.cohort + (gs * 7) * interval '1 day' end)::date
          <= date_trunc(g, now())::date
  ),
  agg as (select cohort, n, sum(usd) as rev, count(distinct user_id)::int as p from idx group by cohort, n)
  select gr.cohort, gr.size, gr.k, round(coalesce(a.rev, 0), 4), coalesce(a.p, 0)
  from grid gr left join agg a on a.cohort = gr.cohort and a.n = gr.k
  order by gr.cohort, gr.k;
end $$;

-- ─────────────── Churn mensuel ───────────────
create or replace function public.admin_monthly_churn(p_months int default 12)
returns table(month date, active_users int, new_users int, retained int, churned int, reactivated int, churn_rate_pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  p_months := least(greatest(coalesce(p_months, 12), 2), 60);
  return query
  with act as (
    select distinct t.user_id, date_trunc('month', t.created_at)::date as m
    from public.transactions t
    where t.status = 'completed' and t.type = any (public.admin_activity_types())
  ),
  first_m as (select user_id, min(m) as fm from act group by user_id),
  months as (
    select (date_trunc('month', now()) - (gs * interval '1 month'))::date as m
    from generate_series(0, p_months - 1) gs
  )
  select mo.m,
    (select count(*)::int from act a where a.m = mo.m),
    (select count(*)::int from first_m f where f.fm = mo.m),
    (select count(*)::int from act a where a.m = mo.m and exists (select 1 from act b where b.user_id = a.user_id and b.m = (mo.m - interval '1 month')::date)),
    (select count(*)::int from act a where a.m = (mo.m - interval '1 month')::date and not exists (select 1 from act b where b.user_id = a.user_id and b.m = mo.m)),
    (select count(*)::int from act a where a.m = mo.m
       and not exists (select 1 from act b where b.user_id = a.user_id and b.m = (mo.m - interval '1 month')::date)
       and exists (select 1 from first_m f where f.user_id = a.user_id and f.fm < mo.m)),
    case when (select count(*) from act a where a.m = (mo.m - interval '1 month')::date) = 0 then null
      else round(100.0 * (select count(*) from act a where a.m = (mo.m - interval '1 month')::date and not exists (select 1 from act b where b.user_id = a.user_id and b.m = mo.m))
           / (select count(*) from act a where a.m = (mo.m - interval '1 month')::date), 1) end
  from months mo
  order by mo.m;
end $$;

-- ─────────────── Churn : situation actuelle (inactivité > N jours) ───────────────
create or replace function public.admin_churn_summary(p_inactive_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_inactive_days, 30), 7), 365); r jsonb;
begin
  with last_act as (
    select t.user_id, max(t.created_at) as last_at, min(t.created_at) as first_at
    from public.transactions t
    where t.status = 'completed' and t.type = any (public.admin_activity_types())
    group by t.user_id
  ),
  x as (
    select
      count(*) as total_users,
      count(l.user_id) as activated,
      count(*) filter (where l.user_id is null) as never_activated,
      count(*) filter (where l.last_at >= now() - make_interval(days => d)) as active,
      count(*) filter (where l.last_at < now() - make_interval(days => d)) as churned,
      count(*) filter (where l.last_at < now() - make_interval(days => d) and l.last_at >= now() - make_interval(days => d * 2)) as churned_recent,
      count(*) filter (where l.last_at >= now() - make_interval(days => d) and l.last_at < now() - make_interval(days => d / 2)) as at_risk,
      count(*) filter (where u.created_at >= now() - make_interval(days => d)) as new_signups
    from public.users u left join last_act l on l.user_id = u.id
  )
  select jsonb_build_object(
    'inactive_days', d, 'total_users', total_users, 'activated', activated, 'never_activated', never_activated,
    'active', active, 'churned', churned, 'churned_recent', churned_recent, 'at_risk', at_risk, 'new_signups', new_signups,
    'activation_rate_pct', case when total_users > 0 then round(100.0 * activated / total_users, 1) end,
    'churn_rate_pct', case when activated > 0 then round(100.0 * churned / activated, 1) end
  ) into r from x;
  return r;
end $$;

-- ─────────────── Monétisation ───────────────
create or replace function public.admin_monetization_summary(p_days int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  with f as (
    select pf.source_user_id as user_id, pf.fee_type, pf.asset_symbol, pf.amount, pr.price_usd,
           (pf.amount * pr.price_usd) as usd
    from public.platform_fees pf
    left join public.asset_prices_resolved pr on pr.asset_symbol = pf.asset_symbol and pr.price_usd > 0
    where pf.is_test = false and pf.fee_type not in ('game_net_loss', 'game_house_edge')
      and (p_days is null or pf.collected_at >= now() - make_interval(days => p_days))
  ),
  per_user as (select user_id, sum(usd) as usd from f where usd is not null and user_id is not null group by user_id),
  ranked as (select usd, row_number() over (order by usd desc) as rk from per_user),
  tot as (select coalesce(sum(usd), 0) as revenue, count(*) as payers from per_user),
  users_n as (select count(*) as n from public.users),
  by_type as (
    select fee_type, sum(usd) as usd, count(distinct user_id) as payers, count(*) as ops
    from f where usd is not null group by fee_type
  )
  select jsonb_build_object(
    'days', p_days,
    'revenue_usd', round((select revenue from tot), 4),
    'total_users', (select n from users_n),
    'payers', (select payers from tot),
    'payer_rate_pct', case when (select n from users_n) > 0 then round(100.0 * (select payers from tot) / (select n from users_n), 1) end,
    'arpu_usd', case when (select n from users_n) > 0 then round((select revenue from tot) / (select n from users_n), 4) end,
    'arppu_usd', case when (select payers from tot) > 0 then round((select revenue from tot) / (select payers from tot), 4) end,
    'top1_share_pct', case when (select revenue from tot) > 0 then round(100.0 * coalesce((select sum(usd) from ranked where rk <= 1), 0) / (select revenue from tot), 1) end,
    'top5_share_pct', case when (select revenue from tot) > 0 then round(100.0 * coalesce((select sum(usd) from ranked where rk <= 5), 0) / (select revenue from tot), 1) end,
    'top10_share_pct', case when (select revenue from tot) > 0 then round(100.0 * coalesce((select sum(usd) from ranked where rk <= 10), 0) / (select revenue from tot), 1) end,
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('fee_type', fee_type, 'revenue_usd', round(usd, 4), 'payers', payers, 'ops', ops) order by usd desc) from by_type), '[]'::jsonb),
    'unpriced_assets', coalesce((select jsonb_agg(distinct asset_symbol) from f where usd is null), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- Accès : service_role uniquement.
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_activity_types()',
    'admin_cohort_retention(text,int)',
    'admin_cohort_ltv(text,int)',
    'admin_monthly_churn(int)',
    'admin_churn_summary(int)',
    'admin_monetization_summary(int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
