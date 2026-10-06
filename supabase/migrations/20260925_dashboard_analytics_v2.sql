-- Phase 2 data layer aligned with the production schema and public functions.
-- This migration is additive and keeps the raw transaction ledger authoritative.

CREATE INDEX IF NOT EXISTS transactions_user_asset_status_created_idx
  ON public.transactions (user_id, asset_symbol, status, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_type_status_created_idx
  ON public.transactions (type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS transactions_metadata_external_reference_idx
  ON public.transactions ((metadata->>'external_reference'))
  WHERE metadata ? 'external_reference';

CREATE INDEX IF NOT EXISTS platform_fees_user_collected_idx
  ON public.platform_fees (source_user_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS platform_fees_type_collected_idx
  ON public.platform_fees (fee_type, collected_at DESC);

CREATE INDEX IF NOT EXISTS user_balances_user_asset_idx
  ON public.user_balances (user_id, asset_symbol);

CREATE OR REPLACE VIEW public.admin_user_asset_performance AS
WITH asset_keys AS (
  SELECT user_id, asset_symbol FROM public.user_balances
  UNION
  SELECT user_id, asset_symbol FROM public.transactions
), balances AS (
  SELECT
    user_id,
    asset_symbol,
    SUM(COALESCE(available_balance, 0)) AS available_balance,
    SUM(COALESCE(staking_balance, 0)) AS staking_balance,
    SUM(COALESCE(pending_balance, 0)) AS pending_balance,
    SUM(COALESCE(total_deposited, 0)) AS recorded_total_deposited,
    SUM(COALESCE(total_withdrawn, 0)) AS recorded_total_withdrawn,
    SUM(COALESCE(total_earned_staking, 0)) AS recorded_staking_rewards
  FROM public.user_balances
  GROUP BY user_id, asset_symbol
), completed AS (
  SELECT
    user_id,
    asset_symbol,
    SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) AS deposits_amount,
    COUNT(*) FILTER (WHERE type = 'deposit') AS deposits_count,
    SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) AS withdrawals_amount,
    COUNT(*) FILTER (WHERE type = 'withdrawal') AS withdrawals_count,
    SUM(CASE WHEN type IN ('staking_reward', 'referral_bonus', 'cashback', 'refund', 'dividend_payment', 'lending_reward', 'reward', 'bonus') THEN amount ELSE 0 END) AS rewards_amount,
    SUM(CASE WHEN type IN ('fee', 'platform_fee') OR type LIKE '%_fee' THEN COALESCE(NULLIF(amount, 0), fee, 0) ELSE 0 END) AS fees_amount,
    SUM(CASE WHEN type = 'game_win' THEN amount ELSE 0 END) AS game_wins_amount,
    SUM(CASE WHEN type = 'game_bet' THEN amount ELSE 0 END) AS game_losses_amount,
    SUM(CASE WHEN type IN ('staking_reward', 'dividend_payment', 'lending_reward') THEN amount ELSE 0 END) AS staking_rewards_amount,
    SUM(CASE WHEN type IN ('transfer_in') OR (type IN ('transfer', 'p2p_transfer') AND COALESCE(metadata->>'direction', 'in') = 'in') THEN amount ELSE 0 END) AS transfers_in_amount,
    SUM(CASE WHEN type IN ('transfer_out') OR (type IN ('transfer', 'p2p_transfer') AND metadata->>'direction' = 'out') THEN amount ELSE 0 END) AS transfers_out_amount,
    SUM(CASE WHEN type IN ('swap_credit', 'swap_in') THEN amount ELSE 0 END) AS swaps_in_amount,
    SUM(CASE WHEN type IN ('swap_debit', 'swap_out') THEN amount ELSE 0 END) AS swaps_out_amount,
    SUM(CASE WHEN type IN ('loan_borrowed', 'loan_disbursement', 'score_loan_borrowed') THEN amount ELSE 0 END) AS loans_received_amount,
    SUM(CASE WHEN type IN ('loan_repaid', 'score_loan_repaid') THEN amount ELSE 0 END) AS loans_repaid_amount,
    COUNT(*) AS successful_transaction_count,
    MIN(created_at) AS first_transaction_at,
    MAX(created_at) AS last_transaction_at
  FROM public.transactions
  WHERE status IN ('completed', 'succeeded', 'success', 'successful')
  GROUP BY user_id, asset_symbol
), all_transactions AS (
  SELECT user_id, asset_symbol, COUNT(*) AS transaction_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_transaction_count
  FROM public.transactions
  GROUP BY user_id, asset_symbol
)
SELECT
  k.user_id,
  k.asset_symbol,
  COALESCE(b.available_balance, 0) AS available_balance,
  COALESCE(b.staking_balance, 0) AS staking_balance,
  COALESCE(b.pending_balance, 0) AS pending_balance,
  COALESCE(b.available_balance, 0) + COALESCE(b.staking_balance, 0) + COALESCE(b.pending_balance, 0) AS current_balance,
  COALESCE(b.recorded_total_deposited, 0) + COALESCE(c.deposits_amount, 0) AS deposited_amount,
  COALESCE(b.recorded_total_withdrawn, 0) + COALESCE(c.withdrawals_amount, 0) AS withdrawn_amount,
  COALESCE(c.deposits_amount, 0) + COALESCE(c.transfers_in_amount, 0) + COALESCE(c.rewards_amount, 0) + COALESCE(c.loans_received_amount, 0)
    - COALESCE(c.withdrawals_amount, 0) - COALESCE(c.transfers_out_amount, 0) - COALESCE(c.fees_amount, 0) - COALESCE(c.loans_repaid_amount, 0) AS net_activity_amount,
  COALESCE(c.deposits_amount, 0) AS deposits_amount,
  COALESCE(c.deposits_count, 0)::integer AS deposits_count,
  COALESCE(c.withdrawals_amount, 0) AS withdrawals_amount,
  COALESCE(c.withdrawals_count, 0)::integer AS withdrawals_count,
  COALESCE(c.rewards_amount, 0) AS rewards_amount,
  COALESCE(b.recorded_staking_rewards, 0) + COALESCE(c.staking_rewards_amount, 0) AS staking_rewards_amount,
  COALESCE(c.fees_amount, 0) AS fees_amount,
  COALESCE(c.game_wins_amount, 0) AS game_wins_amount,
  COALESCE(c.game_losses_amount, 0) AS game_losses_amount,
  COALESCE(c.transfers_in_amount, 0) AS transfers_in_amount,
  COALESCE(c.transfers_out_amount, 0) AS transfers_out_amount,
  COALESCE(c.swaps_in_amount, 0) AS swaps_in_amount,
  COALESCE(c.swaps_out_amount, 0) AS swaps_out_amount,
  COALESCE(c.loans_received_amount, 0) AS loans_received_amount,
  COALESCE(c.loans_repaid_amount, 0) AS loans_repaid_amount,
  COALESCE(a.transaction_count, 0)::integer AS transaction_count,
  COALESCE(c.successful_transaction_count, 0)::integer AS successful_transaction_count,
  COALESCE(a.failed_transaction_count, 0)::integer AS failed_transaction_count,
  p.price_usd,
  (COALESCE(b.available_balance, 0) + COALESCE(b.staking_balance, 0) + COALESCE(b.pending_balance, 0)) * p.price_usd AS current_value_usd,
  c.first_transaction_at,
  c.last_transaction_at
FROM asset_keys k
LEFT JOIN balances b ON b.user_id = k.user_id AND b.asset_symbol = k.asset_symbol
LEFT JOIN completed c ON c.user_id = k.user_id AND c.asset_symbol = k.asset_symbol
LEFT JOIN all_transactions a ON a.user_id = k.user_id AND a.asset_symbol = k.asset_symbol
LEFT JOIN public.asset_prices p ON p.asset_symbol = k.asset_symbol;

CREATE OR REPLACE VIEW public.admin_user_financial_summary AS
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  u.country_code,
  u.is_verified,
  u.email_confirmed,
  u.profile_completed,
  u.created_at,
  u.updated_at,
  COALESCE(SUM(p.current_value_usd), 0) AS current_value_usd,
  COALESCE(SUM(p.deposited_amount * COALESCE(p.price_usd, 0)), 0) AS deposited_value_usd,
  COALESCE(SUM(p.withdrawn_amount * COALESCE(p.price_usd, 0)), 0) AS withdrawn_value_usd,
  COALESCE(SUM(p.fees_amount * COALESCE(p.price_usd, 0)), 0) AS fees_value_usd,
  COALESCE(SUM(p.rewards_amount * COALESCE(p.price_usd, 0)), 0) AS rewards_value_usd,
  COALESCE(SUM(p.transaction_count), 0)::integer AS transaction_count,
  MAX(p.last_transaction_at) AS last_transaction_at
FROM public.users u
LEFT JOIN public.admin_user_asset_performance p ON p.user_id = u.id
GROUP BY u.id, u.username, u.email, u.country_code, u.is_verified, u.email_confirmed, u.profile_completed, u.created_at, u.updated_at;

COMMENT ON VIEW public.admin_user_asset_performance IS 'Admin analytics per user and asset, derived from the authoritative balance and completed transaction ledger.';
COMMENT ON VIEW public.admin_user_financial_summary IS 'Admin financial summary with multi-asset totals expressed in USD.';
