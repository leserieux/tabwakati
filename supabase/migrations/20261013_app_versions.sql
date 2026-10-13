-- Contrôle de version de l'application mobile (APK distribué hors Play Store).
-- L'app lit cette table au démarrage ; seul le dashboard (service_role) peut la modifier.
create table if not exists public.app_versions (
  platform     text primary key check (platform in ('android')),
  latest_build integer not null check (latest_build > 0),     -- dernière version publiée (le nombre après le + dans pubspec.yaml)
  min_build    integer not null check (min_build > 0),        -- en dessous : mise à jour obligatoire
  latest_name  text,                                          -- ex. '1.0.3'
  apk_url      text not null check (apk_url ~* '^https://'),
  apk_sha256   text check (apk_sha256 is null or apk_sha256 ~ '^[0-9a-f]{64}$'),
  notes        text,
  updated_at   timestamptz not null default now(),
  constraint app_versions_min_le_latest check (min_build <= latest_build)
);

alter table public.app_versions enable row level security;

drop policy if exists "app_versions_lecture_publique" on public.app_versions;
create policy "app_versions_lecture_publique" on public.app_versions
  for select to anon, authenticated using (true);

-- Aucune écriture possible depuis l'app (RLS la bloque déjà ; on retire aussi les droits par sécurité).
revoke insert, update, delete, truncate on public.app_versions from anon, authenticated;
