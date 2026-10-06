import { fetchAll, getSupabaseAdmin, loadPrices } from "@/lib/data";
import { SUCCESS_STATUSES } from "@/lib/transactions";
import { isValidPrice } from "./pricing";
import { loadFeeTotalsByAsset } from "./fees";
import type { AnalyticsMetrics, UserRiskScore } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/**
 * KPI utilisateurs / cashflow de la page Analytics.
 * - Valorisation au cours actuel, actif par actif ; un actif sans prix valide est exclu et listé dans `unpriced`.
 * - Frais : règle unique de ./rules (hors test, hors game_house_edge, hors game_net_loss).
 * - Risque : dernier score de user_risk_score_history par utilisateur (historique append-only).
 */
export async function loadAnalyticsMetrics(): Promise<AnalyticsMetrics> {
  const db = getSupabaseAdmin();

  const [users, balances, transactions, price, fees, risks] = await Promise.all([
    fetchAll<any>((a, b) => db.from("users").select("id, username, created_at, updated_at").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("transactions").select("user_id, asset_symbol, type, amount, status, created_at").order("id").range(a, b)),
    loadPrices(),
    loadFeeTotalsByAsset(),
    fetchAll<any>((a, b) =>
      db
        .from("user_risk_score_history")
        .select("user_id, score, level, calculated_at")
        .order("calculated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b)
    ),
  ]);

  const unpriced = new Set<string>();
  const toUsd = (asset: string, quantity: number): number => {
    const p = price.get(asset);
    if (!isValidPrice(p)) {
      if (quantity > 0) unpriced.add(asset);
      return 0;
    }
    return quantity * p;
  };

  const latestRisk = new Map<string, any>();
  for (const row of risks.rows) {
    if (!latestRisk.has(row.user_id)) latestRisk.set(row.user_id, row);
  }

  const currentByUser = new Map<string, number>();
  for (const row of balances.rows) {
    const quantity = Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0);
    currentByUser.set(row.user_id, (currentByUser.get(row.user_id) ?? 0) + toUsd(String(row.asset_symbol), quantity));
  }

  const successful = transactions.rows.filter((row) => SUCCESS_STATUSES.includes(String(row.status)));
  const sumByType = (type: string) =>
    successful.filter((row) => row.type === type).reduce((sum, row) => sum + toUsd(String(row.asset_symbol), Number(row.amount || 0)), 0);
  const deposits = sumByType("deposit");
  const withdrawals = sumByType("withdrawal");

  let feesTotal = 0;
  for (const [asset, total] of fees.totals) feesTotal += toUsd(asset, total);

  const now = Date.now();
  const active = new Set(
    successful.filter((row) => row.created_at && now - new Date(row.created_at).getTime() <= 30 * DAY).map((row) => row.user_id)
  );
  const risky = [...latestRisk.values()].filter(
    (row) => Number(row.score || 0) >= 50 || ["high", "critical"].includes(String(row.level || "").toLowerCase())
  ).length;

  const topUsers = users.rows
    .map((user) => {
      const risk = latestRisk.get(user.id);
      const riskScore: UserRiskScore | null = risk
        ? {
            userId: user.id,
            username: user.username,
            score: Number(risk.score || 0),
            level: String(risk.level || "normal").toLowerCase() as UserRiskScore["level"],
            lastCalculated: risk.calculated_at ?? null,
          }
        : null;
      return { userId: user.id, username: user.username, valueUsd: currentByUser.get(user.id) ?? 0, lastActivity: user.updated_at ?? null, riskScore };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 25);

  const errors = [users.error, balances.error, transactions.error, fees.error, risks.error].filter(Boolean).join(" · ");

  return {
    users: {
      total: users.rows.length,
      active30d: active.size,
      withBalances: new Set(balances.rows.map((r) => r.user_id)).size,
      totalValueUsd: [...currentByUser.values()].reduce((a, b) => a + b, 0),
      atRisk: risky,
    },
    cashflow: {
      depositsUsd: deposits,
      withdrawalsUsd: withdrawals,
      netUsd: deposits - withdrawals,
      successfulCount: successful.length,
    },
    fees: {
      totalUsd: feesTotal,
      fromPlatformFeesTable: feesTotal,
    },
    topUsers,
    unpriced: [...unpriced],
    truncated: !!(users.truncated || balances.truncated || transactions.truncated || fees.truncated || risks.truncated),
    errors: errors || undefined,
  };
}
