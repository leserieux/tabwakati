-- Appliquée en base le 2026-10-13 (projet jbzbwyuawejdhhutkmkk).
-- Le burn WAKATI est 100 % comptable (in-app) : plus de statut « pending_onchain ».
-- On retire uniquement l'UPDATE qui mettait la ligne en attente d'envoi on-chain ; le statut par défaut ('completed') s'applique.
do $$
declare
  d text;
  old_stmt constant text := E'    update token_burns set status = ''pending_onchain'' where id = v_burn_id;';
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_run_burn' and p.prokind = 'f';

  if position(old_stmt in d) = 0 then
    raise exception 'fn_run_burn : instruction attendue introuvable, aucune modification';
  end if;

  d := replace(d, old_stmt, E'    -- burn comptable uniquement (in-app) : statut par défaut ''completed''');
  execute d;
end $$;

-- Anciennes lignes éventuelles : elles deviennent des burns normaux.
update public.token_burns set status = 'completed' where status = 'pending_onchain';
