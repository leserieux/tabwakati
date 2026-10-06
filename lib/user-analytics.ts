import { getSupabaseAdmin, q } from "@/lib/data";
import { SUCCESS_STATUSES } from "@/lib/transactions";

export type AnalyticsWindow = "7d" | "30d" | "90d";

export type UserWindowSummary = {
  window: AnalyticsWindow;
  deposits: number;
  withdrawals: number;
  netCashflow: number;
  transactionCount: number;
  successfulCount: number;
  failedCount: number;
  depositCount: number;
  withdrawalCount: number;
  fees: number;
  rewards: number;
  transfersIn: number;
  transfersOut: number;
  swapsIn: number;
  swapsOut: number;
  ratio: number | null;
};

type Tx = {
  type: string | null;
  amount: number | null;
  fee: number | null;
  status: string | null;
  created_at: string | null;
  metadata: { direction?: string } | null;
};

const REWARD_TYPES = new Set(["staking_reward", "referral_bonus", "cashback", "refund", "reward", "bonus", "lending_reward", "game_win"]);
const TRANSFER_TYPES = new Set(["transfer", "internal_transfer", "p2p_transfer", "transfer_in", "transfer_out"]);

function empty(window: AnalyticsWindow): UserWindowSummary {
  return { window, deposits: 0, withdrawals: 0, netCashflow: 0, transactionCount: 0, successfulCount: 0, failedCount: 0, depositCount: 0, withdrawalCount: 0, fees: 0, rewards: 0, transfersIn: 0, transfersOut: 0, swapsIn: 0, swapsOut: 0, ratio: null };
}

/** Résumé comportemental sur des fenêtres fixes, sans prétendre calculer un P&L réel. */
export async function loadUserWindowSummaries(userId: string): Promise<{ rows: UserWindowSummary[]; error?: string }> {
  const result = await q<Tx>(
    getSupabaseAdmin()
      .from("transactions")
      .select("type, amount, fee, status, created_at, metadata")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString())
  );
  const windows: Record<AnalyticsWindow, UserWindowSummary> = { "7d": empty("7d"), "30d": empty("30d"), "90d": empty("90d") };
  const now = Date.now();

  for (const tx of result.rows) {
    const timestamp = tx.created_at ? new Date(tx.created_at).getTime() : NaN;
    if (!Number.isFinite(timestamp)) continue;
    const age = now - timestamp;
    const targets = (Object.keys(windows) as AnalyticsWindow[]).filter((window) => age <= Number(window.slice(0, -1)) * 24 * 3600 * 1000);
    const type = String(tx.type || "");
    const amount = Number(tx.amount || 0);
    const fee = Number(tx.fee || 0);
    for (const key of targets) {
      const row = windows[key];
      row.transactionCount += 1;
      if (SUCCESS_STATUSES.includes(String(tx.status))) row.successfulCount += 1;
      if (String(tx.status) === "failed") row.failedCount += 1;
      if (type === "deposit") { row.deposits += amount; row.depositCount += 1; }
      if (type === "withdrawal") { row.withdrawals += amount; row.withdrawalCount += 1; }
      if (type === "fee" || type.endsWith("_fee")) row.fees += amount || fee;
      if (REWARD_TYPES.has(type)) row.rewards += amount;
      if (TRANSFER_TYPES.has(type)) {
        const direction = tx.metadata?.direction || (type === "transfer_out" ? "out" : "in");
        if (direction === "out") row.transfersOut += amount; else row.transfersIn += amount;
      }
      if (type === "swap_in" || type === "swap_credit") row.swapsIn += amount;
      if (type === "swap_out" || type === "swap_debit") row.swapsOut += amount;
    }
  }
  for (const row of Object.values(windows)) {
    row.netCashflow = row.deposits - row.withdrawals;
    row.ratio = row.withdrawals > 0 ? row.deposits / row.withdrawals : row.deposits > 0 ? null : 0;
  }
  return { rows: Object.values(windows), error: result.error };
}
