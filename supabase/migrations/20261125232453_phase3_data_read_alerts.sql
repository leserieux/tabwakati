
-- Alertes « lecture de données » : une page qui lit trop de lignes en mémoire (ou en perd) ne doit jamais le faire en silence.
-- Appelée par le dashboard (core/db/data.ts) quand une lecture est tronquée ou très volumineuse.
create or replace function public.fn_admin_note_data_alert(p_key text, p_severity text, p_title text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_severity not in ('low','medium','high','critical') then p_severity := 'medium'; end if;
  insert into public.admin_alerts(category, severity, title, details, dedup_key)
  values ('data', p_severity, left(p_title, 300), coalesce(p_details,'{}'::jsonb), left(p_key, 120))
  on conflict (category, dedup_key) where status in ('open','acknowledged')
  do update set last_seen_at = now(), occurrences = public.admin_alerts.occurrences + 1,
                details = excluded.details, severity = excluded.severity, title = excluded.title;
end $$;
revoke all on function public.fn_admin_note_data_alert(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.fn_admin_note_data_alert(text,text,text,jsonb) to service_role;

-- Ces alertes se ferment d'elles-mêmes quand la lecture n'est plus signalée depuis 24 h.
create or replace function public.fn_admin_resolve_stale_data_alerts()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update public.admin_alerts set status = 'resolved', resolved_at = now(), resolved_by = 'system', resolution_note = 'Plus signalée depuis 24 h'
   where category = 'data' and status in ('open','acknowledged') and last_seen_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fn_admin_resolve_stale_data_alerts() from public, anon, authenticated;
grant execute on function public.fn_admin_resolve_stale_data_alerts() to service_role;
select cron.schedule('admin-data-alerts-resolve', '23 * * * *', 'select public.fn_admin_resolve_stale_data_alerts()');
