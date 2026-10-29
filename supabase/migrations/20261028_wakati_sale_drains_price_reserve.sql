-- Réserve du prix WAKATI (wakati_reserve_state.reserve_usd) : règle achat / vente.
--
--   ACHAT  (buy_wakati_with_asset, swap vers WAKATI) : n'alimente PAS la réserve. Rien ne change, la réserve reste
--          alimentée uniquement par le calcul quotidien (fn_compute_wakati_daily_price, part du profit net).
--   VENTE  (swap WAKATI -> autre actif, via execute_swap_realtime) : VIDE la réserve de la valeur en USD des WAKATI vendus
--          (quantité x prix WAKATI). Si la réserve ne couvre pas la vente :
--            - la vente est refusée (rien n'est débité), avec le message « Manque de liquidité … » renvoyé à l'utilisateur ;
--            - l'incident est écrit en base (table wakati_liquidity_events + drapeau wakati_reserve_state.liquidity_shortage).
--          Le drapeau est aussi levé quand une vente laisse la réserve à 0 ; il retombe dès que la réserve remonte.
--
-- Méthode : on ne réécrit PAS execute_swap_realtime (la définition réelle en base contient la journalisation du 2026-10-07 et la garde
-- d'identité du 2026-10-10, absentes du catalogue CSV du dépôt). Les deux surcharges existantes sont renommées en
-- _execute_swap_realtime_core (inchangées, non appelables par les clients) et remplacées par une enveloppe de même signature
-- qui vérifie la réserve avant, appelle le cœur, puis vide la réserve si le swap a réussi.
-- Les deux surcharges doivent exister (sinon le renommage échoue et la migration est annulée sans rien changer).

-- 0) Prérequis : la garde d'identité appliquée en base le 2026-10-10
do $$
begin
  if to_regprocedure('public.assert_caller_is(uuid)') is null then
    raise exception 'assert_caller_is(uuid) introuvable : appliquer d''abord les gardes d''identité (README 2026-10-10 (2)).';
  end if;
end $$;

-- 1) Signalement en base
alter table public.wakati_reserve_state
  add column if not exists liquidity_shortage       boolean     not null default false,
  add column if not exists liquidity_shortage_since timestamptz,
  add column if not exists last_shortage_at         timestamptz;

create table if not exists public.wakati_liquidity_events (
  id               bigint generated always as identity primary key,
  user_id          uuid        not null,
  requested_wakati numeric     not null,
  requested_usd    numeric     not null,
  reserve_usd      numeric     not null,
  shortfall_usd    numeric     not null,
  wakati_price_usd numeric     not null,
  created_at       timestamptz not null default now()
);
create index if not exists wakati_liquidity_events_created_idx on public.wakati_liquidity_events (created_at desc);
alter table public.wakati_liquidity_events enable row level security;  -- aucune policy : service_role (dashboard) uniquement
revoke all on public.wakati_liquidity_events from public, anon, authenticated;

-- Le drapeau retombe quand la réserve remonte (calcul quotidien) ; une vente qui la baisse ne le touche pas.
create or replace function public.trg_wakati_reserve_clear_shortage()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if NEW.liquidity_shortage and NEW.reserve_usd > OLD.reserve_usd then
    NEW.liquidity_shortage       := false;
    NEW.liquidity_shortage_since := null;
  end if;
  return NEW;
end $$;
revoke execute on function public.trg_wakati_reserve_clear_shortage() from public, anon, authenticated;

drop trigger if exists wakati_reserve_clear_shortage on public.wakati_reserve_state;
create trigger wakati_reserve_clear_shortage
  before update on public.wakati_reserve_state
  for each row execute function public.trg_wakati_reserve_clear_shortage();

-- 2) Contrôle avant la vente : renvoie NULL si tout va bien, sinon le message à afficher à l'utilisateur.
create or replace function public._wakati_sale_liquidity_check(p_user_id uuid, p_from_asset text, p_from_amount numeric)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_price    numeric;
  v_usd      numeric;
  v_reserve  numeric;
  v_user_bal numeric;
  v_max      numeric;
begin
  IF p_from_asset IS DISTINCT FROM 'WAKATI' OR p_from_amount IS NULL OR p_from_amount <= 0 THEN
    RETURN NULL;  -- pas une vente de WAKATI : rien à contrôler
  END IF;

  SELECT price_usd INTO v_price FROM public.asset_prices WHERE asset_symbol = 'WAKATI';
  IF v_price IS NULL OR v_price <= 0 THEN
    RETURN NULL;  -- prix indisponible : le cœur du swap refusera de lui-même
  END IF;

  v_usd := p_from_amount * v_price;

  -- Verrou sur la ligne : la réserve ne peut pas changer entre ce contrôle et le débit (même transaction).
  SELECT reserve_usd INTO v_reserve FROM public.wakati_reserve_state WHERE id = 1 FOR UPDATE;
  v_reserve := COALESCE(v_reserve, 0);  -- ligne absente = réserve vide

  IF v_reserve >= v_usd THEN
    RETURN NULL;
  END IF;

  -- Réserve insuffisante. On ne signale que si l'utilisateur détient vraiment ces WAKATI ;
  -- sinon l'erreur habituelle « Solde insuffisant » du swap s'applique.
  SELECT available_balance INTO v_user_bal FROM public.user_balances
  WHERE user_id = p_user_id AND asset_symbol = 'WAKATI';
  IF COALESCE(v_user_bal, 0) < p_from_amount THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.wakati_liquidity_events (user_id, requested_wakati, requested_usd, reserve_usd, shortfall_usd, wakati_price_usd)
  VALUES (p_user_id, p_from_amount, v_usd, v_reserve, v_usd - v_reserve, v_price);

  UPDATE public.wakati_reserve_state
  SET liquidity_shortage = true,
      liquidity_shortage_since = COALESCE(liquidity_shortage_since, now()),
      last_shortage_at = now(),
      updated_at = now()
  WHERE id = 1;

  IF v_reserve <= 0 THEN
    RETURN 'Manque de liquidité : la réserve du prix WAKATI est vide, la vente est impossible pour le moment. Réessaie plus tard.';
  END IF;

  v_max := TRUNC(v_reserve / v_price, 6);
  RETURN format('Manque de liquidité : la réserve du prix WAKATI ne couvre pas cette vente. Tu peux vendre au maximum %s WAKATI pour le moment, ou réessayer plus tard.', v_max);
end $$;

-- 3) Vidage de la réserve après un swap WAKATI réussi (la réserve ne descend jamais sous 0).
create or replace function public._wakati_sale_drain_reserve(p_wakati_amount numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_price numeric;
  v_usd   numeric;
begin
  SELECT price_usd INTO v_price FROM public.asset_prices WHERE asset_symbol = 'WAKATI';
  IF v_price IS NULL OR v_price <= 0 OR p_wakati_amount IS NULL OR p_wakati_amount <= 0 THEN
    RETURN;
  END IF;
  v_usd := p_wakati_amount * v_price;

  UPDATE public.wakati_reserve_state
  SET reserve_usd = GREATEST(reserve_usd - v_usd, 0),
      liquidity_shortage = liquidity_shortage OR (reserve_usd - v_usd <= 0),
      liquidity_shortage_since = CASE WHEN reserve_usd - v_usd <= 0 THEN COALESCE(liquidity_shortage_since, now()) ELSE liquidity_shortage_since END,
      last_shortage_at = CASE WHEN reserve_usd - v_usd <= 0 THEN now() ELSE last_shortage_at END,
      updated_at = now()
  WHERE id = 1;
end $$;

revoke execute on function public._wakati_sale_liquidity_check(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public._wakati_sale_drain_reserve(numeric) from public, anon, authenticated;

-- 4) Les deux surcharges existantes deviennent le « cœur » (inchangées) et ne sont plus appelables par les clients.
alter function public.execute_swap_realtime(uuid, text, text, numeric, numeric)
  rename to _execute_swap_realtime_core;
alter function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric)
  rename to _execute_swap_realtime_core;

revoke execute on function public._execute_swap_realtime_core(uuid, text, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public._execute_swap_realtime_core(uuid, text, text, numeric, numeric, numeric) from public, anon, authenticated;

-- 5) Enveloppes : mêmes noms, mêmes paramètres, même type de retour que l'original (l'app ne change pas).
create or replace function public.execute_swap_realtime(
  p_user_id uuid, p_from_asset text, p_to_asset text, p_from_amount numeric,
  p_slippage_tolerance numeric DEFAULT 1.0, p_min_amount_out numeric DEFAULT NULL::numeric
) returns table(success boolean, message text, transaction_id uuid, from_amount numeric, to_amount numeric,
                exchange_rate numeric, fee_amount numeric, net_to_amount numeric, realtime_price_used boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_block text;
  r       record;
begin
  -- Identité vérifiée AVANT d'écrire quoi que ce soit (sinon n'importe qui pourrait polluer le journal de liquidité).
  PERFORM public.assert_caller_is(p_user_id);

  v_block := public._wakati_sale_liquidity_check(p_user_id, p_from_asset, p_from_amount);
  IF v_block IS NOT NULL THEN
    -- Pas d'exception : l'écriture du signalement doit être conservée.
    RETURN QUERY SELECT FALSE, v_block, NULL::uuid, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, FALSE;
    RETURN;
  END IF;

  SELECT * INTO r FROM public._execute_swap_realtime_core(p_user_id, p_from_asset, p_to_asset, p_from_amount, p_slippage_tolerance, p_min_amount_out);

  IF r.success AND p_from_asset = 'WAKATI' THEN
    PERFORM public._wakati_sale_drain_reserve(p_from_amount);
  END IF;

  RETURN QUERY SELECT r.success, r.message, r.transaction_id, r.from_amount, r.to_amount, r.exchange_rate, r.fee_amount, r.net_to_amount, r.realtime_price_used;
end $function$;

create or replace function public.execute_swap_realtime(
  p_user_id uuid, p_from_asset text, p_to_asset text, p_from_amount numeric,
  p_slippage_tolerance numeric DEFAULT 1.0
) returns table(success boolean, message text, transaction_id uuid, from_amount numeric, to_amount numeric,
                exchange_rate numeric, fee_amount numeric, net_to_amount numeric, realtime_price_used boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_block text;
  r       record;
begin
  PERFORM public.assert_caller_is(p_user_id);

  v_block := public._wakati_sale_liquidity_check(p_user_id, p_from_asset, p_from_amount);
  IF v_block IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_block, NULL::uuid, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, FALSE;
    RETURN;
  END IF;

  SELECT * INTO r FROM public._execute_swap_realtime_core(p_user_id, p_from_asset, p_to_asset, p_from_amount, p_slippage_tolerance);

  IF r.success AND p_from_asset = 'WAKATI' THEN
    PERFORM public._wakati_sale_drain_reserve(p_from_amount);
  END IF;

  RETURN QUERY SELECT r.success, r.message, r.transaction_id, r.from_amount, r.to_amount, r.exchange_rate, r.fee_amount, r.net_to_amount, r.realtime_price_used;
end $function$;

-- Droits : les clients connectés et le serveur seulement (le visiteur anonyme n'a rien à swapper).
revoke execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric) from public, anon;
revoke execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant  execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric) to authenticated, service_role;
grant  execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric) to authenticated, service_role;
