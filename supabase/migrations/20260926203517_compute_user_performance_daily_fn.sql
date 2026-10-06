-- Agrège les transactions d'un jour donné dans user_performance_daily, par utilisateur et par actif.
--
-- Limitations documentées (volontaires, pour ne pas afficher un faux chiffre) :
-- - opening_balance / closing_balance / net_variation restent à 0 : les reconstruire nécessiterait
--   de rejouer l'effet de chacun des ~29 types de transaction sur le solde, ce qui n'est pas fiable sans
--   audit complet. net_cashflow (flux, pas solde) est en revanche fiable dès maintenant.
-- - transfers_in_amount reste à 0 : le ledger actuel n'enregistre le p2p_transfer que côté envoyeur,
--   pas côté receveur (vérifié sur les données réelles). Seul transfers_out_amount est donc peuplé.
-- - price_usd utilise le cours ACTUEL (asset_prices), pas le cours du jour concerné : acceptable pour
--   une vue d'activité, pas pour un calcul de profit réel.
-- - Certains types (stake, staking_lock, unstake*, loan_collateral_*, balance_adjustment, admin_reclaim,
--   wakati_purchase, buy_wakati, airtime_purchase, score_loan_defaulted) ne sont pas mappés sur une colonne
--   dédiée : ils comptent dans transaction_count mais pas dans les colonnes de catégorie.
create or replace function public.compute_user_performance_daily(p_date date)
returns integer
language plpgsql
as $$
declare
  v_rows integer;
begin
  with day_tx as (
    select t.user_id, t.asset_symbol, t.type, t.status, t.amount
    from public.transactions t
    where t.created_at >= p_date::timestamptz
      and t.created_at < (p_date + 1)::timestamptz
  ),
  agg as (
    select
      user_id,
      asset_symbol,
      count(*) as transaction_count,
      count(*) filter (where status = 'completed') as successful_transaction_count,
      count(*) filter (where status = 'failed') as failed_transaction_count,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'deposit'), 0) as deposits_amount,
      count(*) filter (where status = 'completed' and type = 'deposit') as deposits_count,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'withdrawal'), 0) as withdrawals_amount,
      count(*) filter (where status = 'completed' and type = 'withdrawal') as withdrawals_count,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'referral_bonus'), 0) as rewards_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type in ('fee', 'score_loan_fee')), 0) as fees_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'game_win'), 0) as game_wins_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'game_bet'), 0) as game_losses_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'staking_reward'), 0) as staking_rewards_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'p2p_transfer'), 0) as transfers_out_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'swap_credit'), 0) as swaps_in_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'swap_debit'), 0) as swaps_out_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type in ('loan_borrowed', 'score_loan_borrowed')), 0) as loans_received_amount,
      coalesce(sum(amount) filter (where status = 'completed' and type in ('loan_repaid', 'score_loan_repaid')), 0) as loans_repaid_amount
    from day_tx
    group by user_id, asset_symbol
  )
  insert into public.user_performance_daily (
    user_id, asset_symbol, performance_date,
    deposits_amount, deposits_count, withdrawals_amount, withdrawals_count,
    rewards_amount, fees_amount, game_wins_amount, game_losses_amount,
    staking_rewards_amount, transfers_in_amount, transfers_out_amount,
    swaps_in_amount, swaps_out_amount, loans_received_amount, loans_repaid_amount,
    net_cashflow, price_usd,
    transaction_count, successful_transaction_count, failed_transaction_count
  )
  select
    a.user_id, a.asset_symbol, p_date,
    a.deposits_amount, a.deposits_count, a.withdrawals_amount, a.withdrawals_count,
    a.rewards_amount, a.fees_amount, a.game_wins_amount, a.game_losses_amount,
    a.staking_rewards_amount, 0, a.transfers_out_amount,
    a.swaps_in_amount, a.swaps_out_amount, a.loans_received_amount, a.loans_repaid_amount,
    (a.deposits_amount - a.withdrawals_amount - a.transfers_out_amount
      + a.rewards_amount + a.staking_rewards_amount + a.game_wins_amount - a.game_losses_amount
      - a.fees_amount + a.loans_received_amount - a.loans_repaid_amount),
    (select ap.price_usd from public.asset_prices ap where ap.asset_symbol = a.asset_symbol),
    a.transaction_count, a.successful_transaction_count, a.failed_transaction_count
  from agg a
  on conflict (user_id, asset_symbol, performance_date) do update set
    deposits_amount = excluded.deposits_amount,
    deposits_count = excluded.deposits_count,
    withdrawals_amount = excluded.withdrawals_amount,
    withdrawals_count = excluded.withdrawals_count,
    rewards_amount = excluded.rewards_amount,
    fees_amount = excluded.fees_amount,
    game_wins_amount = excluded.game_wins_amount,
    game_losses_amount = excluded.game_losses_amount,
    staking_rewards_amount = excluded.staking_rewards_amount,
    transfers_out_amount = excluded.transfers_out_amount,
    swaps_in_amount = excluded.swaps_in_amount,
    swaps_out_amount = excluded.swaps_out_amount,
    loans_received_amount = excluded.loans_received_amount,
    loans_repaid_amount = excluded.loans_repaid_amount,
    net_cashflow = excluded.net_cashflow,
    price_usd = excluded.price_usd,
    transaction_count = excluded.transaction_count,
    successful_transaction_count = excluded.successful_transaction_count,
    failed_transaction_count = excluded.failed_transaction_count,
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.compute_user_performance_daily(date) is 'Agrège les transactions d''un jour donné dans user_performance_daily. Idempotent (ON CONFLICT DO UPDATE) : peut être relancé sans dupliquer.';
