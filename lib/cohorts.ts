import { getSupabaseAdmin } from "@/lib/data";

export type Granularity = "month" | "week";

export interface RetentionCell { period: number; active: number; pct: number }
export interface RetentionRow { cohort: string; size: number; cells: RetentionCell[] }

export interface LtvCell { period: number; revenueUsd: number; payers: number; cumulativeUsd: number; cumulativePerUser: number }
export interface LtvRow { cohort: string; size: number; totalUsd: number; perUser: number; cells: LtvCell[] }

export interface ChurnMonth { month: string; active: number; newUsers: number; retained: number; churned: number; reactivated: number; churnRatePct: number | null }

export interface ChurnSummary {
  inactiveDays: number; totalUsers: number; activated: number; neverActivated: number;
  active: number; churned: number; churnedRecent: number; atRisk: number; newSignups: number;
  activationRatePct: number | null; churnRatePct: number | null;
}

export interface Monetization {
  days: number | null; revenueUsd: number; totalUsers: number; payers: number;
  payerRatePct: number | null; arpuUsd: number | null; arppuUsd: number | null;
  top1SharePct: number | null; top5SharePct: number | null; top10SharePct: number | null;
  byType: { feeType: string; revenueUsd: number; payers: number; ops: number }[];
  unpricedAssets: string[];
}

export interface CohortsReport {
  granularity: Granularity;
  retention: RetentionRow[];
  ltv: LtvRow[];
  churnMonths: ChurnMonth[];
  churn: ChurnSummary | null;
  monetization: Monetization | null;
  feesSince: string | null; // date de la première ligne de frais réels (le revenu d'avant n'existe pas en base)
  errors: string[];
}

const n = (v: any): number => Number(v ?? 0);
const nn = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

/** Charge tout depuis les fonctions SQL admin_* (migration 20261013_cohorts_churn_ltv.sql). Ne lève jamais. */
export async function loadCohorts(granularity: Granularity = "month", inactiveDays = 30): Promise<CohortsReport> {
  const db = getSupabaseAdmin();
  const periods = granularity === "month" ? 12 : 26;
  const errors: string[] = [];

  const [ret, ltv, ch, chs, mon, first] = await Promise.all([
    db.rpc("admin_cohort_retention", { p_granularity: granularity, p_periods: periods }),
    db.rpc("admin_cohort_ltv", { p_granularity: granularity, p_periods: periods }),
    db.rpc("admin_monthly_churn", { p_months: 12 }),
    db.rpc("admin_churn_summary", { p_inactive_days: inactiveDays }),
    db.rpc("admin_monetization_summary", { p_days: null }),
    db.from("platform_fees").select("collected_at").eq("is_test", false).order("collected_at", { ascending: true }).limit(1)
  ]);
  for (const [label, r] of [["Rétention", ret], ["LTV", ltv], ["Churn mensuel", ch], ["Churn", chs], ["Monétisation", mon]] as const) {
    if (r.error) errors.push(`${label} : ${r.error.message}`);
  }

  const retMap = new Map<string, RetentionRow>();
  for (const r of (ret.data as any[]) || []) {
    const key = String(r.cohort);
    const row = retMap.get(key) ?? { cohort: key, size: n(r.cohort_size), cells: [] };
    row.cells.push({ period: n(r.period_n), active: n(r.active_users), pct: n(r.retention_pct) });
    retMap.set(key, row);
  }

  const ltvMap = new Map<string, LtvRow>();
  for (const r of (ltv.data as any[]) || []) {
    const key = String(r.cohort);
    const row = ltvMap.get(key) ?? { cohort: key, size: n(r.cohort_size), totalUsd: 0, perUser: 0, cells: [] };
    const revenueUsd = n(r.revenue_usd);
    const cumulativeUsd = (row.cells.length ? row.cells[row.cells.length - 1].cumulativeUsd : 0) + revenueUsd;
    row.cells.push({ period: n(r.period_n), revenueUsd, payers: n(r.payers), cumulativeUsd, cumulativePerUser: row.size > 0 ? cumulativeUsd / row.size : 0 });
    row.totalUsd = cumulativeUsd;
    row.perUser = row.size > 0 ? cumulativeUsd / row.size : 0;
    ltvMap.set(key, row);
  }

  const churnMonths: ChurnMonth[] = ((ch.data as any[]) || []).map((r) => ({
    month: String(r.month), active: n(r.active_users), newUsers: n(r.new_users), retained: n(r.retained),
    churned: n(r.churned), reactivated: n(r.reactivated), churnRatePct: nn(r.churn_rate_pct)
  }));

  const s = chs.data as any;
  const churn: ChurnSummary | null = s ? {
    inactiveDays: n(s.inactive_days), totalUsers: n(s.total_users), activated: n(s.activated), neverActivated: n(s.never_activated),
    active: n(s.active), churned: n(s.churned), churnedRecent: n(s.churned_recent), atRisk: n(s.at_risk), newSignups: n(s.new_signups),
    activationRatePct: nn(s.activation_rate_pct), churnRatePct: nn(s.churn_rate_pct)
  } : null;

  const m = mon.data as any;
  const monetization: Monetization | null = m ? {
    days: nn(m.days), revenueUsd: n(m.revenue_usd), totalUsers: n(m.total_users), payers: n(m.payers),
    payerRatePct: nn(m.payer_rate_pct), arpuUsd: nn(m.arpu_usd), arppuUsd: nn(m.arppu_usd),
    top1SharePct: nn(m.top1_share_pct), top5SharePct: nn(m.top5_share_pct), top10SharePct: nn(m.top10_share_pct),
    byType: ((m.by_type as any[]) || []).map((t) => ({ feeType: String(t.fee_type), revenueUsd: n(t.revenue_usd), payers: n(t.payers), ops: n(t.ops) })),
    unpricedAssets: (m.unpriced_assets as string[]) || []
  } : null;

  const firstRow = (first.data as any[] | null)?.[0];

  return {
    granularity,
    retention: [...retMap.values()],
    ltv: [...ltvMap.values()],
    churnMonths,
    churn,
    monetization,
    feesSince: firstRow?.collected_at ? String(firstRow.collected_at).slice(0, 10) : null,
    errors
  };
}
