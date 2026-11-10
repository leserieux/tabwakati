-- ════════════════════════════════════════════════════════════════════════
--  Futures — chiffres d'argent du dashboard (frais encaissés, PNL de trading, résultat net de la plateforme).
--  ADDITIF : nouvelles fonctions uniquement (+ admin_futures_health rendue multi-marchés).
--  Ne touche ni aux vues admin_futures_* ni aux fonctions du moteur.
--
--  Définitions (en devise du jeu, point de vue de la PLATEFORME ; + = la plateforme gagne) :
--    fees_open     frais d'ouverture, encaissés à l'ouverture (date d'ouverture)
--    fees_funding  frais périodiques, encaissés à la clôture (date de clôture)
--    fees_close    frais de fermeture, encaissés à la clôture
--    trading_pnl   perte de trading des joueurs − leurs gains, hors frais  = marge − somme versée − frais périodiques − frais de fermeture
--    net           fees_open + fees_funding + fees_close + trading_pnl     = − Σ realized_pnl des joueurs
--  Les tranches fermées partiellement sont des lignes closes (close_reason = 'partial') : comptées une fois.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.admin_futures_money_period(p_from timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with a as (
    select
      coalesce(sum(p.fees_open) filter (where p.opened_at >= f.t), 0)                                              as fo,
      coalesce(sum(p.fees_funding) filter (where p.status = 'closed' and p.closed_at >= f.t), 0)                  as ff,
      coalesce(sum(p.fees_close)   filter (where p.status = 'closed' and p.closed_at >= f.t), 0)                  as fc,
      coalesce(sum(p.margin - p.payout - p.fees_funding - p.fees_close) filter (where p.status = 'closed' and p.closed_at >= f.t), 0) as tp,
      count(*) filter (where p.status = 'closed' and p.closed_at >= f.t)                                          as trades,
      count(*) filter (where p.status = 'closed' and p.close_reason = 'liquidation' and p.closed_at >= f.t)       as liqs,
      coalesce(sum(p.notional) filter (where p.status = 'closed' and p.closed_at >= f.t), 0)                      as vol
    from public.futures_positions p
    cross join (select coalesce(p_from, '-infinity'::timestamptz) as t) f
  )
  select jsonb_build_object(
    'fees_open', fo, 'fees_funding', ff, 'fees_close', fc,
    'fees_total', fo + ff + fc,
    'trading_pnl', tp,
    'net', fo + ff + fc + tp,
    'trades', trades, 'liquidations', liqs, 'volume', vol
  ) from a
$$;

create or replace function public.admin_futures_money()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pending jsonb;
begin
  select jsonb_build_object(
    'open_positions', count(*),
    'margin_locked', coalesce(sum(p.margin), 0),
    'accrued_funding', coalesce(sum(p.fees_funding), 0),
    'unrealized_platform_pnl', coalesce(-sum((case when p.side = 'LONG' then 1 else -1 end) * (px.price - p.entry_price) * p.qty), 0)
  ) into v_pending
  from public.futures_positions p
  left join lateral (select lp.price from public.fn_fut_last_price(p.asset_symbol) lp) px on true
  where p.status = 'open';

  return jsonb_build_object(
    'today', public.admin_futures_money_period(date_trunc('day', now())),
    'd7',    public.admin_futures_money_period(now() - interval '7 days'),
    'd30',   public.admin_futures_money_period(now() - interval '30 days'),
    'all',   public.admin_futures_money_period(null),
    'pending', v_pending
  );
end $$;

-- Santé : la fraîcheur du prix est vérifiée sur TOUS les marchés actifs (le futures est multi-actifs)
create or replace function public.admin_futures_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_price numeric; v_age numeric; v_worst numeric; v_stale text;
  v_job_id bigint; v_active boolean; v_schedule text;
  v_last timestamptz; v_status text; v_msg text;
  v_stale_pos int; v_expected numeric; v_actual numeric;
begin
  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;

  select max(coalesce(lp.age, 9999)),
         string_agg(m.display_symbol || ' (' || coalesce(round(lp.age)::text || ' s', 'aucun prix') || ')', ', ')
           filter (where coalesce(lp.age, 9999) > 15)
    into v_worst, v_stale
    from public.futures_markets m
    left join lateral (select x.age from public.fn_fut_last_price(m.asset_symbol) x) lp on true
   where m.is_active;

  select j.jobid, j.active, j.schedule into v_job_id, v_active, v_schedule
    from cron.job j where j.jobname = 'futures-settle' limit 1;
  if v_job_id is not null then
    select d.start_time, d.status, left(coalesce(d.return_message, ''), 120)
      into v_last, v_status, v_msg
      from cron.job_run_details d where d.jobid = v_job_id order by d.start_time desc limit 1;
  end if;

  select count(*) into v_stale_pos from public.futures_positions
   where status = 'open' and last_checked_at < now() - interval '60 seconds';

  select coalesce(sum(margin + fees_open), 0) - coalesce(sum(payout) filter (where status = 'closed'), 0)
    into v_expected from public.futures_positions;
  select coalesce(sum(amount) filter (where type = 'game_bet'), 0) - coalesce(sum(amount) filter (where type = 'game_win'), 0)
    into v_actual from public.transactions
   where metadata->>'game' = 'futures' and status = 'completed';

  return jsonb_build_object(
    'price', v_price,
    'price_age_s', coalesce(v_worst, v_age),
    'stale_markets', v_stale,
    'cron_found', v_job_id is not null,
    'cron_active', coalesce(v_active, false),
    'cron_schedule', v_schedule,
    'cron_last_run', v_last,
    'cron_last_age_s', case when v_last is null then null else extract(epoch from (now() - v_last)) end,
    'cron_last_status', v_status,
    'cron_last_message', v_msg,
    'stale_open_positions', v_stale_pos,
    'ledger_expected_net', v_expected,
    'ledger_actual_net', v_actual,
    'ledger_diff', v_actual - v_expected
  );
end $$;

revoke all on function public.admin_futures_money_period(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_futures_money()                   from public, anon, authenticated;
revoke all on function public.admin_futures_health()                  from public, anon, authenticated;
grant execute on function public.admin_futures_money_period(timestamptz) to service_role;
grant execute on function public.admin_futures_money()                   to service_role;
grant execute on function public.admin_futures_health()                  to service_role;

-- Résultat par jour, mêmes définitions que admin_futures_money_period (frais d'ouverture à la date d'ouverture ;
-- frais périodiques, frais de fermeture et PNL de trading à la date de clôture). Dates en UTC.
create or replace function public.admin_futures_money_daily(p_days int default 14)
returns table (day date, fees_open numeric, fees_funding numeric, fees_close numeric, trading_pnl numeric, net numeric, trades bigint, liquidations bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select g::date as day
      from generate_series((now() at time zone 'UTC')::date - (greatest(p_days, 1) - 1), (now() at time zone 'UTC')::date, interval '1 day') g
  ),
  o as (
    select (opened_at at time zone 'UTC')::date as day, sum(fees_open) as fo
      from public.futures_positions group by 1
  ),
  c as (
    select (closed_at at time zone 'UTC')::date as day,
           sum(fees_funding) as ff, sum(fees_close) as fc,
           sum(margin - payout - fees_funding - fees_close) as tp,
           count(*) as trades, count(*) filter (where close_reason = 'liquidation') as liqs
      from public.futures_positions where status = 'closed' group by 1
  )
  select d.day,
         coalesce(o.fo, 0), coalesce(c.ff, 0), coalesce(c.fc, 0), coalesce(c.tp, 0),
         coalesce(o.fo, 0) + coalesce(c.ff, 0) + coalesce(c.fc, 0) + coalesce(c.tp, 0),
         coalesce(c.trades, 0), coalesce(c.liqs, 0)
    from days d left join o using (day) left join c using (day)
   order by d.day desc
$$;
revoke all on function public.admin_futures_money_daily(int) from public, anon, authenticated;
grant execute on function public.admin_futures_money_daily(int) to service_role;
