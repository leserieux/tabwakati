
-- ============ 1) Sessions admin révocables ============
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  admin_user_id uuid,
  role text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);
create index if not exists idx_admin_sessions_actor_active on public.admin_sessions (actor) where revoked_at is null;
create index if not exists idx_admin_sessions_expires on public.admin_sessions (expires_at);
alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from anon, authenticated;

select cron.schedule('admin-sessions-cleanup', '17 3 * * *',
  $c$delete from public.admin_sessions where expires_at < now() - interval '30 days'$c$);

-- ============ 2) Limitation des tentatives de connexion par IP ============
create index if not exists admin_audit_log_login_fail_ip_idx
  on public.admin_audit_log (ip, created_at desc) where action = 'auth.login_failed';

-- ============ 3) Permissions : exports (finance et risque seulement) ============
insert into public.admin_role_permissions(role, permission) values
  ('finance','exports.run'), ('risk','exports.run')
on conflict do nothing;

-- ============ 4) Journal d'audit : chaînage par empreinte SHA-256 ============
alter table public.admin_audit_log add column if not exists prev_hash text;
alter table public.admin_audit_log add column if not exists row_hash text;

create or replace function public.fn_audit_row_hash(p_prev text, r public.admin_audit_log)
returns text language sql stable set search_path to 'public' as $$
  select encode(sha256(convert_to(
    coalesce(p_prev,'GENESIS') || '|' || r.id::text
    || '|' || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    || '|' || coalesce(r.actor,'') || '|' || coalesce(r.action,'') || '|' || coalesce(r.summary,'')
    || '|' || coalesce(r.target,'') || '|' || coalesce(r.status,'') || '|' || coalesce(r.changes::text,'')
    || '|' || coalesce(r.error_message,'') || '|' || coalesce(r.ip,''),
    'utf8')), 'hex')
$$;

-- Aucune écriture ne doit s'intercaler entre la reprise de l'historique et l'activation du déclencheur.
lock table public.admin_audit_log in exclusive mode;

-- Reprise de l'historique : on ne modifie que les deux colonnes d'empreinte (le contenu des lignes ne change pas).
alter table public.admin_audit_log disable trigger trg_audit_log_immutable;
do $$
declare r public.admin_audit_log; v_prev text := null; v_hash text;
begin
  for r in select * from public.admin_audit_log order by id loop
    r.prev_hash := v_prev;
    v_hash := public.fn_audit_row_hash(v_prev, r);
    update public.admin_audit_log set prev_hash = v_prev, row_hash = v_hash where id = r.id;
    v_prev := v_hash;
  end loop;
end $$;
alter table public.admin_audit_log enable trigger trg_audit_log_immutable;

create or replace function public.trg_audit_log_chain()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_prev text;
begin
  perform pg_advisory_xact_lock(hashtextextended('admin_audit_log_chain', 0));
  select row_hash into v_prev from public.admin_audit_log where row_hash is not null order by id desc limit 1;
  new.prev_hash := v_prev;
  new.row_hash := public.fn_audit_row_hash(v_prev, new);
  return new;
end $$;
revoke all on function public.trg_audit_log_chain() from public, anon, authenticated;

drop trigger if exists trg_audit_log_chain on public.admin_audit_log;
create trigger trg_audit_log_chain before insert on public.admin_audit_log
  for each row execute function public.trg_audit_log_chain();

create or replace function public.fn_admin_audit_verify()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.admin_audit_log; v_prev text := null; n bigint := 0; v_bad bigint; v_unchained bigint := 0;
begin
  for r in select * from public.admin_audit_log order by id loop
    if r.row_hash is null then v_unchained := v_unchained + 1; continue; end if;
    if r.prev_hash is distinct from v_prev or r.row_hash <> public.fn_audit_row_hash(r.prev_hash, r) then
      v_bad := r.id; exit;
    end if;
    v_prev := r.row_hash; n := n + 1;
  end loop;
  return jsonb_build_object('ok', v_bad is null and v_unchained = 0, 'checked', n, 'unchained', v_unchained, 'first_broken_id', v_bad, 'checked_at', now());
end $$;
revoke all on function public.fn_admin_audit_verify() from public, anon, authenticated;
grant execute on function public.fn_admin_audit_verify() to service_role;

-- Alerte si la chaîne est rompue (contrôle horaire, séparé du générateur principal d'alertes).
create or replace function public.fn_admin_check_audit_chain()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  v := public.fn_admin_audit_verify();
  perform public.fn_admin_sync_alerts('audit', case when (v->>'ok')::boolean then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('key','chain_broken','severity','critical',
           'title','Le journal d''audit a été altéré (chaîne d''empreintes rompue)','details', v)) end);
end $$;
revoke all on function public.fn_admin_check_audit_chain() from public, anon, authenticated;
grant execute on function public.fn_admin_check_audit_chain() to service_role;
select cron.schedule('admin-audit-chain-check', '7 * * * *', 'select public.fn_admin_check_audit_chain()');
