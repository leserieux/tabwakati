import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { loadPnl } from "@/lib/pnl";
import { computeCoverage, isValidPrice } from "./pricing";
import type { FeesMetrics, LiquidityMetrics, OverviewMetrics, RiskMetrics, UserMetrics, VolumeMetrics } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const EPS = 0.00000001;

type DayBucket = { key: string; label: string; volume: number; count: number };

function makeDays(now: number): DayBucket[] {
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(now - (6 - index) * DAY);
    return {
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" }),
      volume: 0,
      count: 0,
    };
  });
}

function normalizeNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function loadOverviewMetrics(): Promise<OverviewMetrics> {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const since24h = new Date(now - DAY).toISOString();
  const days = makeDays(now);
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const [users, volume, loans, recent, wallets, liabilities, assets, recon, fees, pending, failed, prices, stuck, sweepFails, paused, pnl30] = await Promise.all([
    q<any>(db.from("admin_users_overview").select("id, username, created_at, last_activity_at")),
    db.rpc("admin_volume_daily", { p_days: 7 }),
    q<{ loans_a_risque: number; score_loans_a_risque: number }>(db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque")),
    q<any>(db.from("transactions").select("id, user_id, type, asset_symbol, amount, status, created_at").order("created_at", { ascending: false }).limit(8)),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance")),
    q<any>(db.rpc("get_asset_liabilities")),
    (async () => {
      const { rows, error } = await q<any>(db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance"));
      return { rows, error };
    })(),
    db.rpc("get_admin_reconciliation"),
    db.rpc("get_platform_fees_totals"),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    loadPrices(),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]).lt("created_at", stuckBefore),
    db.from("sweep_log").select("id", { count: "exact", head: true }).neq("status", "swept").eq("dry_run", false).gte("created_at", since7d),
    q<any>(db.from("supported_assets").select("symbol").eq("can_be_deposited", false)),
    loadPnl(30).catch(() => null),
  ]);

  const volumeRows = ((volume.data as any[]) || []) as any[];
  let gamesWagered7d = 0;
  for (const row of volumeRows) {
    if (row.category === "game") {
      gamesWagered7d += Number(row.volume_usd || 0);
      continue;
    }
    const day = days.find((item) => item.key === String(row.day).slice(0, 10));
    if (day) {
      day.volume += Number(row.volume_usd || 0);
      day.count += Number(row.tx_count || 0);
    }
  }

  const totalUsers = users.rows.length;
  const activeUsers7d = users.rows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const newUsers7d = users.rows.filter((u) => u.created_at && u.created_at >= since7d).length;

  const walletByAsset = new Map(wallets.rows.map((row: any) => [String(row.asset_symbol), Number(row.balance || 0)]));
  const liabByAsset = new Map(liabilities.rows.map((row: any) => [String(row.asset_symbol), Number(row.total_liability || 0)]));
  const allSymbols = [...new Set([...walletByAsset.keys(), ...liabByAsset.keys()])];
  const cov = computeCoverage(
    allSymbols.map((asset) => ({
      asset,
      owed: liabByAsset.get(asset) || 0,
      held: walletByAsset.get(asset) || 0,
      price: prices.get(asset) ?? null,
    }))
  );

  const feeRows = (((fees.data as any[]) || []) as any[]).map((row) => {
    const asset = String(row.asset_symbol);
    const total = Number(row.total_fees || 0);
    const price = prices.get(asset) ?? null;
    return { asset, total, usd: isValidPrice(price) ? total * price : null };
  }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));

  const feesMetrics: FeesMetrics = {
    totalUsd: feeRows.reduce((sum, row) => sum + (row.usd ?? 0), 0),
    byAsset: feeRows.map((row) => ({ asset: row.asset, total: row.total, usd: row.usd })),
    unpriced: feeRows.filter((row) => row.usd === null && row.total > 0).map((row) => row.asset),
  };

  const volumeMetrics: VolumeMetrics = {
    volume7d: days.reduce((sum, d) => sum + d.volume, 0),
    volume24h: days[days.length - 1]?.volume ?? 0,
    transactionCount7d: days.reduce((sum, d) => sum + d.count, 0),
    gamesWagered7d,
    byDay: days.map((d) => ({ key: d.key, volume: d.volume, count: d.count })),
  };

  const liquidityMetrics: LiquidityMetrics = {
    heldUsd: cov.heldUsd,
    owedUsd: cov.owedUsd,
    coveredUsd: cov.coveredUsd,
    missingUsd: cov.missingUsd,
    coveragePct: Number.isNaN(cov.coveragePct) ? null : cov.coveragePct,
    unpriced: cov.unpriced,
  };

  const riskMetrics: RiskMetrics = {
    loansAtRisk: (() => {
      const creditSummary = loans.rows[0];
      return Number(creditSummary?.loans_a_risque || 0) + Number(creditSummary?.score_loans_a_risque || 0);
    })(),
    pendingTransactions: pending.count || 0,
    stuckTransactions: stuck.count || 0,
    failedTransactions24h: failed.count || 0,
    negativeBalances: ((recon.data as any[]) || []).filter((row) => Number(row.negative_rows || 0) > 0).map((row) => ({
      asset: String(row.asset_symbol),
      count: Number(row.negative_rows || 0),
    })),
    reconciliationIssues: ((recon.data as any[]) || []).filter((row) => Math.abs(Number(row.liability_diff || 0)) > EPS || Math.abs(Number(row.staking_orphan || 0)) > EPS).map((row) => ({
      asset: String(row.asset_symbol),
      liabilityDiff: Number(row.liability_diff || 0),
      negativeBal: Number(row.negative_rows || 0),
      stakingOrphan: Number(row.staking_orphan || 0),
    })),
  };

  const usersMetrics: UserMetrics = {
    totalUsers,
    activeUsers7d,
    newUsers7d,
    emailConfirmed: 0,
    kycCompleted: 0,
  };

  const queryErrors = [users.error, volume.error?.message, loans.error, recent.error, wallets.error, liabilities.error, assets.error, recon.error?.message, fees.error?.message].filter(Boolean).join(" · ");

  return {
    timestamp: new Date().toISOString(),
    users: usersMetrics,
    liquidity: liquidityMetrics,
    volume: volumeMetrics,
    fees: feesMetrics,
    risk: riskMetrics,
    errors: queryErrors || undefined,
  };
}

export async function loadOverviewMetricsLegacyCompatible() {
  return loadOverviewMetrics();
}
