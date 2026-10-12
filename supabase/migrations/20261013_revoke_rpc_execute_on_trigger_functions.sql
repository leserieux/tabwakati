-- Appliquée en base le 2026-10-13 (projet jbzbwyuawejdhhutkmkk).
-- Fonctions de déclencheur : elles ne doivent pas être appelables à distance via /rest/v1/rpc.
-- (Le droit EXECUTE n'est vérifié qu'à la création du trigger, pas à chaque déclenchement : aucun impact sur le fonctionnement.)
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_confirmed() from public, anon, authenticated;
revoke execute on function public.fn_score_loan_debt_recovery_trigger() from public, anon, authenticated;
revoke execute on function public.sync_new_asset_to_all_users() from public, anon, authenticated;
