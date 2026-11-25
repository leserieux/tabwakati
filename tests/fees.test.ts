import { describe, it, expect } from "vitest";
import { buildFeesReport } from "@/modules/revenue/fees";
import { feeTotalsByAsset, type FeeAggRow } from "@/modules/metrics/fee-aggregates";
import { EXCLUDED_FEE_TYPES, FUTURES_PNL_FEE_TYPES } from "@/modules/metrics/rules";
import { isValidPrice } from "@/core/valuation";

type Group = { key: string; count: number; usd: number; byAsset: Map<string, number>; native?: number; price?: number | null };
type RefReport = {
  totalUsd: number; count: number; gameHouseEdge: { count: number; usd: number }; last30Usd: number; last7Usd: number; todayUsd: number;
  byType: Group[]; byAsset: Group[]; byMonth: Group[]; unpriced: string[]; excluded: { count: number; usd: number; unpricedAssets: string[] };
};
type RawFee = { asset_symbol: string; fee_type: string; amount: number | null; collected_at: string; is_test: boolean };

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 15, 30, 0);
const PRICES = new Map<string, number>([["FCFA", 0.0016], ["USDT", 1], ["BTC", 60000], ["MATIC", 0.5], ["ZEROP", 0]]); // NOPRICE absent, ZEROP invalide
const ASSETS = ["FCFA", "USDT", "BTC", "MATIC", "NOPRICE", "ZEROP"];
const TYPES = ["swap_fee", "withdraw_fee", "loan_interest", "futures_open_fee", "game_house_edge", "game_net_loss", "futures_settlement", "p2p_fee"];

/** ANCIEN calcul (avant la phase 3) : lit toutes les lignes. Recopié tel quel, sert de référence. */
function referenceReport(rows: RawFee[], prices: Map<string, number>, now: number): RefReport {
  const real = rows.filter((r) => !r.is_test && r.fee_type !== "game_net_loss");
  const loss = rows.filter((r) => !r.is_test && r.fee_type === "game_net_loss");
  const usdOf = (asset: string, amount: number) => { const p = prices.get(asset); return isValidPrice(p) ? amount * p : null; };
  const unpriced = new Set<string>();
  const types = new Map<string, Group>(), assets = new Map<string, Group>(), months = new Map<string, Group>();
  let totalUsd = 0, last30Usd = 0, last7Usd = 0, todayUsd = 0;
  const today = new Date(now).toISOString().slice(0, 10);
  const bump = (map: Map<string, Group>, key: string, make: () => Group, asset: string, amount: number, usd: number) => {
    const g = map.get(key) ?? make();
    g.count += 1; g.usd += usd; g.byAsset.set(asset, (g.byAsset.get(asset) ?? 0) + amount);
    map.set(key, g);
    return g;
  };
  let houseCount = 0, houseUsd = 0;
  const realRows: RawFee[] = [];
  for (const r of real) {
    if (r.fee_type === "game_house_edge") { houseCount += 1; houseUsd += usdOf(r.asset_symbol, Number(r.amount || 0)) ?? 0; }
    else if ((FUTURES_PNL_FEE_TYPES as readonly string[]).includes(String(r.fee_type))) continue;
    else realRows.push(r);
  }
  for (const r of realRows) {
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
    a.native = (a.native ?? 0) + amount;
    bump(months, r.collected_at.slice(0, 7), () => ({ key: r.collected_at.slice(0, 7), count: 0, usd: 0, byAsset: new Map() }), r.asset_symbol, amount, v);
  }
  let lossUsd = 0;
  const lossUnpriced = new Set<string>();
  for (const r of loss) { const u = usdOf(r.asset_symbol, Number(r.amount || 0)); if (u === null) lossUnpriced.add(r.asset_symbol); else lossUsd += u; }
  const byUsd = (x: Group, y: Group) => y.usd - x.usd;
  return {
    totalUsd, count: realRows.length, gameHouseEdge: { count: houseCount, usd: houseUsd }, last30Usd, last7Usd, todayUsd,
    byType: [...types.values()].sort(byUsd), byAsset: [...assets.values()].sort(byUsd), byMonth: [...months.values()].sort((x, y) => y.key.localeCompare(x.key)),
    unpriced: [...unpriced], excluded: { count: loss.length, usd: lossUsd, unpricedAssets: [...lossUnpriced] }
  };
}

/** Ce que fait la fonction SQL admin_fees_aggregate (vérifiée contre la vraie base : mêmes totaux, 784 lignes → 53 groupes). */
function sqlAggregate(rows: RawFee[], now: number): FeeAggRow[] {
  const groups = new Map<string, FeeAggRow>();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  for (const r of rows) {
    if (r.is_test) continue;
    const month = r.collected_at.slice(0, 7);
    const key = `${r.asset_symbol}|${r.fee_type}|${month}`;
    const g = groups.get(key) ?? { asset_symbol: r.asset_symbol, fee_type: r.fee_type, month, cnt: 0, amount_sum: 0, amount_30d: 0, amount_7d: 0, amount_today: 0, has_positive: false };
    const a = r.amount ?? 0, t = new Date(r.collected_at).getTime();
    g.cnt = Number(g.cnt) + 1;
    g.amount_sum = Number(g.amount_sum) + a;
    if (t >= now - 30 * DAY) g.amount_30d = Number(g.amount_30d) + a;
    if (t >= now - 7 * DAY) g.amount_7d = Number(g.amount_7d) + a;
    if (r.collected_at.slice(0, 10) === todayStr) g.amount_today = Number(g.amount_today) + a;
    if (r.amount !== null && r.amount > 0) g.has_positive = true;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function randomRows(seed: number, n: number): RawFee[] {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const rows: RawFee[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rand();
    const amount = kind < 0.1 ? 0 : kind < 0.15 ? null : kind < 0.2 ? -Math.round(rand() * 100) / 10 : Math.round(rand() * 1_000_000) / 1000;
    const offsetDays = rand() < 0.05 ? -rand() * 3 : rand() * 400; // quelques lignes « dans le futur »
    rows.push({ asset_symbol: pick(ASSETS), fee_type: pick(TYPES), amount, collected_at: new Date(NOW - offsetDays * DAY).toISOString(), is_test: rand() < 0.08 });
  }
  // Frontières exactes des fenêtres et du jour
  const edges = [NOW - 30 * DAY, NOW - 30 * DAY - 1, NOW - 7 * DAY, NOW - 7 * DAY - 1, Date.UTC(2026, 10, 24, 0, 0, 0), Date.UTC(2026, 10, 23, 23, 59, 59, 999), Date.UTC(2026, 9, 31, 23, 59, 59, 999), Date.UTC(2026, 10, 1, 0, 0, 0)];
  edges.forEach((t, i) => rows.push({ asset_symbol: ASSETS[i % 4], fee_type: "swap_fee", amount: 10 + i, collected_at: new Date(t).toISOString(), is_test: false }));
  return rows;
}

/** Transforme un rapport en objet comparable (Map → objet) */
const plain = (r: unknown): unknown => JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof Map ? Object.fromEntries([...v.entries()].sort()) : v)));
function expectClose(actual: unknown, expected: unknown, path = "rapport"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const got = actual as number;
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    expect(Math.abs(got - expected), `${path}: ${got} ≠ ${expected}`).toBeLessThanOrEqual(tol);
  } else if (Array.isArray(expected)) {
    const got = actual as unknown[];
    expect(got.length, `${path}.length`).toBe(expected.length);
    expected.forEach((e, i) => expectClose(got[i], e, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    const got = actual as Record<string, unknown>;
    const exp = expected as Record<string, unknown>;
    expect(Object.keys(got).sort(), `${path} clés`).toEqual(Object.keys(exp).sort());
    for (const k of Object.keys(exp)) expectClose(got[k], exp[k], `${path}.${k}`);
  } else expect(actual, path).toEqual(expected);
}
/** Les ex-aequo peuvent sortir dans un autre ordre : on trie sur (usd, clé) avant de comparer. */
const normalizeOrder = <T extends { byType: Group[]; byAsset: Group[]; unpriced: string[]; excluded: { unpricedAssets: string[] } }>(r: T): T => {
  const sortGroups = (xs: Group[]) => [...xs].sort((a, b) => b.usd - a.usd || String(a.key).localeCompare(String(b.key)));
  return { ...r, byType: sortGroups(r.byType), byAsset: sortGroups(r.byAsset), unpriced: [...r.unpriced].sort(), excluded: { ...r.excluded, unpricedAssets: [...r.excluded.unpricedAssets].sort() } };
};

describe("frais : le calcul sur données regroupées donne exactement le même rapport que l'ancien calcul ligne par ligne", () => {
  for (const seed of [1, 7, 42, 2026, 99999]) {
    it(`données aléatoires (graine ${seed}, ~2 000 lignes, frontières de fenêtres, prix manquants, futur)`, () => {
      const rows = randomRows(seed, 2000);
      const expected = plain(normalizeOrder(referenceReport(rows, PRICES, NOW)));
      const actual = plain(normalizeOrder(buildFeesReport(sqlAggregate(rows, NOW), PRICES)));
      expectClose(actual, expected);
    });
  }

  it("aucune donnée : rapport vide, sans erreur", () => {
    const r = buildFeesReport([], PRICES);
    expect(r.totalUsd).toBe(0);
    expect(r.count).toBe(0);
    expect(r.byType).toEqual([]);
    expect(r.unpriced).toEqual([]);
  });

  it("un actif sans prix est signalé seulement s'il a un montant positif ; ses frais ne gonflent pas le total", () => {
    const rows: RawFee[] = [
      { asset_symbol: "NOPRICE", fee_type: "swap_fee", amount: 5, collected_at: new Date(NOW - DAY).toISOString(), is_test: false },
      { asset_symbol: "ZEROP", fee_type: "swap_fee", amount: 0, collected_at: new Date(NOW - DAY).toISOString(), is_test: false },
      { asset_symbol: "USDT", fee_type: "swap_fee", amount: 2, collected_at: new Date(NOW - DAY).toISOString(), is_test: false }
    ];
    const r = buildFeesReport(sqlAggregate(rows, NOW), PRICES);
    expect(r.unpriced).toEqual(["NOPRICE"]);
    expect(r.totalUsd).toBe(2);
    expect(r.count).toBe(3);
  });

  it("les types exclus (mises des jeux, perte nette, règlement futures) ne comptent pas dans le total mais restent visibles à part", () => {
    const at = new Date(NOW - DAY).toISOString();
    const rows: RawFee[] = [
      { asset_symbol: "USDT", fee_type: "game_house_edge", amount: 100, collected_at: at, is_test: false },
      { asset_symbol: "USDT", fee_type: "game_net_loss", amount: 30, collected_at: at, is_test: false },
      { asset_symbol: "USDT", fee_type: "futures_settlement", amount: 50, collected_at: at, is_test: false },
      { asset_symbol: "USDT", fee_type: "swap_fee", amount: 7, collected_at: at, is_test: false },
      { asset_symbol: "USDT", fee_type: "swap_fee", amount: 999, collected_at: at, is_test: true }
    ];
    const r = buildFeesReport(sqlAggregate(rows, NOW), PRICES);
    expect(r.totalUsd).toBe(7);
    expect(r.gameHouseEdge).toEqual({ count: 1, usd: 100 });
    expect(r.excluded.usd).toBe(30);
    expect(r.excluded.count).toBe(1);
  });
});

describe("frais cumulés par actif (Vue d'ensemble, Analytics)", () => {
  it("même total que l'ancien calcul : hors types exclus et hors lignes de test", () => {
    const rows = randomRows(5, 1500);
    const expected = new Map<string, number>();
    for (const r of rows) {
      if (r.is_test || (EXCLUDED_FEE_TYPES as readonly string[]).includes(r.fee_type)) continue;
      const amount = Number(r.amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      expected.set(r.asset_symbol, (expected.get(r.asset_symbol) ?? 0) + amount);
    }
    const actual = feeTotalsByAsset(sqlAggregate(rows, NOW));
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [asset, total] of expected) expect(Math.abs((actual.get(asset) ?? 0) - total)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(total)));
  });
});

