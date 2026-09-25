import { getSupabaseAdmin, q } from "@/lib/data";
import { SUCCESS_STATUSES } from "@/lib/transactions";

export type UserPerformanceRow = {
  asset: string;
  deposited: number;
  withdrawn: number;
  current: number;
  netFlow: number;
  variation: number;
  depositsCount: number;
  withdrawalsCount: number;
  rewards: number;
  fees: number;
  gamesNet: number;
  transfersNet: number;
  swapsNet: number;
  loansNet: number;
  priceUsd: number | null;
  currentValueUsd: number | null;
  variationUsd: number | null;
};

type BalanceRow = {
  asset_symbol: string;
  available_balance: number | null;
  staking_balance: number | null;
  pending_balance: number | null;
  total_deposited: number | null;
  total_withdrawn: number | null;
};

type TransactionRow = {
  asset_symbol: string;
  type: string | null;
  amount: number | null;
  fee: number | null;
  status: string | null;
  metadata: { direction?: string } | null;
};

const INFLOWS = new Set([
  "staking_reward",
  "referral_bonus",
  "cashback",
  "refund",
  "loan_borrowed",
  "loan_disbursement",
  "score_loan_borrowed",
  "game_win",
  "lending_reward",
  "reward",
  "bonus",
  "admin_adjustment",
  "balance_correction",
]);

const OUTFLOWS = new Set([
  "fee",
  "game_bet",
  "airtime_purchase",
  "loan_repaid",
  "score_loan_repaid",
  "score_loan_fee",
  "loan_collateral_lock",
  "staking_lock",
  "stake",
  "staking",
]);

const TRANSFER_TYPES = new Set(["transfer", "internal_transfer", "p2p_transfer", "transfer_in", "transfer_out"]);
const SWAP_IN_TYPES = new Set(["swap_in", "swap_credit"]);
const SWAP_OUT_TYPES = new Set(["swap_out", "swap_debit"]);

/**
 * Performance comptable d'un utilisateur, calculée actif par actif depuis les
 * soldes et les transactions réussies. Les quantités de différents actifs ne
 * sont jamais additionnées ; les agrégats multi-actifs sont valorisés en USD.
 */
export async function loadUserPerformance(userId: string): Promise<{ rows: UserPerformanceRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [balances, transactions, prices] = await Promise.all([
    q<BalanceRow>(
      db
        .from("user_balances")
        .select("asset_symbol, available_balance, staking_balance, pending_balance, total_deposited, total_withdrawn")
        .eq("user_id", userId)
    ),
    q<TransactionRow>(
      db
        .from("transactions")
        .select("asset_symbol, type, amount, fee, status, metadata")
        .eq("user_id", userId)
        .in("status", SUCCESS_STATUSES)
    ),
    q<{ asset_symbol: string; price_usd: number | null }>(db.from("asset_prices").select("asset_symbol, price_usd")),
  ]);

  const priceOf = new Map(
    prices.rows.map((row) => [String(row.asset_symbol), Number.isFinite(Number(row.price_usd)) ? Number(row.price_usd) : null])
  );
  const map = new Map<string, UserPerformanceRow>();

  const get = (asset: string) => {
    const existing = map.get(asset);
    if (existing) return existing;
    const row: UserPerformanceRow = {
      asset,
      deposited: 0,
      withdrawn: 0,
      current: 0,
      netFlow: 0,
      variation: 0,
      depositsCount: 0,
      withdrawalsCount: 0,
      rewards: 0,
      fees: 0,
      gamesNet: 0,
      transfersNet: 0,
      swapsNet: 0,
      loansNet: 0,
      priceUsd: priceOf.get(asset) ?? null,
      currentValueUsd: null,
      variationUsd: null,
    };
    map.set(asset, row);
    return row;
  };

  for (const balance of balances.rows) {
    const row = get(String(balance.asset_symbol));
    row.current += Number(balance.available_balance || 0) + Number(balance.staking_balance || 0) + Number(balance.pending_balance || 0);
    row.deposited += Number(balance.total_deposited || 0);
    row.withdrawn += Number(balance.total_withdrawn || 0);
  }

  for (const transaction of transactions.rows) {
    const type = String(transaction.type || "");
    const amount = Number(transaction.amount || 0);
    const fee = Number(transaction.fee || 0);
    const row = get(String(transaction.asset_symbol));

    if (type === "deposit") {
      row.deposited += amount;
      row.depositsCount += 1;
    }
    if (type === "withdrawal") {
      row.withdrawn += amount;
      row.withdrawalsCount += 1;
    }

    if (INFLOWS.has(type)) row.rewards += amount;
    if (OUTFLOWS.has(type)) row.rewards -= amount;
    if (type === "fee" || type.endsWith("_fee")) row.fees += amount || fee;

    if (type === "game_win") row.gamesNet += amount;
    if (type === "game_bet") row.gamesNet -= amount;

    if (TRANSFER_TYPES.has(type)) {
      const explicitDirection = transaction.metadata?.direction;
      const direction = explicitDirection || (type === "transfer_out" ? "out" : type === "transfer_in" ? "in" : "in");
      row.transfersNet += direction === "out" ? -amount : amount;
    }

    if (SWAP_IN_TYPES.has(type)) row.swapsNet += amount;
    if (SWAP_OUT_TYPES.has(type)) row.swapsNet -= amount;
    if (type === "loan_borrowed" || type === "loan_disbursement" || type === "score_loan_borrowed") row.loansNet += amount;
    if (type === "loan_repaid" || type === "score_loan_repaid") row.loansNet -= amount;
  }

  for (const row of map.values()) {
    row.netFlow = row.deposited - row.withdrawn;
    row.variation = row.current + row.withdrawn - row.deposited;
    row.currentValueUsd = row.priceUsd === null ? null : row.current * row.priceUsd;
    row.variationUsd = row.priceUsd === null ? null : row.variation * row.priceUsd;
  }

  const rows = [...map.values()]
    .filter((row) => row.current !== 0 || row.deposited !== 0 || row.withdrawn !== 0)
    .sort((a, b) => a.asset.localeCompare(b.asset));
  const error = [balances.error, transactions.error, prices.error].filter(Boolean).join(" · ") || undefined;
  return { rows, error };
}
