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
  priceUsd: number | null;
  variationUsd: number | null;
};

const INFLOWS = new Set(["deposit", "staking_reward", "referral_bonus", "cashback", "refund", "loan_borrowed", "loan_disbursement", "score_loan_borrowed", "game_win", "lending_reward"]);
const OUTFLOWS = new Set(["withdrawal", "fee", "game_bet", "airtime_purchase", "loan_repaid", "score_loan_repaid", "score_loan_fee", "loan_collateral_lock", "staking_lock", "stake", "staking"]);

/** Performance comptable d'un utilisateur, calculée actif par actif depuis les transactions réussies. */
export async function loadUserPerformance(userId: string): Promise<{ rows: UserPerformanceRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [balances, transactions, prices] = await Promise.all([
    q<any>(db.from("user_balances").select("asset_symbol, available_balance, staking_balance, pending_balance, total_deposited, total_withdrawn").eq("user_id", userId)),
    q<any>(db.from("transactions").select("asset_symbol, type, amount, fee, status").eq("user_id", userId).in("status", SUCCESS_STATUSES)),
    q<any>(db.from("asset_prices").select("asset_symbol, price_usd"))
  ]);

  const priceOf = new Map(prices.rows.map((row) => [String(row.asset_symbol), Number(row.price_usd)]));
  const map = new Map<string, UserPerformanceRow>();
  const get = (asset: string) => {
    const existing = map.get(asset);
    if (existing) return existing;
    const row: UserPerformanceRow = { asset, deposited: 0, withdrawn: 0, current: 0, netFlow: 0, variation: 0, depositsCount: 0, withdrawalsCount: 0, rewards: 0, fees: 0, gamesNet: 0, transfersNet: 0, priceUsd: priceOf.has(asset) ? priceOf.get(asset)! : null, variationUsd: null };
    map.set(asset, row);
    return row;
  };

  for (const balance of balances.rows) {
    const row = get(String(balance.asset_symbol));
    row.current += Number(balance.available_balance || 0) + Number(balance.staking_balance || 0) + Number(balance.pending_balance || 0);
    row.deposited += Number(balance.total_deposited || 0);
    row.withdrawn += Number(balance.total_withdrawn || 0);
  }

  for (const tx of transactions.rows) {
    const type = String(tx.type || "");
    const amount = Number(tx.amount || 0);
    const fee = Number(tx.fee || 0);
    const row = get(String(tx.asset_symbol));
    if (type === "deposit") { row.deposited += amount; row.depositsCount++; }
    if (type === "withdrawal") { row.withdrawn += amount; row.withdrawalsCount++; }
    if (INFLOWS.has(type) && type !== "deposit") row.rewards += amount;
    if (OUTFLOWS.has(type) && type !== "withdrawal") row.rewards -= amount;
    if (type === "fee" || type.endsWith("_fee")) row.fees += amount || fee;
    if (type === "game_win") row.gamesNet += amount;
    if (type === "game_bet") row.gamesNet -= amount;
    if (type === "transfer" || type === "internal_transfer" || type === "p2p_transfer") row.transfersNet += Number(tx.metadata?.direction === "out" ? -amount : amount);
  }

  for (const row of map.values()) {
    row.netFlow = row.deposited - row.withdrawn;
    row.variation = row.current + row.withdrawn - row.deposited;
    row.variationUsd = row.priceUsd === null ? null : row.variation * row.priceUsd;
  }

  return { rows: [...map.values()].filter((row) => row.current !== 0 || row.deposited !== 0 || row.withdrawn !== 0).sort((a, b) => a.asset.localeCompare(b.asset)), error: [balances.error, transactions.error, prices.error].filter(Boolean).join(" · ") || undefined };
}
