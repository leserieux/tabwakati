-- Appliquée sur le projet Supabase (wakatiapp) le 2026-10-05.
-- Tâches mortes (fonctions supprimées, dernier succès 2026-04-18, ~56 échecs/jour au total). Pour les recréer :
--   select cron.schedule('update-rewards',      '0 * * * *',   'SELECT update_all_rewards();');
--   select cron.schedule('disable-pools',       '5 * * * *',   'SELECT auto_disable_expired_pools();');
--   select cron.schedule('manage-launchpools',  '0 */6 * * *', 'SELECT * FROM manage_launchpool_lifecycle();');
--   select cron.schedule('monitor-launchpools', '30 */6 * * *','SELECT * FROM monitor_limited_rewards_distribution();');
select cron.unschedule(12);
select cron.unschedule(14);
select cron.unschedule(19);
select cron.unschedule(20);

revoke all on table public.admin_audit_log from anon, authenticated;
revoke all on table public.admin_dashboard_snapshots from anon, authenticated;
revoke all on table public.admin_tasks from anon, authenticated;

-- La vue matérialisée admin_asset_dashboard était lisible par anon/authenticated (pas de RLS sur les vues matérialisées).
revoke all on table public.admin_asset_dashboard from public, anon, authenticated;
grant select on table public.admin_asset_dashboard to service_role;
