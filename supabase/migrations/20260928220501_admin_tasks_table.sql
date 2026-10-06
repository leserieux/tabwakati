-- Suivi des tâches internes (app, base de données, dashboard) + tâches auto-suggérées
-- à partir des anomalies déjà détectées ailleurs dans le dashboard (prix périmés, flags
-- de risque ouverts, adresses à balayer, etc.). Réservé au service_role, comme le reste.
create table if not exists public.admin_tasks (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text not null default '',
  category text not null default 'autre'
    check (category in ('produit', 'fiabilite', 'securite', 'donnees', 'autre')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done', 'wontfix')),

  -- 'manual' = ajoutée à la main ; 'auto' = générée depuis une suggestion détectée par le
  -- dashboard. source_key évite les doublons quand la même anomalie est encore active.
  source text not null default 'manual' check (source in ('manual', 'auto')),
  source_key text,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists admin_tasks_open_source_key_idx
  on public.admin_tasks (source_key)
  where source_key is not null and status not in ('done', 'wontfix');

create index if not exists admin_tasks_status_priority_idx
  on public.admin_tasks (status, priority, created_at desc);

create or replace function public.set_updated_at_admin_tasks()
returns trigger as $$
begin
  new.updated_at = now();
  if new.status = 'done' and old.status is distinct from 'done' and new.completed_at is null then
    new.completed_at = now();
  end if;
  if new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_admin_tasks_updated_at on public.admin_tasks;
create trigger trg_admin_tasks_updated_at
  before update on public.admin_tasks
  for each row execute function public.set_updated_at_admin_tasks();

alter table public.admin_tasks enable row level security;
revoke all on public.admin_tasks from public, anon, authenticated;

comment on table public.admin_tasks is 'Tâches internes de gestion/amélioration (app, BDD, dashboard), manuelles ou auto-suggérées depuis les anomalies déjà détectées ailleurs.';
comment on column public.admin_tasks.source_key is 'Clé stable identifiant l''anomalie source (ex: stale_price:BTC, risk_flag:<uuid>) pour éviter les doublons de suggestions tant qu''elle reste active.';
