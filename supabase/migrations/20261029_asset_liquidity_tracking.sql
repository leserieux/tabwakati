-- Suivi du manque de liquidité, identique pour TOUS les actifs (WAKATI n'a plus de traitement à part).
--
-- Réserve d'un actif = ce que l'app en possède : treasury_wallets.balance (en unités ; valeur USD = balance x asset_prices.price_usd,
-- voir la vue asset_reserves). Règle commune à chaque swap :
--   - l'actif versé à l'utilisateur sort de SA réserve ; si elle ne couvre pas le montant, le swap est refusé (rien n'est débité),
--     l'utilisateur reçoit « Manque de liquidité en X … », l'incident est écrit dans asset_liquidity_events et l'actif est marqué
--     asset_liquidity_state.liquidity_shortage = true ;
--   - le même drapeau est levé quand un swap laisse la réserve de l'actif versé à 0 ;
--   - il retombe tout seul quand la réserve remonte au moins au niveau du dernier montant refusé (trigger sur treasury_wallets) ;
--   - le même suivi s'applique à l'achat de WAKATI (voir 20261030_buy_wakati_liquidity_tracking.sql) ;
--   - l'actif donné par l'utilisateur est crédité à sa réserve (c'est ce que l'app reçoit réellement : comptabilité inchangée).
--
-- Cette migration REMPLACE 20261028_wakati_sale_drains_price_reserve.sql (supprimée du dépôt) : si celle-ci avait déjà été appliquée,
-- ses objets propres à WAKATI sont retirés ci-dessous ; la réserve du prix (wakati_reserve_state) redevient alimentée par les seuls profits.
--
-- execute_swap_realtime n'est pas réécrite (la définition réelle en base contient la journalisation du 2026-10-07 et la garde d'identité du
-- 2026-10-10, absentes du catalogue CSV) : ses deux surcharges sont renommées _execute_swap_realtime_core (inchangées, non appelables
-- par les clients) et remplacées par une enveloppe de même signature qui contrôle la réserve avant d'appeler le cœur.

-- 0) Prérequis
do $$
begin
  if to_regprocedure('public.assert_caller_is(uuid)') is null then
    raise exception 'assert_caller_is(uuid) introuvable : appliquer d''abord les gardes d''identité (README 2026-10-10 (2)).';
  end if;
  if to_regprocedure('public.estimate_swap(text,text,numeric,numeric)') is null then
    raise exception 'estimate_swap(text,text,numeric,numeric) introuvable.';
  end if;
end $$;

-- 1) Retrait de la version précédente, propre à WAKATI (sans effet si elle n'a jamais été appliquée)
drop trigger  if exists wakati_reserve_clear_shortage on public.wakati_reserve_state;
drop function if exists public.trg_wakati_reserve_clear_shortage();
drop function if exists public._wakati_sale_liquidity_check(uuid, text, numeric);
drop function if exists public._wakati_sale_drain_reserve(numeric);
drop table    if exists public.wakati_liquidity_events;
alter table public.wakati_reserve_state
  drop column if exists liquidity_shortage,
  drop column if exists liquidity_shortage_since,
  drop column if exists last_shortage_at;

-- 2) Suivi générique, une ligne par actif
create table if not exists public.asset_liquidity_state (
  asset_symbol             text primary key references public.supported_assets(symbol),
  liquidity_shortage       boolean     not null default false,
  liquidity_shortage_since timestamptz,
  last_shortage_at         timestamptz,
  last_required_amount     numeric,                       -- dernier montant refusé : la réserve doit l'atteindre pour lever le drapeau
  updated_at               timestamptz not null default now()
);

create table if not exists public.asset_liquidity_events (
  id               bigint generated always as identity primary key,
  asset_symbol     text        not null references public.supported_assets(symbol),   -- actif à verser (celui dont la réserve manque)
  user_id          uuid        not null,
  from_asset       text        not null,                  -- actif que l'utilisateur voulait donner
  from_amount      numeric     not null,
  requested_amount numeric     not null,                  -- à verser, en unités de asset_symbol
  reserve_amount   numeric     not null,                  -- réserve disponible à ce moment
  shortfall_amount numeric     not null,
  price_usd        numeric,                               -- prix de asset_symbol (null si absent)
  requested_usd    numeric,
  reserve_usd      numeric,
  shortfall_usd    numeric,
  created_at       timestamptz not null default now()
);
create index if not exists asset_liquidity_events_created_idx on public.asset_liquidity_events (created_at desc);
create index if not exists asset_liquidity_events_asset_idx   on public.asset_liquidity_events (asset_symbol, created_at desc);

alter table public.asset_liquidity_state  enable row level security;   -- aucune policy : service_role (dashboard) uniquement
alter table public.asset_liquidity_events enable row level security;
revoke all on public.asset_liquidity_state, public.asset_liquidity_events from public, anon, authenticated;

-- Réserve de chaque actif, en unités et en USD, avec son signalement
create or replace view public.asset_reserves with (security_invoker = true) as
select sa.symbol                                    as asset_symbol,
       coalesce(tw.balance, 0)                      as reserve_amount,
       ap.price_usd                                 as price_usd,
       case when ap.price_usd is null then null else coalesce(tw.balance, 0) * ap.price_usd end as reserve_usd,
       coalesce(st.liquidity_shortage, false)       as liquidity_shortage,
       st.liquidity_shortage_since,
       st.last_shortage_at
from public.supported_assets sa
left join public.treasury_wallets      tw on tw.asset_symbol = sa.symbol
left join public.asset_prices          ap on ap.asset_symbol = sa.symbol
left join public.asset_liquidity_state st on st.asset_symbol = sa.symbol
where sa.is_active;
revoke all on public.asset_reserves from public, anon, authenticated;

-- Le drapeau retombe quand la réserve remonte assez (jamais sur une simple baisse).
create or replace function public.trg_treasury_clear_liquidity_shortage()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.balance > OLD.balance then
    update public.asset_liquidity_state
    set liquidity_shortage = false, liquidity_shortage_since = null, updated_at = now()
    where asset_symbol = NEW.asset_symbol
      and liquidity_shortage
      and NEW.balance >= COALESCE(last_required_amount, 0)
      and NEW.balance > 0;
  end if;
  return NEW;
end $$;
revoke execute on function public.trg_treasury_clear_liquidity_shortage() from public, anon, authenticated;

drop trigger if exists treasury_clear_liquidity_shortage on public.treasury_wallets;
create trigger treasury_clear_liquidity_shortage
  after update of balance on public.treasury_wallets
  for each row execute function public.trg_treasury_clear_liquidity_shortage();

-- 3) Enregistrement commun d'un manque de liquidité (swap, achat de WAKATI…) : écrit l'événement, marque l'actif
--    et renvoie le message à afficher à l'utilisateur. Appelé par les fonctions qui versent un actif ; jamais par un client.
create or replace function public._asset_liquidity_record_shortage(
  p_user_id uuid, p_asset text, p_from_asset text, p_from_amount numeric, p_requested numeric, p_reserve numeric
) returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_price numeric;
  v_short numeric;
begin
  SELECT price_usd INTO v_price FROM public.asset_prices WHERE asset_symbol = p_asset;
  v_short := p_requested - p_reserve;

  INSERT INTO public.asset_liquidity_events
    (asset_symbol, user_id, from_asset, from_amount, requested_amount, reserve_amount, shortfall_amount,
     price_usd, requested_usd, reserve_usd, shortfall_usd)
  VALUES
    (p_asset, p_user_id, p_from_asset, p_from_amount, p_requested, p_reserve, v_short,
     v_price, p_requested * v_price, p_reserve * v_price, v_short * v_price);

  INSERT INTO public.asset_liquidity_state (asset_symbol, liquidity_shortage, liquidity_shortage_since, last_shortage_at, last_required_amount)
  VALUES (p_asset, true, now(), now(), p_requested)
  ON CONFLICT (asset_symbol) DO UPDATE
  SET liquidity_shortage       = true,
      liquidity_shortage_since = COALESCE(public.asset_liquidity_state.liquidity_shortage_since, now()),
      last_shortage_at         = now(),
      last_required_amount     = EXCLUDED.last_required_amount,
      updated_at               = now();

  IF p_reserve <= 0 THEN
    RETURN format('Manque de liquidité en %s : la réserve est vide, cette opération est impossible pour le moment. Réessaie plus tard.', p_asset);
  END IF;
  RETURN format('Manque de liquidité en %s : la réserve ne couvre pas cette opération (disponible : %s %s). Réessaie avec un montant plus petit ou plus tard.',
                p_asset, TRUNC(p_reserve, 8), p_asset);
end $$;

-- Contrôle avant le swap : NULL si la réserve de l'actif versé suffit, sinon le message à afficher.
create or replace function public._asset_liquidity_check(p_user_id uuid, p_from_asset text, p_to_asset text, p_from_amount numeric)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_fee_rate numeric;
  v_est      record;
  v_reserve  numeric;
  v_user_bal numeric;
begin
  IF p_from_asset IS NULL OR p_to_asset IS NULL OR p_from_asset = p_to_asset OR p_from_amount IS NULL OR p_from_amount <= 0 THEN
    RETURN NULL;  -- le cœur du swap répond lui-même (mêmes actifs, montant invalide…)
  END IF;

  SELECT swap_fee_percentage INTO v_fee_rate FROM public.supported_assets
  WHERE symbol = p_from_asset AND is_active = true AND can_be_swapped = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.supported_assets WHERE symbol = p_to_asset AND is_active = true AND can_be_swapped = true;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_est FROM public.estimate_swap(p_from_asset, p_to_asset, p_from_amount, COALESCE(v_fee_rate, 0.5));
  IF v_est.amount_out IS NULL OR v_est.amount_out <= 0 THEN RETURN NULL; END IF;

  -- Verrou sur la réserve : elle ne peut pas changer entre ce contrôle et le débit du swap (même transaction).
  SELECT balance INTO v_reserve FROM public.treasury_wallets WHERE asset_symbol = p_to_asset FOR UPDATE;
  v_reserve := COALESCE(v_reserve, 0);  -- ligne absente = réserve vide
  IF v_reserve >= v_est.amount_out THEN RETURN NULL; END IF;

  -- Réserve insuffisante. On ne signale que si l'utilisateur détient vraiment le montant ;
  -- sinon l'erreur habituelle « Solde insuffisant » du swap s'applique.
  SELECT available_balance INTO v_user_bal FROM public.user_balances
  WHERE user_id = p_user_id AND asset_symbol = p_from_asset;
  IF COALESCE(v_user_bal, 0) < p_from_amount THEN RETURN NULL; END IF;

  RETURN public._asset_liquidity_record_shortage(p_user_id, p_to_asset, p_from_asset, p_from_amount, v_est.amount_out, v_reserve);
end $$;

-- Après un versement réussi (swap, achat de WAKATI…) : si la réserve de l'actif versé est tombée à 0, on le signale aussi.
create or replace function public._asset_liquidity_after_payout(p_to_asset text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_reserve numeric;
begin
  SELECT balance INTO v_reserve FROM public.treasury_wallets WHERE asset_symbol = p_to_asset;
  IF COALESCE(v_reserve, 0) <= 0 THEN
    INSERT INTO public.asset_liquidity_state (asset_symbol, liquidity_shortage, liquidity_shortage_since, last_shortage_at, last_required_amount)
    VALUES (p_to_asset, true, now(), now(), NULL)
    ON CONFLICT (asset_symbol) DO UPDATE
    SET liquidity_shortage       = true,
        liquidity_shortage_since = COALESCE(public.asset_liquidity_state.liquidity_shortage_since, now()),
        last_shortage_at         = now(),
        last_required_amount     = NULL,   -- réserve vide : le moindre réapprovisionnement lève le drapeau
        updated_at               = now();
  END IF;
end $$;

revoke execute on function public._asset_liquidity_record_shortage(uuid, text, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public._asset_liquidity_check(uuid, text, text, numeric) from public, anon, authenticated;
revoke execute on function public._asset_liquidity_after_payout(text) from public, anon, authenticated;

-- 4) Surcharges existantes -> « cœur » (inchangées, non appelables par les clients). Sans effet si déjà renommées.
do $$
begin
  if to_regprocedure('public._execute_swap_realtime_core(uuid,text,text,numeric,numeric,numeric)') is null then
    alter function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric) rename to _execute_swap_realtime_core;
  end if;
  if to_regprocedure('public._execute_swap_realtime_core(uuid,text,text,numeric,numeric)') is null then
    alter function public.execute_swap_realtime(uuid, text, text, numeric, numeric) rename to _execute_swap_realtime_core;
  end if;
end $$;
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

  v_block := public._asset_liquidity_check(p_user_id, p_from_asset, p_to_asset, p_from_amount);
  IF v_block IS NOT NULL THEN
    -- Pas d'exception : l'écriture du signalement doit être conservée.
    RETURN QUERY SELECT FALSE, v_block, NULL::uuid, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, FALSE;
    RETURN;
  END IF;

  SELECT * INTO r FROM public._execute_swap_realtime_core(p_user_id, p_from_asset, p_to_asset, p_from_amount, p_slippage_tolerance, p_min_amount_out);

  IF r.success THEN
    PERFORM public._asset_liquidity_after_payout(p_to_asset);
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

  v_block := public._asset_liquidity_check(p_user_id, p_from_asset, p_to_asset, p_from_amount);
  IF v_block IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_block, NULL::uuid, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, FALSE;
    RETURN;
  END IF;

  SELECT * INTO r FROM public._execute_swap_realtime_core(p_user_id, p_from_asset, p_to_asset, p_from_amount, p_slippage_tolerance);

  IF r.success THEN
    PERFORM public._asset_liquidity_after_payout(p_to_asset);
  END IF;

  RETURN QUERY SELECT r.success, r.message, r.transaction_id, r.from_amount, r.to_amount, r.exchange_rate, r.fee_amount, r.net_to_amount, r.realtime_price_used;
end $function$;

-- Droits : clients connectés et serveur seulement (le visiteur anonyme n'a rien à swapper).
revoke execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric) from public, anon;
revoke execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric) from public, anon;
grant  execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric) to authenticated, service_role;
grant  execute on function public.execute_swap_realtime(uuid, text, text, numeric, numeric, numeric) to authenticated, service_role;
