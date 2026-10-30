import { getSupabaseAdmin } from "@/lib/data";
import { computeCoverage } from "@/lib/valuation";
import type { Line } from "@/lib/solvency";
import {
  DEFAULT_POLICY,
  EMPTY_STAT,
  computePlan,
  type HoldingInput,
  type PlanLine,
  type Policy,
  type WithdrawalStat
} from "@/lib/custody-plan";

/** Fenêtre d'observation des retraits (en jours) pour calculer le « pire jour ». */
export const STATS_DAYS = 90;

export interface PlanLoad {
  plans: PlanLine[];
  /** Message à afficher si une donnée annexe (réglages, statistiques) n'a pas pu être lue. Les plans restent calculés avec les valeurs par défaut. */
  warning: string | null;
}

export async function loadPolicies(): Promise<{ map: Map<string, Policy>; error: string | null }> {
  const { data, error } = await getSupabaseAdmin().from("custody_policy").select("*");
  const map = new Map<string, Policy>();
  for (const r of (data as any[]) || []) {
    map.set(r.asset_symbol, {
      asset_symbol: r.asset_symbol,
      min_hot: Number(r.min_hot),
      days_cover: Number(r.days_cover),
      low_pct: Number(r.low_pct),
      high_pct: Number(r.high_pct),
      invest_pct: Number(r.invest_pct),
      safety_pct: Number(r.safety_pct)
    });
  }
  return { map, error: error ? error.message : null };
}

export async function loadWithdrawalStats(): Promise<{ map: Map<string, WithdrawalStat>; error: string | null }> {
  const { data, error } = await getSupabaseAdmin().rpc("get_withdrawal_stats", { p_days: STATS_DAYS });
  const map = new Map<string, WithdrawalStat>();
  for (const r of (data as any[]) || []) {
    map.set(r.asset_symbol, {
      withdrawals_count: Number(r.withdrawals_count),
      total_out: Number(r.total_out),
      max_single: Number(r.max_single),
      peak_day_out: Number(r.peak_day_out),
      avg_day_out: Number(r.avg_day_out),
      biggest_user_balance: Number(r.biggest_user_balance)
    });
  }
  return { map, error: error ? error.message : null };
}

/** Stock interne des swaps (treasury_wallets) : jamais compté comme argent libre. */
export async function loadSwapStock(): Promise<Map<string, number>> {
  const { data } = await getSupabaseAdmin().from("treasury_wallets").select("asset_symbol, balance");
  const map = new Map<string, number>();
  for (const r of (data as any[]) || []) map.set(r.asset_symbol, Number(r.balance) || 0);
  return map;
}

function toHolding(l: Line, kind: "crypto" | "mobile"): HoldingInput {
  return {
    asset: l.asset,
    label: l.label,
    kind,
    owe: l.owe,
    have: l.have,
    hot: l.hot ?? null,
    vault: l.vault ?? 0,
    onUsers: l.onUsers ?? 0,
    priceUsd: l.priceUsd,
    error: l.error
  };
}

/**
 * Construit le plan à partir des lignes de solvabilité déjà chargées (pour ne pas relire la blockchain deux fois).
 * Ne lève jamais : si les réglages ou les statistiques sont illisibles, on calcule avec les valeurs par défaut et on le dit.
 */
export async function buildPlans(sol: { crypto: Line[]; mobile: Line[] }): Promise<PlanLoad> {
  const holdings = [...sol.crypto.map((l) => toHolding(l, "crypto")), ...sol.mobile.map((l) => toHolding(l, "mobile"))];
  const [pol, stats, swapStock] = await Promise.all([loadPolicies(), loadWithdrawalStats(), loadSwapStock()]);

  const plans = holdings.map((h) =>
    computePlan(
      h,
      pol.map.get(h.asset) ?? { asset_symbol: h.asset, ...DEFAULT_POLICY },
      stats.map.get(h.asset) ?? EMPTY_STAT,
      swapStock.get(h.asset) ?? 0
    )
  );

  const problems: string[] = [];
  if (pol.error) problems.push(`réglages illisibles (${pol.error})`);
  if (stats.error) problems.push(`statistiques de retraits illisibles (${stats.error})`);
  const warning = problems.length
    ? `Certaines données n'ont pas pu être lues : ${problems.join(" ; ")}. Les calculs utilisent les valeurs par défaut. La migration 20261031_custody_policy.sql est-elle appliquée ?`
    : null;
  return { plans, warning };
}

// ─────────────────────────── Relevés quotidiens ───────────────────────────

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Enregistre (ou met à jour) le relevé du jour : une ligne par actif. Renvoie le message d'erreur éventuel. */
export async function saveSnapshot(plans: PlanLine[]): Promise<string | null> {
  if (plans.length === 0) return null;
  const date = todayKey();
  const rows = plans.map((p) => ({
    snapshot_date: date,
    asset_symbol: p.asset,
    kind: p.kind,
    owe: p.owe,
    have: p.have,
    hot: p.hot,
    vault: p.vault,
    on_users: p.onUsers,
    swap_stock: p.swapStock,
    price_usd: p.priceUsd,
    taken_at: new Date().toISOString()
  }));
  const { error } = await getSupabaseAdmin().from("custody_snapshots").upsert(rows, { onConflict: "snapshot_date,asset_symbol" });
  return error ? error.message : null;
}

/** Enregistre le relevé du jour s'il n'existe pas encore. Ne lève jamais (un relevé raté ne doit pas casser la page). */
export async function ensureTodaySnapshot(plans: PlanLine[]): Promise<void> {
  try {
    // On ne relève que si toutes les lectures ont réussi : un relevé partiel ferait croire à un manque.
    if (plans.length === 0 || plans.some((p) => p.have === null)) return;
    const { count } = await getSupabaseAdmin()
      .from("custody_snapshots")
      .select("asset_symbol", { count: "exact", head: true })
      .eq("snapshot_date", todayKey());
    if ((count ?? 0) === 0) await saveSnapshot(plans);
  } catch (e) {
    console.error("[custody] relevé quotidien non enregistré:", e);
  }
}

export interface SnapshotRow {
  snapshot_date: string;
  asset_symbol: string;
  kind: "crypto" | "mobile";
  owe: number;
  have: number | null;
  hot: number | null;
  vault: number | null;
  on_users: number | null;
  swap_stock: number | null;
  price_usd: number | null;
}

export async function loadSnapshots(fromDate: string, toDate: string): Promise<{ rows: SnapshotRow[]; error: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("custody_snapshots")
    .select("snapshot_date, asset_symbol, kind, owe, have, hot, vault, on_users, swap_stock, price_usd")
    .gte("snapshot_date", fromDate)
    .lte("snapshot_date", toDate)
    .order("snapshot_date", { ascending: false })
    .order("asset_symbol", { ascending: true });
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows: SnapshotRow[] = ((data as any[]) || []).map((r) => ({
    snapshot_date: r.snapshot_date,
    asset_symbol: r.asset_symbol,
    kind: r.kind,
    owe: Number(r.owe),
    have: num(r.have),
    hot: num(r.hot),
    vault: num(r.vault),
    on_users: num(r.on_users),
    swap_stock: num(r.swap_stock),
    price_usd: num(r.price_usd)
  }));
  return { rows, error: error ? error.message : null };
}

/** Résumé d'une journée de relevés : couverture totale en dollars. */
export function coverageOfDay(rows: SnapshotRow[]): { coveragePct: number; owedUsd: number; heldUsd: number; missingUsd: number; unpriced: string[] } {
  const c = computeCoverage(
    rows.filter((r) => r.have !== null).map((r) => ({ asset: r.asset_symbol, owed: r.owe, held: r.have as number, price: r.price_usd }))
  );
  return { coveragePct: c.coveragePct, owedUsd: c.owedUsd, heldUsd: c.heldUsd, missingUsd: c.missingUsd, unpriced: c.unpriced };
}
