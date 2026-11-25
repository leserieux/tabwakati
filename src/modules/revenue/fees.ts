import { loadPrices } from "@/core/db/data";
import { loadFeeAggregates, type FeeAggRow } from "@/modules/metrics/fee-aggregates";
import { FUTURES_PNL_FEE_TYPES } from "@/modules/metrics/rules";
import { isValidPrice } from "@/core/valuation";

/** Libellés lisibles des types de frais (le type brut reste affiché si inconnu). */
export const FEE_LABELS: Record<string, string> = {
  game_house_edge: "Mises encaissées (brut, jeux)",
  loan_origination_fee: "Frais de dossier prêt",
  loan_interest: "Intérêts prêt",
  score_loan_origination_fee: "Frais de dossier prêt score",
  score_loan_interest: "Intérêts prêt score",
  swap_fee: "Swap",
  withdraw_fee: "Retrait",
  wakati_purchase_fee: "Achat WAKATI",
  trading_service: "Service trading",
  futures_open_fee: "Futures — frais d'ouverture",
  futures_funding_fee: "Futures — frais périodiques",
  futures_close_fee: "Futures — frais de fermeture"
};

export const feeLabel = (type: string) => FEE_LABELS[type] ?? type;

export interface FeeGroup { key: string; count: number; usd: number; byAsset: Map<string, number> }
export interface FeesReport {
  totalUsd: number;
  count: number;
  last30Usd: number;
  last7Usd: number;
  todayUsd: number;
  byType: FeeGroup[];
  byAsset: (FeeGroup & { native: number; price: number | null })[];
  byMonth: FeeGroup[];
  unpriced: string[];
  excluded: { count: number; usd: number; unpricedAssets: string[] };
  /** Mises encaissées des jeux (game_house_edge) : affichées à part, exclues du total (déjà dans les mises du P&L). */
  gameHouseEdge: { count: number; usd: number };
  truncated: boolean;
  error?: string;
}

type PriceBook = { get(asset: string): number | null | undefined };

/**
 * Construit le rapport à partir des frais déjà regroupés par la base (actif × type × mois).
 * Frais réels = hors lignes de test, hors game_net_loss (signal de crédit) et hors game_house_edge
 * (déjà compris dans les mises du P&L). Même règle que modules/metrics/rules.ts, donc même total que la
 * Vue d'ensemble, le P&L et Analytics. game_house_edge est exposé à part. Valorisation au cours actuel.
 * Fonction pure : testée contre l'ancien calcul ligne par ligne (tests/fees.test.ts).
 */
export function buildFeesReport(groups: FeeAggRow[], prices: PriceBook): Omit<FeesReport, "truncated" | "error"> {
  const usdOf = (asset: string, amount: number) => { const p = prices.get(asset); return isValidPrice(p) ? amount * p : null; };
  const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
  const unpriced = new Set<string>();
  const types = new Map<string, FeeGroup>();
  const assets = new Map<string, FeeGroup & { native: number; price: number | null }>();
  const months = new Map<string, FeeGroup>();
  let totalUsd = 0, last30Usd = 0, last7Usd = 0, todayUsd = 0, realCount = 0;
  let houseCount = 0, houseUsd = 0, lossCount = 0, lossUsd = 0;
  const lossUnpriced = new Set<string>();

  const bump = <T extends FeeGroup>(map: Map<string, T>, key: string, make: () => T, asset: string, count: number, amount: number, usd: number) => {
    const g = map.get(key) ?? make();
    g.count += count; g.usd += usd; g.byAsset.set(asset, (g.byAsset.get(asset) ?? 0) + amount);
    map.set(key, g);
    return g;
  };

  for (const r of groups) {
    const count = num(r.cnt);
    const amount = num(r.amount_sum);
    if (r.fee_type === "game_net_loss") {
      lossCount += count;
      const u = usdOf(r.asset_symbol, amount);
      if (u === null) lossUnpriced.add(r.asset_symbol); else lossUsd += u;
      continue;
    }
    if (r.fee_type === "game_house_edge") {
      houseCount += count;
      houseUsd += usdOf(r.asset_symbol, amount) ?? 0;
      continue;
    }
    if ((FUTURES_PNL_FEE_TYPES as readonly string[]).includes(String(r.fee_type))) continue; // futures_settlement = perte de trading des joueurs, pas un frais : compté dans le P&L via les positions

    const usd = usdOf(r.asset_symbol, amount);
    if (usd === null && r.has_positive) unpriced.add(r.asset_symbol);
    const v = usd ?? 0;
    realCount += count;
    totalUsd += v;
    last30Usd += usdOf(r.asset_symbol, num(r.amount_30d)) ?? 0;
    last7Usd += usdOf(r.asset_symbol, num(r.amount_7d)) ?? 0;
    todayUsd += usdOf(r.asset_symbol, num(r.amount_today)) ?? 0;
    bump(types, r.fee_type, () => ({ key: r.fee_type, count: 0, usd: 0, byAsset: new Map() }), r.asset_symbol, count, amount, v);
    const a = bump(assets, r.asset_symbol, () => ({ key: r.asset_symbol, count: 0, usd: 0, byAsset: new Map(), native: 0, price: prices.get(r.asset_symbol) ?? null }), r.asset_symbol, count, amount, v);
    a.native += amount;
    bump(months, r.month, () => ({ key: r.month, count: 0, usd: 0, byAsset: new Map() }), r.asset_symbol, count, amount, v);
  }

  const byUsd = (x: FeeGroup, y: FeeGroup) => y.usd - x.usd;
  return {
    totalUsd, count: realCount, gameHouseEdge: { count: houseCount, usd: houseUsd }, last30Usd, last7Usd, todayUsd,
    byType: [...types.values()].sort(byUsd),
    byAsset: [...assets.values()].sort(byUsd),
    byMonth: [...months.values()].sort((x, y) => y.key.localeCompare(x.key)),
    unpriced: [...unpriced],
    excluded: { count: lossCount, usd: lossUsd, unpricedAssets: [...lossUnpriced] }
  };
}

export async function loadFeesReport(now = Date.now()): Promise<FeesReport> {
  const [agg, prices] = await Promise.all([loadFeeAggregates(now), loadPrices()]);
  return { ...buildFeesReport(agg.rows, prices), truncated: false, error: agg.error };
}
