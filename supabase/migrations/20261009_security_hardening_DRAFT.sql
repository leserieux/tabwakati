-- ⚠️ BROUILLON — NON APPLIQUÉ ET NON TESTÉ. Écrit hors ligne (outils Supabase indisponibles), à partir du catalogue de fonctions
-- du dépôt. À appliquer par étapes, chaque étape testée dans une transaction annulée. Voir docs/SECURITE_FONCTIONS.md.
--
-- Principe : Supabase accorde EXECUTE à anon/authenticated sur toute nouvelle fonction. Une fonction SECURITY DEFINER qui agit
-- au nom d'un utilisateur sans vérifier qui appelle est donc utilisable avec la clé publique de l'app.
-- Trois protections :
--   S  = service uniquement : REVOKE aux clients. Les appels internes (autres fonctions SECURITY DEFINER, pg_cron, service_role) continuent.
--   U  = fonction appelée par l'app : on garde l'accès, on ajoute assert_caller_is(p_user_id) (bloque anon et les autres utilisateurs ;
--        laisse passer le propriétaire du compte, service_role et les appels serveur sans JWT).
--   W  = webhook/jeu : service uniquement MAIS seulement après avoir vérifié que l'edge function appelante utilise la clé service_role.

-- ═══════════ Helpers (étape 0, sans effet tant qu'aucune fonction ne les appelle) ═══════════
create or replace function public.assert_caller_is(p_user uuid)
returns void language plpgsql stable set search_path = public as $$
declare v_role text := auth.role();
begin
  -- Appels serveur (SQL, pg_cron) : pas de rôle de requête ; service_role : clé secrète de vos edge functions.
  if v_role is null or v_role = '' or v_role = 'service_role' then return; end if;
  if v_role = 'authenticated' and auth.uid() is not null and p_user is not null and auth.uid() = p_user then return; end if;
  raise exception 'Accès refusé' using errcode = '42501';
end $$;

create or replace function public.assert_authenticated()
returns void language plpgsql stable set search_path = public as $$
declare v_role text := auth.role();
begin
  if v_role is null or v_role = '' or v_role in ('service_role', 'authenticated') then return; end if;
  raise exception 'Connexion requise' using errcode = '42501';
end $$;

-- ═══════════ ÉTAPE 1 — S : fonctions internes, cron et administration (risque de casse très faible) ═══════════
-- Appelées uniquement par d'autres fonctions SECURITY DEFINER, pg_cron ou le dashboard (clé service_role).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname = any (array[
         'collect_fee_to_platform','fn_treasury_debit_for_payout','fn_award_engagement_points','fn_score_credit_capacity','initialize_user_data',
         'distribute_staking_rewards','fn_accrue_loan_interest','fn_check_and_liquidate_loans','fn_check_score_loan_defaults',
         'fn_compute_wakati_daily_price','fn_liquidate_loan','refresh_admin_asset_dashboard',
         'fn_admin_reclaim_user_balance','fn_admin_set_wheel_currency','fn_admin_score_credit_status','fn_burn_tokens',
         'get_admin_reconciliation','get_asset_liabilities','get_platform_fees_totals','get_wakati_flows'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ═══════════ ÉTAPE 2 — W : webhooks de paiement et tirage de la roue ═══════════
-- NE PAS APPLIQUER avant d'avoir vérifié, dans Supabase › Edge Functions, que campay-webhook, pawapay-webhook, campay-deposit,
-- mobile-money-deposit, mobile-money-withdrawal et spin-wheel créent leur client avec SUPABASE_SERVICE_ROLE_KEY (et non la clé anon).
-- confirm_* crédite le solde d'un utilisateur à partir d'une référence et d'un montant passés en paramètre ;
-- rollback_* rembourse ; execute_wheel_spin reçoit le segment gagnant en paramètre.
/*
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname = any (array[
         'confirm_campay_deposit','confirm_mobile_money_deposit','confirm_mobile_money_withdrawal',
         'rollback_airtime_purchase','rollback_campay_withdrawal','rollback_mobile_money_withdrawal',
         'fn_confirm_withdrawal_fee','execute_wheel_spin'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
*/

-- ═══════════ ÉTAPE 3 — U : fonctions appelées par l'app au nom d'un utilisateur ═══════════
-- Injecte « perform public.assert_caller_is(<param>) » juste après le premier BEGIN du corps.
-- Test obligatoire avant application (transaction annulée) : appel en tant que anon (refusé), en tant que autre utilisateur (refusé),
-- en tant que le bon utilisateur (accepté), en tant que service_role (accepté).
/*
do $$
declare r record; def text; new text; body_pos int; idx int; guard text;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname,
           case when p.proname = 'search_user_for_p2p' then 'authenticated' else 'p_user_id' end as kind
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname = any (array[
         'execute_swap_realtime','initiate_airtime_purchase','initiate_campay_deposit','initiate_campay_withdrawal',
         'initiate_mobile_money_deposit','initiate_mobile_money_withdrawal','get_user_profile','get_user_all_addresses',
         'get_available_swap_assets','get_trading_analysis_detail','get_user_trading_analyses','get_wheel_state',
         'trading_consume_access','trading_purchase_access','handle_user_auth_flow','search_user_for_p2p'])
  loop
    def := pg_get_functiondef(r.oid);
    body_pos := strpos(def, '$function$') + length('$function$');
    idx := strpos(lower(substr(def, body_pos)), E'\nbegin');
    if idx = 0 then raise exception 'BEGIN introuvable dans %', r.sig; end if;
    guard := case when r.kind = 'authenticated' then 'perform public.assert_authenticated();' else 'perform public.assert_caller_is(p_user_id);' end;
    new := substr(def, 1, body_pos - 1 + idx + 5) || E'\n  ' || guard || substr(def, body_pos + idx + 5);
    execute new;
  end loop;
end $$;
*/
