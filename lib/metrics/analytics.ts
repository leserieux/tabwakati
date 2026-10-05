import { getSupabaseAdmin, fetchAll, loadPrices, q } from "@/lib/data";
import { isValidPrice } from "./pricing";
import type { AnalyticsMetrics } from "./types";

const DAY = 24 * 60 * 60 * 1000;

const SUCCESS = ["completed", "succeeded", "success", "successful"];

export async function loadAnalyticsMetrics(): Promise<AnalyticsMetrics> {
  const db = getSupabaseAdmin();

  const [users, balances, transactions, priceMap, fees, risks] = await Promise.all([
    fetchAll<any>((a, b) => db.from("users").select("id, username, created_at, updated_at").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("transactions").select("user_id, asset_symbol, type, amount, fee, status, created_at").order("id").range(a, b)),
    loadPrices(),
    fetchAll<any>((a, b) => db.from("platform_fees").select("asset_symbol, amount, fee_type, collected_at, is_test").order("id").range(a, b)),
    q<any>(db.from("user_risk_score_history").select("user_id, score, level, calculated_at").order("calculated_at", { ascending: false })),
  ]);

  const price = priceMap;
  const latestRisk = new Map<string, any>();
  for (const row of risks.rows) {
    if (!latestRisk.has(row.user_id)) {
      latestRisk.set(row.user_id, row);
    }
  }

  const currentByUser = new Map<string, number>();
  for (const row of balances.rows) {
    const current = Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0);
    currentByUser.set(row.user_id, (currentByUser.get(row.user_id) || 0) + current * (isValidPrice(price.get(row.asset_symbol)) ? price.get(row.asset_symbol)! : 0));
  }

  const successful = transactions.rows.filter((row) => SUCCESS.includes(String(row.status)));
  const deposits = successful
    .filter((row) => row.type === "deposit")
    .reduce((sum, row) => sum + Number(row.amount || 0) * (isValidPrice(price.get(row.asset_symbol)) ? price.get(row.asset_symbol)! : 0), 0);
  const withdrawals = successful
    .filter((row) => row.type === "withdrawal")
    .reduce((sum, row) => sum + Number(row.amount || 0) * (isValidPrice(price.get(row.asset_symbol)) ? price.get(row.asset_symbol)! : 0), 0);
  const feesTotal = fees.rows
    .filter((row: any) => !row.is_test && row.fee_type !== "game_net_loss")
    .reduce((sum, row) => sum + Number(row.amount || 0) * (isValidPrice(price.get(row.asset_symbol)) ? price.get(row.asset_symbol)! : 0), 0);

  const now = Date.now();
  const active = new Set(
    successful
      .filter((row) => row.created_at && Date.now() - new Date(row.created_at).getTime() <= 30 * 86400000)
      .map((row) => row.user_id)
  );
  const risky = [...latestRisk.values()].filter((row) => Number(row.score || 0) >= 50 || ["high", "critical"].includes(String(row.level || "").toLowerCase())).length;
  const errors = [users.error, balances.error, transactions.error, fees.error, risks.error].filter(Boolean).join(" · ");
  const topUsers = users.rows
    .map((user) => ({
      userId: user.id,
      username: user.username,
      valueUsd: currentByUser.get(user.id) || 0,
      lastActivity: user.updated_at,
      riskScore: latestRisk.has(user.id)
        ? {
            userId: user.id,
            username: user.username,
            score: Number(latestRisk.get(user.id)!.score || 0),
            level: String(latestRisk.get(user.id)!.level || "low").toLowerCase() as "low" | "medium" | "high" | "critical",
            lastCalculated: latestRisk.get(user.id)!.calculated_at,
          }
        : null,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 25);

  return {
    users: {
      total: users.rows.length,
      active30d: active.size,
      withBalances: new Set(balances.rows.map((r) => r.user_id)).size,
      atRisk: risky,
    },
    cashflow: {
      depositsUsd: deposits,
      withdrawalsUsd: withdrawals,
      netUsd: deposits - withdrawals,
    },
    fees: {
      totalUsd: feesTotal,
      fromPlatformFeesTable: feesTotal,
    },
    topUsers,
    errors: errors || undefined,
  };
}
