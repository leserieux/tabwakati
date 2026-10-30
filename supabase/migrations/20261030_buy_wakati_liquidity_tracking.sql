-- Achat de WAKATI : même suivi du manque de liquidité que les swaps (voir 20261029_asset_liquidity_tracking.sql).
-- Seul le bloc « réserve WAKATI insuffisante » change par rapport à 20261028_buy_wakati_server_side_price.sql :
-- avant, simple refus « Liquidité WAKATI insuffisante » (code TREASURY_INSUFFICIENT_WAKATI) sans trace en base ;
-- maintenant, événement dans asset_liquidity_events, drapeau dans asset_liquidity_state, message « Manque de liquidité en WAKATI … »
-- et code INSUFFICIENT_LIQUIDITY (le même que pour les swaps). Une réserve laissée à 0 par l'achat est signalée aussi.
-- Signature et retour inchangés. Prérequis : 20261029_asset_liquidity_tracking.sql.
CREATE OR REPLACE FUNCTION public.buy_wakati_with_asset(
  p_user_id uuid,
  p_from_asset_symbol text,
  p_from_amount numeric,
  p_wakati_amount numeric,
  p_exchange_rate numeric,
  p_fee_percentage numeric DEFAULT 0.5
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_fee_pct       CONSTANT numeric := 0.5;   -- frais d'achat, identique à get_user_assets_for_purchase
  c_tolerance     CONSTANT numeric := 0.02;  -- écart toléré entre le prix vu par l'app et le prix serveur
  v_from_price             numeric;
  v_wakati_price           numeric;
  v_rate                   numeric;
  v_wakati_amount          numeric;
  v_fee_amount             numeric;
  v_base_amount            numeric;
  v_total_debit            numeric;
  v_user_from_balance      numeric;
  v_treasury_wakati_before numeric;
  v_treasury_from_before   numeric;
  v_transaction_id         uuid;
  v_liquidity_msg          text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Non autorisé', 'error_code', 'FORBIDDEN');
  END IF;

  IF p_from_amount IS NULL OR p_from_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Montant asset invalide', 'error_code', 'INVALID_AMOUNT');
  END IF;
  IF p_wakati_amount IS NULL OR p_wakati_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Montant WAKATI invalide', 'error_code', 'INVALID_AMOUNT');
  END IF;
  IF p_from_asset_symbol = 'WAKATI' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Impossible d''acheter WAKATI avec WAKATI', 'error_code', 'INVALID_ASSET');
  END IF;

  -- Prix serveur : actif payé et WAKATI
  SELECT ap.price_usd INTO v_from_price
  FROM supported_assets sa
  JOIN asset_prices ap ON ap.asset_symbol = sa.symbol
  WHERE sa.symbol = p_from_asset_symbol AND sa.is_active = true;
  SELECT price_usd INTO v_wakati_price FROM asset_prices WHERE asset_symbol = 'WAKATI';

  IF v_from_price IS NULL OR v_from_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Actif indisponible pour l''achat de WAKATI', 'error_code', 'INVALID_ASSET');
  END IF;
  IF v_wakati_price IS NULL OR v_wakati_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Prix WAKATI indisponible', 'error_code', 'PRICE_UNAVAILABLE');
  END IF;

  -- Même taux (arrondi à 2 décimales) que celui affiché dans l'app par get_user_assets_for_purchase
  v_rate          := ROUND(v_from_price / v_wakati_price, 2);
  v_wakati_amount := TRUNC(p_from_amount * v_rate, 6);

  IF v_wakati_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Montant trop faible', 'error_code', 'INVALID_AMOUNT');
  END IF;

  -- L'app doit avoir vu à peu près le même prix : sinon elle rafraîchit et réessaie
  IF ABS(p_wakati_amount - v_wakati_amount) / v_wakati_amount > c_tolerance THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'PRICE_CHANGED',
      'message', 'Le prix a changé. Actualise l''écran et réessaie.',
      'expected_wakati', v_wakati_amount, 'exchange_rate', v_rate);
  END IF;

  v_base_amount := p_from_amount;
  v_fee_amount  := ROUND(v_base_amount * (c_fee_pct / 100), 8);
  v_total_debit := v_base_amount + v_fee_amount;

  SELECT available_balance INTO v_user_from_balance
  FROM user_balances WHERE user_id = p_user_id AND asset_symbol = p_from_asset_symbol FOR UPDATE;

  IF NOT FOUND OR v_user_from_balance < v_total_debit THEN
    RETURN jsonb_build_object('success', false, 'message', 'Solde insuffisant pour ' || p_from_asset_symbol, 'error_code', 'INSUFFICIENT_BALANCE');
  END IF;

  SELECT balance INTO v_treasury_wakati_before FROM treasury_wallets WHERE asset_symbol = 'WAKATI' FOR UPDATE;
  IF NOT FOUND OR v_treasury_wakati_before < v_wakati_amount THEN
    -- Même suivi que pour les swaps : événement + drapeau en base, message clair pour l'utilisateur.
    v_liquidity_msg := public._asset_liquidity_record_shortage(
      p_user_id, 'WAKATI', p_from_asset_symbol, p_from_amount, v_wakati_amount, COALESCE(v_treasury_wakati_before, 0));
    RETURN jsonb_build_object('success', false, 'message', v_liquidity_msg, 'error_code', 'INSUFFICIENT_LIQUIDITY');
  END IF;

  -- Débit utilisateur (actif source, base + frais)
  UPDATE user_balances SET available_balance = available_balance - v_total_debit, updated_at = now()
  WHERE user_id = p_user_id AND asset_symbol = p_from_asset_symbol;

  -- Crédit utilisateur (WAKATI, montant calculé par le serveur)
  INSERT INTO user_balances (user_id, asset_symbol, available_balance, updated_at)
  VALUES (p_user_id, 'WAKATI', v_wakati_amount, now())
  ON CONFLICT (user_id, asset_symbol) DO UPDATE
  SET available_balance = user_balances.available_balance + v_wakati_amount, updated_at = now();

  -- Trésorerie : reçoit la part hors-frais de l'actif source
  SELECT balance INTO v_treasury_from_before FROM treasury_wallets WHERE asset_symbol = p_from_asset_symbol FOR UPDATE;
  IF FOUND THEN
    UPDATE treasury_wallets SET balance = balance + v_base_amount, updated_at = now() WHERE asset_symbol = p_from_asset_symbol;
  ELSE
    INSERT INTO treasury_wallets (asset_symbol, balance, total_collected, total_burned, total_withdrawn, updated_at)
    VALUES (p_from_asset_symbol, v_base_amount, v_base_amount, 0, 0, now());
    v_treasury_from_before := 0;
  END IF;

  INSERT INTO treasury_ledger (asset_symbol, entry_type, amount, balance_before, balance_after, performed_by, reason)
  VALUES (p_from_asset_symbol, 'wakati_sale', v_base_amount, v_treasury_from_before, v_treasury_from_before + v_base_amount,
          p_user_id, 'Achat WAKATI - actif recu (hors frais)');

  -- Trésorerie : débite les WAKATI émis vers l'utilisateur
  UPDATE treasury_wallets SET balance = balance - v_wakati_amount, total_withdrawn = total_withdrawn + v_wakati_amount, updated_at = now()
  WHERE asset_symbol = 'WAKATI';

  INSERT INTO treasury_ledger (asset_symbol, entry_type, amount, balance_before, balance_after, performed_by, reason)
  VALUES ('WAKATI', 'wakati_sale', v_wakati_amount, v_treasury_wakati_before, v_treasury_wakati_before - v_wakati_amount,
          p_user_id, 'Achat WAKATI - WAKATI emis');

  -- Si cet achat a vidé la réserve WAKATI, on le signale aussi.
  PERFORM public._asset_liquidity_after_payout('WAKATI');

  -- Frais réels (ajoutés à la trésorerie et à platform_fees via la fonction commune)
  IF v_fee_amount > 0 THEN
    PERFORM collect_fee_to_platform(p_from_asset_symbol, v_fee_amount, 'wakati_purchase_fee', p_user_id, NULL);
  END IF;

  INSERT INTO transactions (user_id, type, asset_symbol, amount, net_amount, status, completed_at, metadata)
  VALUES (p_user_id, 'buy_wakati', 'WAKATI', v_wakati_amount, v_wakati_amount, 'completed', now(),
    jsonb_build_object('from_asset', p_from_asset_symbol, 'from_amount_total', v_total_debit,
                       'base_amount', v_base_amount, 'fee_amount', v_fee_amount,
                       'fee_percentage', c_fee_pct, 'exchange_rate', v_rate,
                       'client_wakati_amount', p_wakati_amount,
                       'from_price_usd', v_from_price, 'wakati_price_usd', v_wakati_price,
                       'usd_value', ROUND(v_base_amount * v_from_price, 6)))
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true, 'transaction_id', v_transaction_id, 'from_asset', p_from_asset_symbol,
    'from_amount_total', v_total_debit, 'base_amount', v_base_amount, 'fee_amount', v_fee_amount,
    'fee_percentage', c_fee_pct, 'wakati_credited', v_wakati_amount, 'exchange_rate', v_rate
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM, 'error_code', 'INTERNAL_ERROR');
END;
$function$;
