-- ⚠️ BROUILLON — NON APPLIQUÉE ET NON TESTÉE sur la base (les outils Supabase étaient indisponibles lors de l'écriture).
-- À appliquer uniquement après test dans une transaction annulée (voir la procédure en bas de fichier).
--
-- Système de burn de la cagnotte jackpot.
-- Contexte : 5 % de chaque mise (en FCFA) était retiré du joueur et ajouté à wheel_config.jackpot_current_amount, un simple
-- compteur : cet argent n'entrait dans aucun portefeuille et aucun segment ne permettait de le gagner.
-- Désormais, chaque jour :
--   1. la cagnotte est libérée dans le portefeuille de trésorerie de son actif (FCFA), ce qui est un revenu réel ;
--   2. l'équivalent en valeur est brûlé en WAKATI depuis la trésorerie (fn_burn_tokens : débit du portefeuille,
--      écriture 'burn' au journal, ligne token_burns, métriques) ;
--   3. la ligne token_burns passe en 'pending_onchain' : le burn est comptable tant qu'il n'a pas été envoyé à l'adresse de burn
--      on-chain. Le dashboard (WAKATI › Burns) permet de confirmer avec le hash de transaction.
-- Le compteur de cagnotte repart à 0. Aucun cron ne signe de transaction on-chain : l'envoi reste manuel.

create or replace function public.fn_daily_jackpot_burn()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cfg record;
  v_pool numeric;
  v_asset text;
  v_pool_price numeric;
  v_wakati_price numeric;
  v_amount numeric;
  v_available numeric;
  v_before numeric;
  v_after numeric;
  v_burn jsonb;
  v_burn_id uuid;
begin
  select * into v_cfg from wheel_config where id = 1 for update;
  if not found then raise exception 'wheel_config introuvable'; end if;

  v_pool  := coalesce(v_cfg.jackpot_current_amount, 0);
  v_asset := v_cfg.jackpot_asset_symbol;
  if v_pool <= 0 then
    return jsonb_build_object('success', true, 'burned', 0, 'message', 'Cagnotte vide : rien à brûler');
  end if;

  select price_usd into v_pool_price   from asset_prices_resolved where asset_symbol = v_asset;
  select price_usd into v_wakati_price from asset_prices_resolved where asset_symbol = 'WAKATI';
  if v_wakati_price is null or v_wakati_price <= 0 or (v_asset <> 'WAKATI' and (v_pool_price is null or v_pool_price <= 0)) then
    raise exception 'Prix indisponible (% / WAKATI) : burn reporté', v_asset;
  end if;

  v_amount := case when v_asset = 'WAKATI' then v_pool else round(v_pool * v_pool_price / v_wakati_price, 8) end;
  if v_amount <= 0 then raise exception 'Montant à brûler nul'; end if;

  -- Vérification AVANT toute écriture : la trésorerie WAKATI doit couvrir le burn (la cagnotte WAKATI éventuelle y est d'abord libérée).
  select coalesce(balance, 0) into v_available from treasury_wallets where asset_symbol = 'WAKATI';
  v_available := coalesce(v_available, 0) + case when v_asset = 'WAKATI' then v_pool else 0 end;
  if v_available < v_amount then
    raise exception 'Trésorerie WAKATI insuffisante : % disponible pour % à brûler', v_available, v_amount;
  end if;

  -- 1) Libération de la cagnotte dans la trésorerie de son actif
  insert into treasury_wallets (asset_symbol, balance, total_collected, total_burned, total_withdrawn, updated_at)
  values (v_asset, v_pool, v_pool, 0, 0, now())
  on conflict (asset_symbol) do update
    set balance = treasury_wallets.balance + excluded.balance,
        total_collected = treasury_wallets.total_collected + excluded.total_collected,
        updated_at = now()
  returning balance into v_after;
  v_before := v_after - v_pool;

  insert into treasury_ledger (asset_symbol, entry_type, amount, balance_before, balance_after, reason)
  values (v_asset, 'adjustment', v_pool, v_before, v_after,
          'Libération de la cagnotte jackpot (contributions des joueurs) avant burn quotidien');

  -- 2) Burn de la valeur équivalente en WAKATI
  v_burn := fn_burn_tokens('WAKATI', v_amount,
    'Burn quotidien : cagnotte jackpot de ' || v_pool || ' ' || v_asset || ' convertie en ' || v_amount || ' WAKATI', null, null);
  if coalesce((v_burn->>'success')::boolean, false) is not true then
    raise exception 'Burn refusé : %', coalesce(v_burn->>'error', 'erreur inconnue');
  end if;
  v_burn_id := (v_burn->>'burn_id')::uuid;

  -- 3) Burn comptable : en attente d'envoi on-chain
  update token_burns set status = 'pending_onchain' where id = v_burn_id;

  -- 4) Remise à zéro de la cagnotte
  update wheel_config set jackpot_current_amount = 0, updated_at = now() where id = 1;

  return jsonb_build_object('success', true, 'pool_released', v_pool, 'pool_asset', v_asset,
                            'wakati_burned', v_amount, 'burn_id', v_burn_id);
end
$fn$;

revoke execute on function public.fn_daily_jackpot_burn() from public, anon, authenticated;
grant execute on function public.fn_daily_jackpot_burn() to service_role;

-- Exécution quotidienne à 00:20 UTC (après le calcul du prix WAKATI de 00:10).
select cron.schedule('daily-jackpot-burn', '20 0 * * *', $$select public.fn_daily_jackpot_burn();$$);

-- PROCÉDURE DE TEST (transaction annulée, ne conserve rien) :
--   do $t$ declare r jsonb; begin
--     update wheel_config set jackpot_current_amount = 41.25 where id = 1;   -- si besoin
--     r := fn_daily_jackpot_burn();
--     raise exception 'TEST % | treasury=% | burns=%', r,
--       (select jsonb_object_agg(asset_symbol, balance) from treasury_wallets where asset_symbol in ('FCFA','WAKATI')),
--       (select jsonb_agg(to_jsonb(b)) from token_burns b where created_at = now());
--   end $t$;
