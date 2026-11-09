-- ════════════════════════════════════════════════════════════════════════
--  Trading futures — objets d'administration du dashboard (ADDITIFS uniquement).
--  Dépend de : 20261107203139_futures_trading_engine, puis des migrations futures_treasury_conservation,
--  futures_admin_controls et futures_round_8_decimals (déjà appliquées en production).
--
--  ⚠️ Ce fichier ne REDÉFINIT PAS : fn_fut_open, fn_fut_close_row, fn_fut_settle, admin_futures_overview,
--  admin_futures_force_close, admin_futures_close_all. Ces fonctions appartiennent aux migrations ci-dessus
--  (conservation de l'offre côté trésorerie, plafonds, arrondi à 8 décimales). Les redéfinir ici les écraserait.
--  (Une première version de ce fichier l'avait fait : corrigée en production par
--   futures_restore_functions_after_admin_overwrite.)
--
--  Tout est réservé au service_role (convention des objets admin_*).
-- ════════════════════════════════════════════════════════════════════════

alter table public.futures_config add column if not exists updated_by text;

-- ─────────────────────────────────────────────
--  3. Positions ouvertes (avec prix de marque et PNL latent)
-- ─────────────────────────────────────────────
create or replace view public.admin_futures_open_positions
with (security_invoker = true) as
select
  p.id, p.user_id, u.username, u.email,
  p.side, p.leverage, p.margin, p.notional, p.qty,
  p.entry_price, px.price as mark_price,
  (case when p.side = 'LONG' then 1 else -1 end) * (px.price - p.entry_price) * p.qty as unrealized_pnl,
  p.liq_price, p.tp_price, p.sl_price,
  case when px.price > 0 then
    case when p.side = 'LONG' then (px.price - p.liq_price) / px.price * 100
         else (p.liq_price - px.price) / px.price * 100 end
  end as liq_distance_pct,
  p.fees_open, p.fees_funding, p.fee_interval_seconds, p.fee_rate_pct,
  p.opened_at, p.last_fee_at, p.last_checked_at
from public.futures_positions p
left join public.users u on u.id = p.user_id
left join lateral (select price from public.fn_fut_last_price()) px on true
where p.status = 'open';

-- ─────────────────────────────────────────────
--  4. Résultats par jour (positions clôturées)
-- ─────────────────────────────────────────────
create or replace view public.admin_futures_daily
with (security_invoker = true) as
select
  (closed_at at time zone 'UTC')::date as day,
  count(*)                                              as trades,
  count(*) filter (where close_reason = 'liquidation')  as liquidations,
  coalesce(sum(notional), 0)                            as volume_notional,
  coalesce(sum(fees_open + fees_funding + fees_close), 0) as fees,
  coalesce(-sum(realized_pnl), 0)                       as house_result,
  count(distinct user_id)                               as traders
from public.futures_positions
where status = 'closed'
group by 1
order by 1 desc;

-- ─────────────────────────────────────────────
--  5. Traders (suivi des gagnants / abus potentiels)
-- ─────────────────────────────────────────────
create or replace view public.admin_futures_traders
with (security_invoker = true) as
select
  p.user_id, u.username, u.email,
  count(*) filter (where p.status = 'closed')                              as trades,
  count(*) filter (where p.status = 'open')                                as open_positions,
  count(*) filter (where p.status = 'closed' and p.realized_pnl > 0)       as wins,
  count(*) filter (where p.close_reason = 'liquidation')                   as liquidations,
  coalesce(sum(p.realized_pnl) filter (where p.status = 'closed'), 0)      as net_pnl,
  coalesce(sum(p.fees_open + p.fees_funding + p.fees_close), 0)            as fees_paid,
  coalesce(sum(p.notional), 0)                                             as volume_notional,
  max(p.opened_at)                                                         as last_trade_at
from public.futures_positions p
left join public.users u on u.id = p.user_id
group by p.user_id, u.username, u.email;

-- ─────────────────────────────────────────────
--  6. Statistiques d'une période (NULL = depuis toujours)
-- ─────────────────────────────────────────────
create or replace function public.admin_futures_period(p_from timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trades',         count(*),
    'traders',        count(distinct user_id),
    'wins',           count(*) filter (where realized_pnl > 0),
    'liquidations',   count(*) filter (where close_reason = 'liquidation'),
    'tp',             count(*) filter (where close_reason = 'tp'),
    'sl',             count(*) filter (where close_reason = 'sl'),
    'manual',         count(*) filter (where close_reason = 'manual'),
    'volume',         coalesce(sum(notional), 0),
    'fees_open',      coalesce(sum(fees_open), 0),
    'fees_funding',   coalesce(sum(fees_funding), 0),
    'fees_close',     coalesce(sum(fees_close), 0),
    'trader_net',     coalesce(sum(realized_pnl), 0),
    'house_result',   coalesce(-sum(realized_pnl), 0),
    'margin_lost_liq', coalesce(sum(margin) filter (where close_reason = 'liquidation'), 0)
  )
  from public.futures_positions
  where status = 'closed' and (p_from is null or closed_at >= p_from)
$$;

-- ─────────────────────────────────────────────
--  7. Résumé : exposition ouverte + périodes (renommé : admin_futures_overview appartient à futures_admin_controls)
-- ─────────────────────────────────────────────
create or replace function public.admin_futures_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.futures_config;
  v_price numeric; v_age numeric;
  v_open jsonb;
begin
  select * into c from public.futures_config where id = 1;
  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;

  select jsonb_build_object(
    'positions',      count(*),
    'traders',        count(distinct user_id),
    'margin',         coalesce(sum(margin), 0),
    'notional',       coalesce(sum(notional), 0),
    'long_notional',  coalesce(sum(notional) filter (where side = 'LONG'), 0),
    'short_notional', coalesce(sum(notional) filter (where side = 'SHORT'), 0),
    'long_count',     count(*) filter (where side = 'LONG'),
    'short_count',    count(*) filter (where side = 'SHORT'),
    'fees_funding',   coalesce(sum(fees_funding), 0),
    'fees_open',      coalesce(sum(fees_open), 0),
    'unrealized_pnl', coalesce(sum((case when side = 'LONG' then 1 else -1 end) * (v_price - entry_price) * qty), 0),
    'near_liq',       count(*) filter (where v_price > 0 and
                         (case when side = 'LONG' then (v_price - liq_price) / v_price else (liq_price - v_price) / v_price end) < 0.03),
    'worst_liq_distance_pct', min(case when v_price > 0 then
                         (case when side = 'LONG' then (v_price - liq_price) / v_price else (liq_price - v_price) / v_price end) * 100 end),
    'oldest_open_at', min(opened_at)
  ) into v_open
  from public.futures_positions where status = 'open';

  return jsonb_build_object(
    'config', to_jsonb(c),
    'price', v_price,
    'price_age_s', v_age,
    'open', v_open,
    'today', public.admin_futures_period(date_trunc('day', now())),
    'd7',    public.admin_futures_period(now() - interval '7 days'),
    'd30',   public.admin_futures_period(now() - interval '30 days'),
    'all',   public.admin_futures_period(null)
  );
end $$;

-- ─────────────────────────────────────────────
--  8. Santé du moteur (surveillance, rapprochement du ledger)
-- ─────────────────────────────────────────────
create or replace function public.admin_futures_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_price numeric; v_age numeric;
  v_job_id bigint; v_active boolean; v_schedule text;
  v_last timestamptz; v_status text; v_msg text;
  v_stale int; v_expected numeric; v_actual numeric;
begin
  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;

  select j.jobid, j.active, j.schedule into v_job_id, v_active, v_schedule
    from cron.job j where j.jobname = 'futures-settle' limit 1;
  if v_job_id is not null then
    select d.start_time, d.status, left(coalesce(d.return_message, ''), 120)
      into v_last, v_status, v_msg
      from cron.job_run_details d where d.jobid = v_job_id order by d.start_time desc limit 1;
  end if;

  select count(*) into v_stale from public.futures_positions
   where status = 'open' and last_checked_at < now() - interval '60 seconds';

  -- Rapprochement : ce que le ledger a sorti des soldes doit égaler ce qui est encore engagé
  -- (marge + frais d'ouverture des positions, moins les sommes déjà rendues).
  select coalesce(sum(margin + fees_open), 0) - coalesce(sum(payout) filter (where status = 'closed'), 0)
    into v_expected from public.futures_positions;
  select coalesce(sum(amount) filter (where type = 'game_bet'), 0) - coalesce(sum(amount) filter (where type = 'game_win'), 0)
    into v_actual from public.transactions
   where metadata->>'game' = 'futures' and status = 'completed';

  return jsonb_build_object(
    'price', v_price,
    'price_age_s', v_age,
    'cron_found', v_job_id is not null,
    'cron_active', coalesce(v_active, false),
    'cron_schedule', v_schedule,
    'cron_last_run', v_last,
    'cron_last_age_s', case when v_last is null then null else extract(epoch from (now() - v_last)) end,
    'cron_last_status', v_status,
    'cron_last_message', v_msg,
    'stale_open_positions', v_stale,
    'ledger_expected_net', v_expected,
    'ledger_actual_net', v_actual,
    'ledger_diff', v_actual - v_expected
  );
end $$;

-- ─────────────────────────────────────────────
--  10. Droits : service_role uniquement
-- ─────────────────────────────────────────────
revoke all on public.admin_futures_open_positions from public, anon, authenticated;
revoke all on public.admin_futures_daily          from public, anon, authenticated;
revoke all on public.admin_futures_traders        from public, anon, authenticated;
revoke all on function public.admin_futures_period(timestamptz)  from public, anon, authenticated;
revoke all on function public.admin_futures_summary()            from public, anon, authenticated;
revoke all on function public.admin_futures_health()             from public, anon, authenticated;
grant select on public.admin_futures_open_positions, public.admin_futures_daily, public.admin_futures_traders to service_role;
grant execute on function public.admin_futures_period(timestamptz) to service_role;
grant execute on function public.admin_futures_summary()           to service_role;
grant execute on function public.admin_futures_health()            to service_role;
