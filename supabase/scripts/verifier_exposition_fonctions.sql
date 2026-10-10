-- LECTURE SEULE. À coller dans l'éditeur SQL de Supabase.
-- Montre, pour chaque fonction sensible, si un utilisateur NON connecté (anon) ou n'importe quel inscrit (authenticated)
-- peut l'exécuter avec la clé publique de l'app.
select p.proname as fonction,
       pg_get_function_identity_arguments(p.oid) as parametres,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_peut_executer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as inscrit_peut_executer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'confirm_campay_deposit','confirm_mobile_money_deposit','confirm_mobile_money_withdrawal',
    'rollback_airtime_purchase','rollback_campay_withdrawal','rollback_mobile_money_withdrawal',
    'execute_wheel_spin','execute_swap_realtime','fn_burn_tokens','fn_treasury_debit_for_payout','collect_fee_to_platform',
    'fn_admin_reclaim_user_balance','fn_admin_set_wheel_currency','fn_compute_wakati_daily_price','distribute_staking_rewards',
    'initiate_mobile_money_withdrawal','initiate_campay_withdrawal','initiate_airtime_purchase')
order by anon_peut_executer desc, fonction;
