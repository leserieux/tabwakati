
-- Frais plateforme agrégés par actif, type et mois (UTC), avec les fenêtres 30 j / 7 j / aujourd'hui calculées autour de p_now.
-- Remplace la lecture de TOUTES les lignes de platform_fees par le dashboard (plafonnée à 200 000 lignes, troncature silencieuse).
-- Les règles métier (types exclus, valorisation en USD) restent dans le code : cette fonction ne fait que regrouper.
create or replace function public.admin_fees_aggregate(p_now timestamptz default now())
returns table(asset_symbol text, fee_type text, month text, cnt bigint, amount_sum numeric, amount_30d numeric, amount_7d numeric, amount_today numeric, has_positive boolean)
language sql stable security definer set search_path to 'public' as $$
  select f.asset_symbol, f.fee_type,
         to_char(f.collected_at at time zone 'UTC', 'YYYY-MM') as month,
         count(*) as cnt,
         coalesce(sum(f.amount), 0) as amount_sum,
         coalesce(sum(f.amount) filter (where f.collected_at >= p_now - interval '30 days'), 0) as amount_30d,
         coalesce(sum(f.amount) filter (where f.collected_at >= p_now - interval '7 days'), 0) as amount_7d,
         coalesce(sum(f.amount) filter (where (f.collected_at at time zone 'UTC')::date = (p_now at time zone 'UTC')::date), 0) as amount_today,
         coalesce(bool_or(f.amount > 0), false) as has_positive
  from public.platform_fees f
  where f.is_test = false
  group by f.asset_symbol, f.fee_type, to_char(f.collected_at at time zone 'UTC', 'YYYY-MM')
$$;
revoke all on function public.admin_fees_aggregate(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_fees_aggregate(timestamptz) to service_role;
