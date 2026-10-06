import { fetchAll, getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { computeCoverage, isValidPrice } from "./pricing";
import { loadAssetsMetrics } from "./assets";
import { loadFeeTotalsByAsset } from "./fees";
import type { FeesMetrics, LiquidityMetrics, OverviewMetrics, RecentTransaction, RiskMetrics, UserMetrics, VolumeMetrics } from "./types";

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

export async function loadOverviewMetrics(): Promise<OverviewMetrics> {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const since24h = new Date(now - DAY).toISOString();
  const days = makeDays(now);
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  // Les prix sont chargés une seule fois et partagés avec la couche « actifs ».
  const pricesPromise = loadPrices();

  const [users, volume, loans, recent, liabilities, assetsM, recon, fees, pending, failed, prices, stuck, emailConfirmed, kycApproved] = await Promise.all([
    fetchAll<any>((a, b) => db.from("admin_users_overview").select("id, username, created_at, last_activity_at").order("id").range(a, b)),
    db.rpc("admin_volume_daily", { p_days: 7 }),
    q<{ loans_a_risque: number; score_loans_a_risque: number }>(db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque")),
    q<any>(db.from("transactions").select("id, user_id, type, asset_symbol, amount, status, created_at").order("created_at", { ascending: false }).limit(8)),
    q<any>(db.rpc("get_asset_liabilities")),
    pricesPromise.then((p) => loadAssetsMetrics(p)),
    db.rpc("get_admin_reconciliation"),
    loadFeeTotalsByAsset(),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    pricesPromise,
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]).lt("created_at", stuckBefore),
    db.from("users").select("id", { count: "exact", head: true }).eq("email_confirmed", true),
    db.from("user_kyc").select("user_id", { count: "exact", head: true }).eq("verification_status", "approved"),
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
  const activeUsers7d = users.rows.filter((u: any) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const newUsers7d = users.rows.filter((u: any) => u.created_at && u.created_at >= since7d).length;

  // Couverture : détenu (trésorerie) vs dû (passifs), actif par actif.
  const walletByAsset = new Map<string, number>(assetsM.treasury.map((t: { asset: string; balanceNative: number }): [string, number] => [t.asset, t.balanceNative]));
  const liabByAsset = new Map<string, number>(liabilities.rows.map((row: any): [string, number] => [String(row.asset_symbol), Number(row.total_liability || 0)]));
  const allSymbols: string[] = [...new Set<string>([...walletByAsset.keys(), ...liabByAsset.keys()])];
  const cov = computeCoverage(
    allSymbols.map((asset) => ({
      asset,
      owed: liabByAsset.get(asset) ?? 0,
      held: walletByAsset.get(asset) ?? 0,
      price: prices.get(asset) ?? null,
    }))
  );

  // Frais : règle unique (hors test, hors game_house_edge, hors game_net_loss), cf. ./rules.
  const feeRows = [...fees.totals.entries()]
    .map(([asset, total]) => {
      const price = prices.get(asset) ?? null;
      return { asset, total, usd: isValidPrice(price) ? total * price : null };
    })
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));

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

  const reconRows = ((recon.data as any[]) || []) as any[];
  const riskMetrics: RiskMetrics = {
    loansAtRisk: (() => {
      const creditSummary = loans.rows[0];
      return Number(creditSummary?.loans_a_risque || 0) + Number(creditSummary?.score_loans_a_risque || 0);
    })(),
    pendingTransactions: pending.count || 0,
    stuckTransactions: stuck.count || 0,
    failedTransactions24h: failed.count || 0,
    negativeBalances: reconRows
      .filter((row) => Number(row.negative_rows || 0) > 0)
      .map((row) => ({ asset: String(row.asset_symbol), count: Number(row.negative_rows || 0) })),
    reconciliationIssues: reconRows
      .filter((row) => Math.abs(Number(row.liability_diff || 0)) > EPS || Math.abs(Number(row.staking_orphan || 0)) > EPS)
      .map((row) => ({
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
    emailConfirmed: emailConfirmed.count ?? 0,
    kycCompleted: kycApproved.count ?? 0,
  };

  const recentTransactions: RecentTransaction[] = recent.rows.map((r: any) => ({
    id: String(r.id),
    userId: String(r.user_id),
    type: String(r.type),
    asset: String(r.asset_symbol),
    amount: Number(r.amount || 0),
    status: r.status ?? null,
    createdAt: String(r.created_at),
  }));

  const queryErrors = [
    users.error,
    volume.error?.message,
    loans.error,
    recent.error,
    liabilities.error,
    assetsM.error,
    recon.error?.message,
    fees.error,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    timestamp: new Date().toISOString(),
    users: usersMetrics,
    liquidity: liquidityMetrics,
    volume: volumeMetrics,
    fees: feesMetrics,
    risk: riskMetrics,
    assets: assetsM.userAssets,
    activeAssetCount: assetsM.activeAssetCount,
    recentTransactions,
    errors: queryErrors || undefined,
  };
}
