-- Déjà appliquée sur le projet Supabase (wakatiapp) le 2026-10-03.
-- 1) asset_prices_resolved : prix par symbole technique, résolu via ledger_symbol (coingecko-price écrit sous USDC, pas USDC-BSC).
create or replace view public.asset_prices_resolved as
select a.symbol as asset_symbol, coalesce(nullif(a.ledger_symbol, ''), a.symbol) as ledger_symbol, a.network, a.is_active,
       case when p.price_usd > 0 then p.price_usd end as price_usd, p.change_24h, p.market_cap, p.updated_at
from public.supported_assets a
left join public.asset_prices p on p.asset_symbol = coalesce(nullif(a.ledger_symbol, ''), a.symbol);
alter view public.asset_prices_resolved set (security_invoker = true);
revoke all on public.asset_prices_resolved from public, anon, authenticated;
grant select on public.asset_prices_resolved to service_role;

-- 2) admin_volume_daily : volume réel (dépôts, retraits, swaps, transferts, mises de jeux), transactions réussies uniquement.
create or replace function public.admin_volume_daily(p_days int default 7)
returns table(day date, category text, tx_count bigint, volume_usd numeric, unpriced_count bigint)
language sql stable set search_path = public as $$
  select (t.created_at at time zone 'utc')::date, 
         case t.type when 'deposit' then 'deposit' when 'withdrawal' then 'withdrawal' when 'swap_debit' then 'swap'
                     when 'p2p_transfer' then 'transfer' when 'transfer' then 'transfer' when 'game_bet' then 'game' end,
         count(*)::bigint, coalesce(sum(t.amount * r.price_usd), 0)::numeric, count(*) filter (where r.price_usd is null)::bigint
  from public.transactions t left join public.asset_prices_resolved r on r.asset_symbol = t.asset_symbol
  where t.status in ('completed','succeeded','success','successful')
    and t.type in ('deposit','withdrawal','swap_debit','p2p_transfer','transfer','game_bet')
    and (t.created_at at time zone 'utc')::date >= (now() at time zone 'utc')::date - (greatest(p_days,1) - 1)
  group by 1, 2
$$;
revoke execute on function public.admin_volume_daily(int) from public, anon, authenticated;
grant execute on function public.admin_volume_daily(int) to service_role;

-- 3) admin_users_overview : portefeuille = available + staking + pending, prix résolus (voir la migration appliquée pour le détail).
-- (définition complète appliquée en base ; non répétée ici pour éviter une divergence.)
