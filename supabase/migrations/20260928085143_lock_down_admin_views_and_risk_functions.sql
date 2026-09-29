-- Sécurité : ces vues et fonctions sont réservées au dashboard admin (service_role).
-- Par défaut, Supabase accorde SELECT/EXECUTE à anon et authenticated sur tout objet créé
-- dans le schéma public, et une vue s'exécute avec les droits de son propriétaire (elle
-- contourne donc la RLS des tables sous-jacentes). Résultat : lisibles avec la clé publique.
-- On aligne sur la convention des vues admin d'origine : aucun accès anon/authenticated.
--
-- Vérifié sur les logs (edge_logs, 4 jours de rétention disponibles au moment du fix) :
-- aucun accès anon/authenticated n'a eu lieu sur ces objets, seul service_role les a lus.

alter view public.admin_active_loans_risk set (security_invoker = true);
alter view public.admin_score_loans_risk set (security_invoker = true);
alter view public.admin_credit_summary set (security_invoker = true);
alter view public.admin_wheel_summary set (security_invoker = true);
alter view public.admin_wheel_daily set (security_invoker = true);
alter view public.admin_wheel_segment_stats set (security_invoker = true);
alter view public.admin_prediction_summary set (security_invoker = true);
alter view public.admin_prediction_daily set (security_invoker = true);
alter view public.admin_prediction_asset_stats set (security_invoker = true);
alter view public.user_risk_scores_current set (security_invoker = true);

revoke all on public.admin_active_loans_risk from public, anon, authenticated;
revoke all on public.admin_score_loans_risk from public, anon, authenticated;
revoke all on public.admin_credit_summary from public, anon, authenticated;
revoke all on public.admin_wheel_summary from public, anon, authenticated;
revoke all on public.admin_wheel_daily from public, anon, authenticated;
revoke all on public.admin_wheel_segment_stats from public, anon, authenticated;
revoke all on public.admin_prediction_summary from public, anon, authenticated;
revoke all on public.admin_prediction_daily from public, anon, authenticated;
revoke all on public.admin_prediction_asset_stats from public, anon, authenticated;
revoke all on public.user_risk_scores_current from public, anon, authenticated;

revoke execute on function public.compute_user_performance_daily(date) from public, anon, authenticated;
revoke execute on function public.compute_user_risk_scores() from public, anon, authenticated;
revoke execute on function public.reject_risk_score_history_mutation() from public, anon, authenticated;
