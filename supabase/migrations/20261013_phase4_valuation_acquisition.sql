-- Phase 4 : valorisation au prix du jour (coût historique) et coût d'acquisition.
-- Lecture seule, service_role uniquement.

-- Prix moyen par jour et par actif, tiré de asset_prices_history.
-- Renvoyé en un seul jsonb { "BTC": { "2026-03-06": 65000.1, ... }, ... } pour éviter la limite de 1000 lignes de l'API.
create or replace function public.admin_daily_prices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(asset_symbol, days), '{}'::jsonb)
  from (
    select asset_symbol, jsonb_object_agg(d, p) as days
    from (
      select asset_symbol, (recorded_at at time zone 'UTC')::date::text as d, round(avg(price_usd), 10) as p
      from public.asset_prices_history
      where price_usd > 0
      group by asset_symbol, (recorded_at at time zone 'UTC')::date
    ) x
    group by asset_symbol
  ) y
$$;

-- Valeur de chaque utilisateur : activé ou non, revenu généré (frais réels, cours actuel, mêmes règles que lib/fees.ts).
create or replace function public.admin_user_value()
returns jsonb language sql stable security definer set search_path = public as $$
  with rev as (
    select pf.source_user_id as user_id, sum(pf.amount * pr.price_usd) as usd
    from public.platform_fees pf
    join public.asset_prices_resolved pr on pr.asset_symbol = pf.asset_symbol and pr.price_usd > 0
    where pf.is_test = false and pf.fee_type not in ('game_net_loss', 'game_house_edge') and pf.source_user_id is not null
    group by pf.source_user_id
  ),
  act as (
    select t.user_id, min(t.created_at) as first_at
    from public.transactions t
    where t.status = 'completed' and t.type = any (public.admin_activity_types())
    group by t.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', u.id,
    'activated', a.user_id is not null,
    'first_activity', a.first_at,
    'revenue_usd', round(coalesce(r.usd, 0), 6)
  )), '[]'::jsonb)
  from public.users u
  left join rev r on r.user_id = u.id
  left join act a on a.user_id = u.id
$$;

do $$
declare fn text;
begin
  foreach fn in array array['admin_daily_prices()', 'admin_user_value()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
