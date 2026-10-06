-- Page Marchés : dernier relevé par actif + agrégat quotidien sur N jours.
-- asset_prices_history compte ~300 000 lignes (relevé toutes les ~5 min) : on ajoute un index
-- composite pour que "dernier relevé par actif" et les filtres par période restent instantanés.
create index if not exists idx_aph_symbol_recorded_at
  on public.asset_prices_history (asset_symbol, recorded_at desc);

create or replace view public.admin_market_latest
with (security_invoker = true) as
select distinct on (h.asset_symbol)
  h.asset_symbol,
  h.recorded_at,
  h.price_usd,
  h.price_high_24h,
  h.price_low_24h,
  h.change_24h_pct,
  h.volume_24h_usd,
  h.market_cap_usd,
  h.market_cap_rank,
  h.circulating_supply,
  h.source
from public.asset_prices_history h
order by h.asset_symbol, h.recorded_at desc;

comment on view public.admin_market_latest is 'Dernier relevé de prix connu par actif (volume 24h, plus haut/bas 24h, capitalisation, rang). Admin uniquement.';

-- Agrégat quotidien (ouverture, clôture, plus haut/bas observés, moyenne) sur les N derniers jours.
-- Min/max = extrêmes des relevés échantillonnés (~5 min), pas les extrêmes exacts du marché.
create or replace function public.admin_market_daily(p_days integer default 30)
returns table (
  asset_symbol text,
  day date,
  open_usd numeric,
  close_usd numeric,
  high_usd numeric,
  low_usd numeric,
  avg_usd numeric,
  samples bigint
)
language sql
stable
as $$
  select
    h.asset_symbol,
    (h.recorded_at at time zone 'UTC')::date as day,
    (array_agg(h.price_usd order by h.recorded_at asc))[1] as open_usd,
    (array_agg(h.price_usd order by h.recorded_at desc))[1] as close_usd,
    max(h.price_usd) as high_usd,
    min(h.price_usd) as low_usd,
    round(avg(h.price_usd), 8) as avg_usd,
    count(*) as samples
  from public.asset_prices_history h
  where h.recorded_at >= now() - make_interval(days => greatest(p_days, 1))
    and h.price_usd > 0
  group by h.asset_symbol, (h.recorded_at at time zone 'UTC')::date
  order by h.asset_symbol, day;
$$;

comment on function public.admin_market_daily(integer) is 'Agrégat quotidien des prix (ouverture/clôture/plus haut/plus bas/moyenne) sur les N derniers jours. Admin uniquement.';

-- Réservé au dashboard (service_role) : aucun accès public.
revoke all on public.admin_market_latest from public, anon, authenticated;
revoke execute on function public.admin_market_daily(integer) from public, anon, authenticated;
