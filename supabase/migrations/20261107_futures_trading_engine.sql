-- ════════════════════════════════════════════════════════════════════════
--  WAKATI · TRADING FUTURES (marge isolée, long / short, levier)
--  À exécuter dans Supabase → SQL Editor.
--
--  TOUT EST CALCULÉ CÔTÉ SERVEUR : prix d'entrée, frais, liquidation, TP/SL.
--  L'app ne fait qu'afficher et envoyer des ordres.
--
--  Adapté au schéma réel du projet (vérifié) :
--   • solde   : user_balances(user_id, asset_symbol, available_balance)
--   • prix    : game_price_ticks(asset_symbol, price_usd, fetched_at), un relevé
--               toutes les ~5 s, conservé 48 h. Le moteur le lit DIRECTEMENT
--               (fn_get_prediction_price exige un utilisateur connecté : inutilisable
--               par pg_cron).
--   • ledger  : transactions, types 'game_bet' (mise + frais d'ouverture) et
--               'game_win' (somme récupérée à la fermeture), metadata.game='futures'.
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1. CONFIGURATION  (ligne unique, éditable dans ton dashboard)
-- ─────────────────────────────────────────────
create table if not exists public.futures_config (
  id                      int primary key default 1 check (id = 1),
  is_active               boolean not null default true,
  asset_symbol            text    not null default 'BTC',
  asset_name              text    not null default 'Bitcoin',
  currency_symbol         text    not null default 'WAKATI',

  -- Marge (montant engagé par position)
  margin_default          numeric not null default 100,
  margin_min              numeric not null default 10,
  margin_max              numeric not null default 10000,

  -- Levier
  leverage_default        int     not null default 10,
  leverage_min            int     not null default 1,
  leverage_max            int     not null default 50,
  leverage_presets        int[]   not null default '{2,5,10,20,50}',

  -- Frais d'ouverture / fermeture (% du notionnel = marge × levier)
  open_fee_pct            numeric not null default 0.05,
  close_fee_pct           numeric not null default 0.05,

  -- Frais périodiques : « fee_rate_pct % du notionnel toutes les fee_interval_seconds »
  fee_interval_seconds    int     not null default 3600,
  fee_rate_pct            numeric not null default 0.01,

  -- Liquidation : marge de maintenance (% du notionnel)
  maintenance_margin_pct  numeric not null default 0.5,

  max_open_positions      int     not null default 3,
  tp_sl_enabled           boolean not null default true,
  updated_at              timestamptz not null default now(),

  check (margin_min > 0 and margin_max >= margin_min),
  check (leverage_min >= 1 and leverage_max >= leverage_min),
  check (fee_interval_seconds >= 0 and fee_rate_pct >= 0),
  check (open_fee_pct >= 0 and close_fee_pct >= 0),
  check (maintenance_margin_pct >= 0)
);
insert into public.futures_config (id) values (1) on conflict (id) do nothing;

create or replace function public.trg_fut_cfg_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists fut_cfg_touch on public.futures_config;
create trigger fut_cfg_touch before update on public.futures_config
  for each row execute function public.trg_fut_cfg_touch();

-- ─────────────────────────────────────────────
--  2. POSITIONS
--  Les paramètres de frais sont FIGÉS à l'ouverture : modifier la config
--  n'affecte que les nouvelles positions.
-- ─────────────────────────────────────────────
create table if not exists public.futures_positions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  asset_symbol           text not null,
  side                   text not null check (side in ('LONG','SHORT')),
  leverage               int  not null,
  margin                 numeric not null,
  notional               numeric not null,          -- margin × leverage
  qty                    numeric not null,          -- notional / entry_price
  entry_price            numeric not null,
  mmr_pct                numeric not null,
  fee_rate_pct           numeric not null,
  fee_interval_seconds   int  not null,
  close_fee_pct          numeric not null,
  tp_price               numeric,
  sl_price               numeric,
  liq_price              numeric not null,
  fees_open              numeric not null default 0,
  fees_funding           numeric not null default 0,
  fees_close             numeric not null default 0,
  status                 text not null default 'open' check (status in ('open','closed')),
  close_reason           text check (close_reason in ('manual','tp','sl','liquidation')),
  exit_price             numeric,
  payout                 numeric,                   -- crédité au portefeuille
  realized_pnl           numeric,                   -- NET : payout − marge − frais d'ouverture
  opened_at              timestamptz not null default now(),
  last_fee_at            timestamptz not null default now(),
  last_checked_at        timestamptz not null default now(),
  closed_at              timestamptz
);
create index if not exists fut_pos_user_status on public.futures_positions (user_id, status);
create index if not exists fut_pos_open on public.futures_positions (status) where status = 'open';

alter table public.futures_config    enable row level security;
alter table public.futures_positions enable row level security;
drop policy if exists fut_cfg_read on public.futures_config;
create policy fut_cfg_read on public.futures_config for select to authenticated using (true);
drop policy if exists fut_pos_read on public.futures_positions;
create policy fut_pos_read on public.futures_positions for select to authenticated
  using (user_id = auth.uid());
-- Aucune policy d'écriture : seules les fonctions SECURITY DEFINER modifient les positions.

-- ─────────────────────────────────────────────
--  3. OUTILS INTERNES
-- ─────────────────────────────────────────────
create or replace function public.fn_fut_err(p_msg text) returns jsonb
language sql immutable as $$ select jsonb_build_object('success', false, 'error', p_msg) $$;

-- Dernier prix du jeu pour l'actif configuré (lecture directe des ticks)
create or replace function public.fn_fut_last_price()
returns table (price numeric, age numeric)
language sql stable security definer set search_path = public as $$
  select t.price_usd, extract(epoch from (now() - t.fetched_at))::numeric
    from public.game_price_ticks t
   where t.asset_symbol = (select asset_symbol from public.futures_config where id = 1)
     and t.price_usd > 0
   order by t.fetched_at desc
   limit 1
$$;

-- Plus bas / plus haut depuis un instant (détecte les mèches entre deux contrôles)
create or replace function public.fn_fut_range_since(p_asset text, p_from timestamptz, p_last numeric)
returns table (lo numeric, hi numeric)
language sql stable security definer set search_path = public as $$
  select least(coalesce(min(t.price_usd), p_last), p_last),
         greatest(coalesce(max(t.price_usd), p_last), p_last)
    from public.game_price_ticks t
   where t.asset_symbol = p_asset and t.fetched_at > p_from and t.price_usd > 0
$$;

-- Prix de liquidation (marge isolée)
--   équité = marge − frais périodiques ± PnL ; liquidation si équité ≤ notionnel × mmr
create or replace function public.fn_fut_liq(
  p_side text, p_entry numeric, p_margin numeric, p_fees numeric,
  p_notional numeric, p_mmr_pct numeric
) returns numeric language sql immutable as $$
  select case when p_side = 'LONG'
    then p_entry * (1 - (p_margin - p_fees) / p_notional + p_mmr_pct / 100)
    else p_entry * (1 + (p_margin - p_fees) / p_notional - p_mmr_pct / 100)
  end
$$;

-- Portefeuille : verrou de ligne + écriture dans le ledger `transactions`
create or replace function public.fn_fut_wallet_debit(p_user uuid, p_amount numeric, p_meta jsonb default '{}')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_sym text; v_bal numeric;
begin
  select currency_symbol into v_sym from public.futures_config where id = 1;
  select available_balance into v_bal from public.user_balances
   where user_id = p_user and asset_symbol = v_sym for update;
  if v_bal is null or v_bal < p_amount then return false; end if;

  update public.user_balances
     set available_balance = available_balance - p_amount, updated_at = now()
   where user_id = p_user and asset_symbol = v_sym;

  insert into public.transactions (user_id, type, asset_symbol, amount, net_amount, status, completed_at, metadata)
  values (p_user, 'game_bet', v_sym, p_amount, p_amount, 'completed', now(),
          jsonb_build_object('game', 'futures') || p_meta);
  return true;
end $$;

create or replace function public.fn_fut_wallet_credit(p_user uuid, p_amount numeric, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_sym text;
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  select currency_symbol into v_sym from public.futures_config where id = 1;
  update public.user_balances
     set available_balance = available_balance + p_amount, updated_at = now()
   where user_id = p_user and asset_symbol = v_sym;

  insert into public.transactions (user_id, type, asset_symbol, amount, net_amount, status, completed_at, metadata)
  values (p_user, 'game_win', v_sym, p_amount, p_amount, 'completed', now(),
          jsonb_build_object('game', 'futures') || p_meta);
end $$;

-- Vérifie TP / SL par rapport à un prix de référence. Renvoie un message ou NULL.
create or replace function public.fn_fut_check_tpsl(
  p_side text, p_ref numeric, p_liq numeric, p_tp numeric, p_sl numeric
) returns text language plpgsql immutable as $$
begin
  if p_side = 'LONG' then
    if p_tp is not null and p_tp <= p_ref then return 'Le Take Profit doit être au-dessus du prix actuel.'; end if;
    if p_sl is not null and p_sl >= p_ref then return 'Le Stop Loss doit être en dessous du prix actuel.'; end if;
    if p_sl is not null and p_sl <= p_liq then return 'Le Stop Loss doit être au-dessus du prix de liquidation.'; end if;
  else
    if p_tp is not null and p_tp >= p_ref then return 'Le Take Profit doit être en dessous du prix actuel.'; end if;
    if p_sl is not null and p_sl <= p_ref then return 'Le Stop Loss doit être au-dessus du prix actuel.'; end if;
    if p_sl is not null and p_sl >= p_liq then return 'Le Stop Loss doit être en dessous du prix de liquidation.'; end if;
  end if;
  return null;
end $$;

-- Clôture d'une position (appelée avec la ligne déjà verrouillée)
create or replace function public.fn_fut_close_row(
  p_id uuid, p_exit numeric, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  r public.futures_positions;
  v_pnl numeric; v_equity numeric; v_fee numeric; v_payout numeric;
begin
  select * into r from public.futures_positions where id = p_id and status = 'open' for update;
  if not found then return; end if;

  v_pnl    := (case when r.side = 'LONG' then 1 else -1 end) * (p_exit - r.entry_price) * r.qty;
  v_equity := r.margin - r.fees_funding + v_pnl;
  v_fee    := r.qty * p_exit * r.close_fee_pct / 100;

  if p_reason = 'liquidation' then
    v_fee := 0; v_payout := 0;                      -- marge perdue
  else
    v_payout := greatest(0, v_equity - v_fee);
    v_fee    := least(v_fee, greatest(0, v_equity));
  end if;

  update public.futures_positions
     set status = 'closed', close_reason = p_reason, exit_price = p_exit,
         fees_close = v_fee, payout = v_payout,
         realized_pnl = v_payout - r.margin - r.fees_open,
         closed_at = now(), last_checked_at = now()
   where id = r.id;

  perform public.fn_fut_wallet_credit(r.user_id, v_payout, jsonb_build_object(
    'position_id', r.id, 'side', r.side, 'leverage', r.leverage, 'close_reason', p_reason,
    'margin', r.margin, 'exit_price', p_exit,
    'realized_pnl', v_payout - r.margin - r.fees_open));
end $$;

-- ─────────────────────────────────────────────
--  4. MOTEUR : frais périodiques + liquidation + TP/SL
--  Appelé par pg_cron (toutes les ~5 s) ET avant chaque action utilisateur.
-- ─────────────────────────────────────────────
create or replace function public.fn_fut_settle(p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.futures_positions;
  v_price numeric; v_age numeric; v_lo numeric; v_hi numeric;
  v_now timestamptz := now();
  v_periods bigint; v_n int := 0;
  v_trigger numeric; v_reason text;
begin
  if not exists (select 1 from public.futures_positions where status = 'open'
                  and (p_user is null or user_id = p_user)) then
    return 0;                                   -- rien à surveiller : coût quasi nul
  end if;

  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;
  if v_price is null then return 0; end if;

  for r in
    select * from public.futures_positions
     where status = 'open' and (p_user is null or user_id = p_user)
     order by opened_at
       for update skip locked
  loop
    -- 1) frais périodiques (prélevés sur la marge → rapprochent la liquidation)
    if r.fee_interval_seconds > 0 and r.fee_rate_pct > 0 then
      v_periods := floor(extract(epoch from (v_now - r.last_fee_at)) / r.fee_interval_seconds);
      if v_periods > 0 then
        r.fees_funding := r.fees_funding + v_periods * r.notional * r.fee_rate_pct / 100;
        r.last_fee_at  := r.last_fee_at + (v_periods * r.fee_interval_seconds) * interval '1 second';
        r.liq_price    := public.fn_fut_liq(r.side, r.entry_price, r.margin, r.fees_funding, r.notional, r.mmr_pct);
      end if;
    end if;

    -- 2) extrêmes de prix depuis le dernier contrôle
    select g.lo, g.hi into v_lo, v_hi from public.fn_fut_range_since(r.asset_symbol, r.last_checked_at, v_price) g;

    -- 3) déclencheurs. Cas ambigus (plusieurs touchés dans la même fenêtre) :
    --    on applique l'issue la plus défavorable au joueur (SL / liquidation avant TP).
    v_trigger := null; v_reason := null;
    if r.side = 'LONG' then
      if    r.sl_price is not null and v_lo <= r.sl_price then v_trigger := r.sl_price;  v_reason := 'sl';
      elsif v_lo <= r.liq_price                           then v_trigger := r.liq_price; v_reason := 'liquidation';
      elsif r.tp_price is not null and v_hi >= r.tp_price then v_trigger := r.tp_price;  v_reason := 'tp';
      end if;
    else
      if    r.sl_price is not null and v_hi >= r.sl_price then v_trigger := r.sl_price;  v_reason := 'sl';
      elsif v_hi >= r.liq_price                           then v_trigger := r.liq_price; v_reason := 'liquidation';
      elsif r.tp_price is not null and v_lo <= r.tp_price then v_trigger := r.tp_price;  v_reason := 'tp';
      end if;
    end if;

    update public.futures_positions
       set fees_funding = r.fees_funding, last_fee_at = r.last_fee_at,
           liq_price = r.liq_price, last_checked_at = v_now
     where id = r.id;

    if v_trigger is not null then
      perform public.fn_fut_close_row(r.id, v_trigger, v_reason);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ─────────────────────────────────────────────
--  5. API APPELÉE PAR L'APP
-- ─────────────────────────────────────────────

-- 5a. Ouvrir une position
create or replace function public.fn_fut_open(
  p_side text, p_margin numeric, p_leverage int,
  p_tp numeric default null, p_sl numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c public.futures_config;
  v_price numeric; v_age numeric;
  v_notional numeric; v_qty numeric; v_fee numeric; v_liq numeric;
  v_open int; v_msg text; v_id uuid;
begin
  if v_uid is null then return public.fn_fut_err('Non connecté.'); end if;
  perform pg_advisory_xact_lock(hashtext('fut:' || v_uid::text));

  select * into c from public.futures_config where id = 1;
  if not found or not c.is_active then
    return public.fn_fut_err('Le trading futures est momentanément indisponible.');
  end if;

  p_side := upper(coalesce(p_side, ''));
  if p_side not in ('LONG','SHORT') then return public.fn_fut_err('Sens invalide.'); end if;
  if p_margin is null or p_margin < c.margin_min or p_margin > c.margin_max then
    return public.fn_fut_err(format('La marge doit être comprise entre %s et %s %s.',
      c.margin_min::float8, c.margin_max::float8, c.currency_symbol));
  end if;
  if p_leverage is null or p_leverage < c.leverage_min or p_leverage > c.leverage_max then
    return public.fn_fut_err(format('Le levier doit être compris entre %sx et %sx.', c.leverage_min, c.leverage_max));
  end if;
  if (100.0 / p_leverage) <= c.maintenance_margin_pct then
    return public.fn_fut_err('Levier trop élevé par rapport à la marge de maintenance.');
  end if;
  if not c.tp_sl_enabled and (p_tp is not null or p_sl is not null) then
    return public.fn_fut_err('TP/SL indisponible.');
  end if;

  perform public.fn_fut_settle(v_uid);

  select count(*) into v_open from public.futures_positions where user_id = v_uid and status = 'open';
  if v_open >= c.max_open_positions then
    return public.fn_fut_err(format('Limite de %s positions ouvertes atteinte.', c.max_open_positions));
  end if;

  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;
  if v_price is null or v_age > 15 then
    return public.fn_fut_err('Prix momentanément indisponible, réessayez dans un instant.');
  end if;

  v_notional := p_margin * p_leverage;
  v_qty      := v_notional / v_price;
  v_fee      := v_notional * c.open_fee_pct / 100;
  v_liq      := public.fn_fut_liq(p_side, v_price, p_margin, 0, v_notional, c.maintenance_margin_pct);

  v_msg := public.fn_fut_check_tpsl(p_side, v_price, v_liq, p_tp, p_sl);
  if v_msg is not null then return public.fn_fut_err(v_msg); end if;

  if not public.fn_fut_wallet_debit(v_uid, p_margin + v_fee, jsonb_build_object(
       'side', p_side, 'leverage', p_leverage, 'margin', p_margin, 'fee_open', v_fee,
       'entry_price', v_price)) then
    return public.fn_fut_err('Solde insuffisant.');
  end if;

  insert into public.futures_positions (
    user_id, asset_symbol, side, leverage, margin, notional, qty, entry_price,
    mmr_pct, fee_rate_pct, fee_interval_seconds, close_fee_pct,
    tp_price, sl_price, liq_price, fees_open
  ) values (
    v_uid, c.asset_symbol, p_side, p_leverage, p_margin, v_notional, v_qty, v_price,
    c.maintenance_margin_pct, c.fee_rate_pct, c.fee_interval_seconds, c.close_fee_pct,
    p_tp, p_sl, v_liq, v_fee
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'position_id', v_id, 'entry_price', v_price);
end $$;

-- 5b. Fermer une position au prix du marché
create or replace function public.fn_fut_close(p_position_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_price numeric; v_age numeric; r public.futures_positions;
begin
  if v_uid is null then return public.fn_fut_err('Non connecté.'); end if;
  perform pg_advisory_xact_lock(hashtext('fut:' || v_uid::text));
  perform public.fn_fut_settle(v_uid);

  select * into r from public.futures_positions
   where id = p_position_id and user_id = v_uid for update;
  if not found then return public.fn_fut_err('Position introuvable.'); end if;
  if r.status <> 'open' then
    return public.fn_fut_err('Cette position est déjà clôturée.');
  end if;

  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;
  if v_price is null or v_age > 15 then
    return public.fn_fut_err('Prix momentanément indisponible, réessayez dans un instant.');
  end if;

  perform public.fn_fut_close_row(r.id, v_price, 'manual');
  return jsonb_build_object('success', true);
end $$;

-- 5c. Modifier TP / SL (NULL = retirer)
create or replace function public.fn_fut_set_tpsl(
  p_position_id uuid, p_tp numeric, p_sl numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_price numeric; v_age numeric; r public.futures_positions;
  v_msg text; v_enabled boolean;
begin
  if v_uid is null then return public.fn_fut_err('Non connecté.'); end if;
  select tp_sl_enabled into v_enabled from public.futures_config where id = 1;
  if not coalesce(v_enabled, false) then return public.fn_fut_err('TP/SL indisponible.'); end if;
  perform pg_advisory_xact_lock(hashtext('fut:' || v_uid::text));
  perform public.fn_fut_settle(v_uid);

  select * into r from public.futures_positions
   where id = p_position_id and user_id = v_uid and status = 'open' for update;
  if not found then return public.fn_fut_err('Position introuvable ou déjà clôturée.'); end if;

  select p.price, p.age into v_price, v_age from public.fn_fut_last_price() p;
  if v_price is null then return public.fn_fut_err('Prix momentanément indisponible.'); end if;

  v_msg := public.fn_fut_check_tpsl(r.side, v_price, r.liq_price, p_tp, p_sl);
  if v_msg is not null then return public.fn_fut_err(v_msg); end if;

  update public.futures_positions set tp_price = p_tp, sl_price = p_sl where id = r.id;
  return jsonb_build_object('success', true);
end $$;

-- 5d. Statistiques d'une période (NULL = depuis toujours)
create or replace function public.fn_fut_period_stats(p_user uuid, p_from timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trades', count(*),
    'wins',   count(*) filter (where realized_pnl > 0),
    'gains',  coalesce(sum(realized_pnl) filter (where realized_pnl > 0), 0),
    'losses', coalesce(-sum(realized_pnl) filter (where realized_pnl < 0), 0),
    'net',    coalesce(sum(realized_pnl), 0),
    'margin', coalesce(sum(margin), 0),
    'fees',   coalesce(sum(fees_open + fees_funding + fees_close), 0)
  )
  from public.futures_positions
  where user_id = p_user and status = 'closed' and (p_from is null or closed_at >= p_from)
$$;

-- 5e. Tout l'état en un appel (config, solde, positions, historique, stats)
create or replace function public.fn_get_futures_state(p_history_limit int default 60)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c public.futures_config;
  v_balance numeric;
begin
  if v_uid is null then return jsonb_build_object('error', 'Non connecté.'); end if;
  select * into c from public.futures_config where id = 1;
  if not found then return jsonb_build_object('error', 'Configuration futures absente.'); end if;

  perform public.fn_fut_settle(v_uid);

  select coalesce(available_balance, 0) into v_balance
    from public.user_balances where user_id = v_uid and asset_symbol = c.currency_symbol;

  return jsonb_build_object(
    'config', to_jsonb(c),
    'balance', coalesce(v_balance, 0),
    'positions', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.opened_at desc)
        from public.futures_positions p where p.user_id = v_uid and p.status = 'open'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.closed_at desc)
        from (select * from public.futures_positions
               where user_id = v_uid and status = 'closed'
               order by closed_at desc limit greatest(1, least(p_history_limit, 200))) h), '[]'::jsonb),
    'stats', jsonb_build_object(
      'today', public.fn_fut_period_stats(v_uid, date_trunc('day', now())),
      'd7',    public.fn_fut_period_stats(v_uid, now() - interval '7 days'),
      'd30',   public.fn_fut_period_stats(v_uid, now() - interval '30 days'),
      'd90',   public.fn_fut_period_stats(v_uid, now() - interval '90 days'),
      'all',   public.fn_fut_period_stats(v_uid, null)
    )
  );
end $$;

-- ─────────────────────────────────────────────
--  6. DROITS
-- ─────────────────────────────────────────────
revoke all on function public.fn_fut_settle(uuid)                          from public, anon, authenticated;
revoke all on function public.fn_fut_close_row(uuid, numeric, text)        from public, anon, authenticated;
revoke all on function public.fn_fut_wallet_debit(uuid, numeric, jsonb)    from public, anon, authenticated;
revoke all on function public.fn_fut_wallet_credit(uuid, numeric, jsonb)   from public, anon, authenticated;
revoke all on function public.fn_fut_last_price()                          from public, anon, authenticated;
revoke all on function public.fn_fut_range_since(text, timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.fn_fut_period_stats(uuid, timestamptz)       from public, anon, authenticated;

revoke all on function public.fn_fut_open(text, numeric, int, numeric, numeric) from public, anon;
revoke all on function public.fn_fut_close(uuid)                                 from public, anon;
revoke all on function public.fn_fut_set_tpsl(uuid, numeric, numeric)            from public, anon;
revoke all on function public.fn_get_futures_state(int)                          from public, anon;
grant execute on function public.fn_fut_open(text, numeric, int, numeric, numeric) to authenticated;
grant execute on function public.fn_fut_close(uuid)                                to authenticated;
grant execute on function public.fn_fut_set_tpsl(uuid, numeric, numeric)           to authenticated;
grant execute on function public.fn_get_futures_state(int)                         to authenticated;

-- ─────────────────────────────────────────────
--  7. SURVEILLANCE CONTINUE (liquidations / TP / SL / frais, même app fermée)
--  Planifiée séparément :
--    select cron.schedule('futures-settle', '5 seconds', $$ select public.fn_fut_settle(null) $$);
--  pg_cron 1.6 est installé : les intervalles en secondes sont supportés.
-- ─────────────────────────────────────────────
