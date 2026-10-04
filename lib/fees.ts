import { getSupabaseAdmin, fetchAll, loadPrices } from "@/lib/data";
import { isValidPrice } from "@/lib/valuation";

/** Libellés lisibles des types de frais (le type brut reste affiché si inconnu). */
export const FEE_LABELS: Record<string, string> = {
  game_house_edge: "Marge des jeux",
  loan_origination_fee: "Frais de dossier prêt",
  loan_interest: "Intérêts prêt",
  score_loan_origination_fee: "Frais de dossier prêt score",
  score_loan_interest: "Intérêts prêt score",
  swap_fee: "Swap",
  withdraw_fee: "Retrait",
  wakati_purchase_fee: "Achat WAKATI",
  trading_service: "Service trading"
};

export const feeLabel = (type: string) => FEE_LABELS[type] ?? type;

type FeeRow = { asset_symbol: string; fee_type: string; amount: number | string; collected_at: string };

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
  truncated: boolean;
  error?: string;
}

const DAY = 86_400_000;

/**
 * Frais réels = hors lignes de test et hors game_net_loss (signal de crédit, pas un revenu).
 * Même règle que get_platform_fees_totals côté SQL ; valorisation au cours actuel.
 */
export async function loadFeesReport(now = Date.now()): Promise<FeesReport> {
  const db = getSupabaseAdmin();
  const [real, loss, prices] = await Promise.all([
    fetchAll<FeeRow>((a, b) => db.from("platform_fees").select("asset_symbol, fee_type, amount, collected_at").eq("is_test", false).neq("fee_type", "game_net_loss").order("id").range(a, b)),
    fetchAll<FeeRow>((a, b) => db.from("platform_fees").select("asset_symbol, fee_type, amount, collected_at").eq("is_test", false).eq("fee_type", "game_net_loss").order("id").range(a, b)),
    loadPrices()
  ]);

  const usdOf = (asset: string, amount: number) => { const p = prices.get(asset); return isValidPrice(p) ? amount * p : null; };
  const unpriced = new Set<string>();
  const types = new Map<string, FeeGroup>();
  const assets = new Map<string, FeeGroup & { native: number; price: number | null }>();
  const months = new Map<string, FeeGroup>();
  let totalUsd = 0, last30Usd = 0, last7Usd = 0, todayUsd = 0;
  const today = new Date(now).toISOString().slice(0, 10);

  const bump = <T extends FeeGroup>(map: Map<string, T>, key: string, make: () => T, asset: string, amount: number, usd: number) => {
    const g = map.get(key) ?? make();
    g.count += 1; g.usd += usd; g.byAsset.set(asset, (g.byAsset.get(asset) ?? 0) + amount);
    map.set(key, g);
    return g;
  };

  for (const r of real.rows) {
    const amount = Number(r.amount || 0);
    const usd = usdOf(r.asset_symbol, amount);
    if (usd === null) { if (amount > 0) unpriced.add(r.asset_symbol); }
    const v = usd ?? 0;
    totalUsd += v;
    const t = new Date(r.collected_at).getTime();
    if (now - t <= 30 * DAY) last30Usd += v;
    if (now - t <= 7 * DAY) last7Usd += v;
    if (r.collected_at.slice(0, 10) === today) todayUsd += v;
    bump(types, r.fee_type, () => ({ key: r.fee_type, count: 0, usd: 0, byAsset: new Map() }), r.asset_symbol, amount, v);
    const a = bump(assets, r.asset_symbol, () => ({ key: r.asset_symbol, count: 0, usd: 0, byAsset: new Map(), native: 0, price: prices.get(r.asset_symbol) ?? null }), r.asset_symbol, amount, v);
    a.native += amount;
    bump(months, r.collected_at.slice(0, 7), () => ({ key: r.collected_at.slice(0, 7), count: 0, usd: 0, byAsset: new Map() }), r.asset_symbol, amount, v);
  }

  let lossUsd = 0;
  const lossUnpriced = new Set<string>();
  for (const r of loss.rows) {
    const u = usdOf(r.asset_symbol, Number(r.amount || 0));
    if (u === null) lossUnpriced.add(r.asset_symbol); else lossUsd += u;
  }

  const byUsd = (x: FeeGroup, y: FeeGroup) => y.usd - x.usd;
  return {
    totalUsd, count: real.rows.length, last30Usd, last7Usd, todayUsd,
    byType: [...types.values()].sort(byUsd),
    byAsset: [...assets.values()].sort(byUsd),
    byMonth: [...months.values()].sort((x, y) => y.key.localeCompare(x.key)),
    unpriced: [...unpriced],
    excluded: { count: loss.rows.length, usd: lossUsd, unpricedAssets: [...lossUnpriced] },
    truncated: !!(real.truncated || loss.truncated),
    error: [real.error, loss.error].filter(Boolean).join(" · ") || undefined
  };
}
