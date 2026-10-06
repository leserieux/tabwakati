-- Journal d'audit des actions effectuées depuis le dashboard admin Wakati.
-- Une ligne = une tentative d'action (réussie ou en échec), jamais modifiée après coup.
-- Accès en lecture/écriture uniquement via la clé service_role (RLS activé, aucune policy).

create table if not exists admin_audit_log (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  actor        text not null,               -- nom saisi à la connexion (ex: "Yannick")
  action       text not null,               -- code stable, ex: "settings.staking.update"
  summary      text not null,               -- libellé lisible, ex: "Staking"
  target       text,                        -- identifiant de la ressource touchée, ex: "staking_config#1"
  changes      jsonb,                       -- [{ "field": "apr", "before": 12, "after": 15 }, ...]
  status       text not null default 'success' check (status in ('success', 'error')),
  error_message text,
  ip           text,
  user_agent   text
);

comment on table admin_audit_log is 'Journal d''audit des actions admin (dashboard interne Wakati).';

create index if not exists admin_audit_log_created_at_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx on admin_audit_log (actor);
create index if not exists admin_audit_log_action_idx on admin_audit_log (action);

alter table admin_audit_log enable row level security;
-- Aucune policy : seule la clé service_role (utilisée côté serveur par le dashboard) peut lire/écrire,
-- car elle ignore RLS. Personne d'autre n'a accès à cette table, y compris via l'API publique.
