
-- p_futures_asset devient facultatif : la base lit la monnaie des futures dans futures_config (comme le faisait le code), WAKATI par défaut.
create or replace function public.admin_pnl_aggregate(p_cuts timestamptz[], p_horizon timestamptz, p_futures_asset text default null, p_excluded_fee_types text[] default array['game_house_edge','game_net_loss','futures_settlement'])
returns table(cat text, asset_symbol text, day date, seg integer, cnt bigint, amount_sum numeric)
language sql stable security definer set search_path to 'public' as $$
  with fut as (
    select coalesce(p_futures_asset, (select nullif(currency_symbol,'') from public.futures_config where id = 1), 'WAKATI')::text as asset
  ), ev as (
    select case t.type when 'game_bet' then 'game_bets' when 'game_win' then 'game_wins' when 'staking_reward' then 'staking'
                       when 'referral_bonus' then 'referral' else 'defaults' end as cat,
           t.asset_symbol::text as asset_symbol, t.created_at as ts, t.amount::numeric as amount
    from public.transactions t
    where t.status = 'completed'
      and t.type in ('game_bet','game_win','staking_reward','referral_bonus','score_loan_defaulted')
      and t.created_at >= p_horizon
      and (t.metadata->>'game') is distinct from 'futures'
    union all
    select 'fees', f.asset_symbol::text, f.collected_at, f.amount::numeric
    from public.platform_fees f
    where f.is_test = false and not (f.fee_type = any(p_excluded_fee_types)) and f.collected_at >= p_horizon
    union all
    select case when h.house > 0 then 'game_bets' else 'game_wins' end, (select asset from fut), h.closed_at, abs(h.house)
    from (select closed_at, margin - coalesce(payout,0) - coalesce(fees_funding,0) - coalesce(fees_close,0) as house
          from public.futures_positions where status = 'closed' and closed_at >= p_horizon) h
  ), seg as (
    select ev.cat, ev.asset_symbol, ev.ts, ev.amount, (select count(*) from unnest(p_cuts) c where ev.ts >= c)::int as seg
    from ev where ev.amount > 0
  )
  select s.cat, s.asset_symbol, (s.ts at time zone 'UTC')::date as day, s.seg, count(*) as cnt, sum(s.amount) as amount_sum
  from seg s
  group by s.cat, s.asset_symbol, (s.ts at time zone 'UTC')::date, s.seg
$$;
