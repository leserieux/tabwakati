
-- Double validation (« quatre yeux ») des actions sensibles du dashboard.
create table if not exists public.admin_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  summary text not null,
  reason text not null check (length(trim(reason)) >= 5),
  payload jsonb not null default '{}'::jsonb,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','expired','executing','executed','failed')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  result text
);
create index if not exists idx_admin_approvals_status on public.admin_approvals (status, requested_at desc);
alter table public.admin_approvals enable row level security;
revoke all on public.admin_approvals from anon, authenticated;

-- Un compte nominatif, actif, super-admin (l'accès partagé historique ne compte jamais comme « une personne »).
create or replace function public.fn_admin_named_superadmin(p_username text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.admin_users where username = lower(trim(coalesce(p_username,''))) and is_active and role = 'super_admin')
$$;
revoke all on function public.fn_admin_named_superadmin(text) from public, anon, authenticated;
grant execute on function public.fn_admin_named_superadmin(text) to service_role;

create or replace function public.fn_admin_expire_approvals()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update public.admin_approvals set status = 'expired' where status = 'pending' and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.fn_admin_expire_approvals() from public, anon, authenticated;
grant execute on function public.fn_admin_expire_approvals() to service_role;
select cron.schedule('admin-approvals-expire', '*/15 * * * *', 'select public.fn_admin_expire_approvals()');

create or replace function public.fn_admin_request_approval(p_type text, p_summary text, p_reason text, p_payload jsonb, p_requested_by text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_dup uuid; v_req text := lower(trim(coalesce(p_requested_by,'')));
begin
  if length(coalesce(trim(p_reason),'')) < 5 then
    return jsonb_build_object('success', false, 'error', 'Motif obligatoire (5 caractères min.)');
  end if;
  if not public.fn_admin_named_superadmin(v_req) then
    return jsonb_build_object('success', false, 'error', 'La double validation exige un compte nominatif super-admin (pas l''accès partagé).');
  end if;
  perform public.fn_admin_expire_approvals();
  select id into v_dup from public.admin_approvals
   where status = 'pending' and action_type = p_type and requested_by = v_req and payload = coalesce(p_payload,'{}'::jsonb) limit 1;
  if v_dup is not null then
    return jsonb_build_object('success', true, 'id', v_dup, 'duplicate', true);
  end if;
  insert into public.admin_approvals(action_type, summary, reason, payload, requested_by)
  values (p_type, p_summary, trim(p_reason), coalesce(p_payload,'{}'::jsonb), v_req) returning id into v_id;
  insert into public.admin_audit_log(actor, action, summary, target, changes, status)
  values (v_req, 'approvals.request', 'Validation demandée : '||p_summary, v_id::text,
          jsonb_build_array(jsonb_build_object('type', p_type, 'reason', trim(p_reason))), 'success');
  return jsonb_build_object('success', true, 'id', v_id);
end $$;

create or replace function public.fn_admin_decide_approval(p_id uuid, p_decision text, p_note text, p_actor text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record; v_actor text := lower(trim(coalesce(p_actor,''))); v_new text;
begin
  select * into a from public.admin_approvals where id = p_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Demande introuvable'); end if;
  if p_decision not in ('approve','reject') then return jsonb_build_object('success', false, 'error', 'Décision invalide'); end if;
  if a.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'Demande déjà traitée ('||a.status||')'); end if;
  if a.expires_at < now() then
    update public.admin_approvals set status = 'expired' where id = p_id;
    return jsonb_build_object('success', false, 'error', 'Demande expirée (24 h) : à refaire');
  end if;
  if not public.fn_admin_named_superadmin(v_actor) then
    return jsonb_build_object('success', false, 'error', 'Seul un compte nominatif super-admin peut valider');
  end if;
  if v_actor = a.requested_by then
    return jsonb_build_object('success', false, 'error', 'Tu ne peux pas valider ta propre demande : il faut une seconde personne');
  end if;
  if p_decision = 'reject' and length(coalesce(trim(p_note),'')) < 5 then
    return jsonb_build_object('success', false, 'error', 'Motif de refus obligatoire (5 caractères min.)');
  end if;
  v_new := case p_decision when 'approve' then 'approved' else 'rejected' end;
  update public.admin_approvals set status = v_new, decided_by = v_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note,'')),'') where id = p_id;
  insert into public.admin_audit_log(actor, action, summary, target, changes, status)
  values (v_actor, 'approvals.'||p_decision, 'Validation '||(case when p_decision='approve' then 'accordée' else 'refusée' end)||' : '||a.summary, p_id::text,
          jsonb_build_array(jsonb_build_object('type', a.action_type, 'requested_by', a.requested_by, 'note', p_note)), 'success');
  return jsonb_build_object('success', true, 'status', v_new);
end $$;

-- Prise en charge unique : une demande validée ne peut être exécutée qu'une fois, par celui qui l'a validée.
create or replace function public.fn_admin_claim_approval(p_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  update public.admin_approvals set status = 'executing'
   where id = p_id and status = 'approved' and decided_by = lower(trim(coalesce(p_actor,'')))
   returning * into a;
  if not found then return jsonb_build_object('success', false, 'error', 'Demande non exécutable (déjà exécutée, ou pas validée par toi)'); end if;
  return jsonb_build_object('success', true, 'approval', jsonb_build_object('id', a.id, 'action_type', a.action_type, 'reason', a.reason, 'payload', a.payload, 'requested_by', a.requested_by, 'summary', a.summary));
end $$;

create or replace function public.fn_admin_finish_approval(p_id uuid, p_ok boolean, p_result text, p_actor text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record;
begin
  update public.admin_approvals set status = case when p_ok then 'executed' else 'failed' end, executed_at = now(), result = left(coalesce(p_result,''), 500)
   where id = p_id and status = 'executing' returning * into a;
  if not found then return jsonb_build_object('success', false, 'error', 'Demande pas en cours d''exécution'); end if;
  insert into public.admin_audit_log(actor, action, summary, target, changes, status, error_message)
  values (lower(trim(p_actor)), case when p_ok then 'approvals.executed' else 'approvals.failed' end,
          (case when p_ok then 'Action exécutée : ' else 'Échec de l''action : ' end)||a.summary, p_id::text,
          jsonb_build_array(jsonb_build_object('type', a.action_type, 'requested_by', a.requested_by, 'approved_by', a.decided_by, 'reason', a.reason, 'result', left(coalesce(p_result,''),300))),
          case when p_ok then 'success' else 'error' end, case when p_ok then null else left(coalesce(p_result,''),300) end);
  return jsonb_build_object('success', true);
end $$;

create or replace function public.fn_admin_cancel_approval(p_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record; v_actor text := lower(trim(coalesce(p_actor,'')));
begin
  update public.admin_approvals set status = 'cancelled', decided_by = v_actor, decided_at = now()
   where id = p_id and status = 'pending' and requested_by = v_actor returning * into a;
  if not found then return jsonb_build_object('success', false, 'error', 'Seul le demandeur peut annuler une demande en attente'); end if;
  insert into public.admin_audit_log(actor, action, summary, target, status) values (v_actor, 'approvals.cancel', 'Demande annulée : '||a.summary, p_id::text, 'success');
  return jsonb_build_object('success', true);
end $$;

revoke all on function public.fn_admin_request_approval(text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.fn_admin_decide_approval(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.fn_admin_claim_approval(uuid,text) from public, anon, authenticated;
revoke all on function public.fn_admin_finish_approval(uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.fn_admin_cancel_approval(uuid,text) from public, anon, authenticated;
grant execute on function public.fn_admin_request_approval(text,text,text,jsonb,text) to service_role;
grant execute on function public.fn_admin_decide_approval(uuid,text,text,text) to service_role;
grant execute on function public.fn_admin_claim_approval(uuid,text) to service_role;
grant execute on function public.fn_admin_finish_approval(uuid,boolean,text,text) to service_role;
grant execute on function public.fn_admin_cancel_approval(uuid,text) to service_role;
