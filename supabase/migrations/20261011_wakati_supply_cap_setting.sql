-- Plafond de l'offre WAKATI propre à l'application (affiché dans /dashboard/wakati/offre).
-- NULL = automatique (WAKATI chez les utilisateurs + trésorerie interne). Réglable dans Burns > Réglages.
-- Information de pilotage uniquement : ne crée, ne bloque et ne brûle aucun jeton.
-- À APPLIQUER AVANT de déployer ce code : la page Burns lit cette colonne.
alter table public.burn_settings
  add column if not exists supply_cap_wakati numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'burn_settings_supply_cap_chk') then
    alter table public.burn_settings
      add constraint burn_settings_supply_cap_chk check (supply_cap_wakati is null or supply_cap_wakati > 0);
  end if;
end $$;
