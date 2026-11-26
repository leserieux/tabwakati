import { describe, it, expect } from "vitest";
import { CATS, computeFlows, makeValuer, pnlCuts, type CatKey, type PnlGroup } from "@/modules/revenue/pnl";
import { rng, plain, expectClose } from "./helpers";

const DAY = 86_400_000;
const WAKATI = "WAKATI";
// Milieu de journée, avec des millisecondes : les frontières de fenêtres tombent en plein milieu des jours (le cas difficile).
const NOW = Date.UTC(2026, 10, 24, 15, 30, 12, 345);

type RawEv = { cat: CatKey; asset: string; amount: number; ts: number };
type RefTotals = {
  net: number; real: number; wakati: number; bets: number; wins: number; gameNet: number; rtp: number | null;
  byCat: Record<CatKey, { usd: number; real: number; wakati: number; count: number; native: Map<string, number> }>;
};

// ---------- Prix : un valorisateur construit par le vrai code (makeValuer) avec des données synthétiques ----------
function buildValuer(seed: number) {
  const rand = rng(seed);
  const wakatiHistory: { computed_for_date: string; final_price_usd: number }[] = [];
  for (let d = Date.UTC(2026, 8, 4); d <= NOW; d += DAY) {
    if (rand() < 0.1) continue; // jours sans prix WAKATI
    wakatiHistory.push({ computed_for_date: new Date(d).toISOString().slice(0, 10), final_price_usd: 0.0002 + rand() * 0.0006 });
  }
  const daily = (base: number, from: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let d = from; d <= NOW; d += DAY) if (rand() < 0.8) out[new Date(d).toISOString().slice(0, 10)] = base * (0.9 + rand() * 0.2); // 20 % de trous
    return out;
  };
  return makeValuer({
    wakatiHistory,
    dailyPrices: { FCFA: daily(0.0016, Date.UTC(2026, 0, 1)), BTC: daily(60000, Date.UTC(2026, 5, 1)), MATIC: daily(0.5, Date.UTC(2026, 8, 1)) },
    prices: new Map<string, number>([[WAKATI, 0.0005], ["FCFA", 0.0016], ["BTC", 61000], ["MATIC", 0.55], ["USDT", 1]]) // NOPRICE : aucun cours
  });
}

// ---------- ANCIEN calcul (avant la phase 3) : flux par flux. Recopié tel quel, sert de référence ----------
function emptyRef(): RefTotals {
  const byCat = {} as RefTotals["byCat"];
  (Object.keys(CATS) as CatKey[]).forEach((k) => { byCat[k] = { usd: 0, real: 0, wakati: 0, count: 0, native: new Map() }; });
  return { net: 0, real: 0, wakati: 0, byCat, bets: 0, wins: 0, gameNet: 0, rtp: null };
}

function referenceFlows(raw: RawEv[], valuer: ReturnType<typeof buildValuer>, now: number, periodDays: number) {
  const unpriced = new Set<string>();
  let dayUsd = 0, currentUsd = 0;
  const events: Array<RawEv & { usd: number }> = [];
  for (const e of raw) {
    if (!Number.isFinite(e.amount) || e.amount <= 0) continue;
    const { price: p, basis } = valuer.priceAtEx(e.asset, e.ts);
    if (p === null) unpriced.add(e.asset);
    else if (basis === "day") dayUsd += e.amount * p;
    else currentUsd += e.amount * p;
    events.push({ ...e, usd: p === null ? 0 : e.amount * p });
  }
  const aggregate = (from: number, to: number): RefTotals => {
    const t = emptyRef();
    for (const e of events) {
      if (e.ts < from || e.ts >= to) continue;
      const signed = CATS[e.cat].sign * e.usd;
      const c = t.byCat[e.cat];
      c.usd += signed; c.count += 1;
      c.native.set(e.asset, (c.native.get(e.asset) ?? 0) + e.amount);
      if (e.asset === WAKATI) { c.wakati += signed; t.wakati += signed; } else { c.real += signed; t.real += signed; }
      t.net += signed;
    }
    t.bets = t.byCat.game_bets.usd;
    t.wins = -t.byCat.game_wins.usd;
    t.gameNet = t.bets - t.wins;
    t.rtp = t.bets > 0 ? (t.wins / t.bets) * 100 : null;
    return t;
  };
  const end = now + 1;
  const start = periodDays > 0 ? now - periodDays * DAY : 0;
  const months: Array<{ key: string; fees: number; game: number; costs: number; net: number }> = [];
  const base = new Date(now);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const t = aggregate(d.getTime(), next);
    months.push({ key: d.toISOString().slice(0, 7), fees: t.byCat.fees.usd, game: t.gameNet, costs: t.byCat.staking.usd + t.byCat.referral.usd + t.byCat.defaults.usd, net: t.net });
  }
  return {
    current: aggregate(start, end),
    previous: periodDays > 0 ? aggregate(start - periodDays * DAY, start) : null,
    last30: aggregate(now - 30 * DAY, end),
    months,
    wakatiNet30: events.filter((e) => e.asset === WAKATI && e.ts >= now - 30 * DAY).reduce((s, e) => s + CATS[e.cat].sign * e.amount, 0),
    unpriced, dayUsd, currentUsd
  };
}

// ---------- Ce que fait la fonction SQL admin_pnl_aggregate (vérifiée contre la vraie base : 6 256 flux → 667 groupes, mêmes totaux) ----------
function sqlAggregate(raw: RawEv[], now: number, periodDays: number): PnlGroup[] {
  const cuts = pnlCuts(now, periodDays);
  const groups = new Map<string, { cat: CatKey; asset_symbol: string; day: string; seg: number; cnt: number; amount_sum: number }>();
  for (const e of raw) {
    if (!(e.amount > 0)) continue; // ni nul, ni négatif, ni NaN
    const day = new Date(e.ts).toISOString().slice(0, 10);
    const seg = cuts.filter((c) => e.ts >= c).length;
    const key = `${e.cat}|${e.asset}|${day}|${seg}`;
    const g = groups.get(key) ?? { cat: e.cat, asset_symbol: e.asset, day, seg, cnt: 0, amount_sum: 0 };
    g.cnt += 1; g.amount_sum += e.amount;
    groups.set(key, g);
  }
  return [...groups.values()];
}

const CAT_KEYS = Object.keys(CATS) as CatKey[];
const ASSETS = ["FCFA", "USDT", "BTC", "MATIC", WAKATI, WAKATI, "NOPRICE"];

function randomEvents(seed: number, n: number, periodDays: number): RawEv[] {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const out: RawEv[] = [];
  for (let i = 0; i < n; i++) {
    const k = rand();
    const amount = k < 0.08 ? 0 : k < 0.12 ? -Math.round(rand() * 50) : k < 0.14 ? NaN : Math.round(rand() * 5_000_000) / 1000;
    const ageDays = rand() < 0.04 ? -rand() * 2 : rand() * 400; // quelques flux « dans le futur »
    out.push({ cat: pick(CAT_KEYS), asset: pick(ASSETS), amount, ts: Math.round(NOW - ageDays * DAY) });
  }
  // Frontières exactes de toutes les fenêtres, à la milliseconde, pour chaque catégorie importante
  const start = periodDays > 0 ? NOW - periodDays * DAY : null;
  const edges = [NOW - 30 * DAY, NOW - 30 * DAY - 1, NOW + 1, NOW, NOW + 2, NOW - 7 * DAY, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 1) - 1, Date.UTC(2026, 9, 1) - 1]
    .concat(start === null ? [] : [start, start - 1, start - periodDays * DAY, start - periodDays * DAY - 1]);
  edges.forEach((ts, i) => {
    out.push({ cat: CAT_KEYS[i % CAT_KEYS.length], asset: i % 3 === 0 ? WAKATI : ASSETS[i % 4], amount: 10 + i, ts });
    out.push({ cat: "fees", asset: WAKATI, amount: 1 + i, ts });
  });
  return out;
}

const normalize = (r: ReturnType<typeof referenceFlows>) => plain({ ...r, unpriced: [...r.unpriced].sort() });
const normalizeNew = (r: ReturnType<typeof computeFlows>) => plain({ ...r, unpriced: [...r.unpriced].sort() });

describe("Résultat (P&L) : le calcul sur flux regroupés donne exactement le même rapport que l'ancien calcul flux par flux", () => {
  for (const periodDays of [0, 7, 30, 90]) {
    for (const seed of [1, 2026, 777]) {
      it(`période ${periodDays === 0 ? "totale" : `${periodDays} jours`}, graine ${seed} (~3 000 flux, frontières à la milliseconde, prix manquants, futur)`, () => {
        const raw = randomEvents(seed * 100 + periodDays, 3000, periodDays);
        const valuer = buildValuer(seed);
        const expected = normalize(referenceFlows(raw, valuer, NOW, periodDays));
        const actual = normalizeNew(computeFlows(sqlAggregate(raw, NOW, periodDays), valuer, NOW, periodDays));
        expectClose(actual, expected);
      });
    }
  }

  it("aucun flux : tout à zéro, sans erreur", () => {
    const r = computeFlows([], buildValuer(1), NOW, 30);
    expect(r.current.net).toBe(0);
    expect(r.previous?.net).toBe(0);
    expect(r.months).toHaveLength(12);
    expect(r.unpriced.size).toBe(0);
    expect(r.wakatiNet30).toBe(0);
  });

  it("un flux pile à la frontière de période entre dans la période courante, pas dans la précédente", () => {
    const start = NOW - 30 * DAY;
    const raw: RawEv[] = [
      { cat: "fees", asset: "USDT", amount: 100, ts: start },       // pile au début : courante
      { cat: "fees", asset: "USDT", amount: 7, ts: start - 1 }      // une milliseconde avant : précédente
    ];
    const r = computeFlows(sqlAggregate(raw, NOW, 30), buildValuer(1), NOW, 30);
    expect(r.current.byCat.fees.usd).toBeCloseTo(100, 9);
    expect(r.previous?.byCat.fees.usd).toBeCloseTo(7, 9);
  });

  it("un flux plus récent que « maintenant + 1 ms » est exclu de la période courante", () => {
    const raw: RawEv[] = [{ cat: "fees", asset: "USDT", amount: 5, ts: NOW + 2 }, { cat: "fees", asset: "USDT", amount: 3, ts: NOW }];
    const r = computeFlows(sqlAggregate(raw, NOW, 30), buildValuer(1), NOW, 30);
    expect(r.current.byCat.fees.usd).toBeCloseTo(3, 9);
  });

  it("un actif sans cours valide est signalé et n'entre pas dans les totaux en dollars", () => {
    const raw: RawEv[] = [{ cat: "fees", asset: "NOPRICE", amount: 50, ts: NOW - DAY }, { cat: "fees", asset: "USDT", amount: 2, ts: NOW - DAY }];
    const r = computeFlows(sqlAggregate(raw, NOW, 30), buildValuer(1), NOW, 30);
    expect([...r.unpriced]).toEqual(["NOPRICE"]);
    expect(r.current.net).toBeCloseTo(2, 9);
    expect(r.current.byCat.fees.count).toBe(2);
  });

  it("dépenses (staking, parrainage, défauts) et gains payés se retranchent ; mises et frais s'ajoutent", () => {
    const at = NOW - DAY;
    const raw: RawEv[] = [
      { cat: "fees", asset: "USDT", amount: 10, ts: at }, { cat: "game_bets", asset: "USDT", amount: 100, ts: at }, { cat: "game_wins", asset: "USDT", amount: 80, ts: at },
      { cat: "staking", asset: "USDT", amount: 5, ts: at }, { cat: "referral", asset: "USDT", amount: 2, ts: at }, { cat: "defaults", asset: "USDT", amount: 3, ts: at }
    ];
    const r = computeFlows(sqlAggregate(raw, NOW, 30), buildValuer(1), NOW, 30);
    expect(r.current.net).toBeCloseTo(10 + 100 - 80 - 5 - 2 - 3, 9);
    expect(r.current.rtp).toBeCloseTo(80, 9);
    expect(r.current.gameNet).toBeCloseTo(20, 9);
  });
});

describe("prix du jour (makeValuer)", () => {
  const valuer = makeValuer({
    wakatiHistory: [{ computed_for_date: "2026-11-20", final_price_usd: 0.001 }, { computed_for_date: "2026-11-21", final_price_usd: 0 }],
    dailyPrices: { FCFA: { "2026-11-20": 0.002 }, BTC: { "2026-11-24": -5 } },
    prices: new Map([[WAKATI, 0.0005], ["FCFA", 0.0016], ["BTC", 61000]])
  });
  const at = (d: string) => Date.parse(`${d}T10:00:00Z`);

  it("WAKATI : prix du jour s'il est valide, sinon cours actuel", () => {
    expect(valuer.priceAtEx(WAKATI, at("2026-11-20"))).toEqual({ price: 0.001, basis: "day" });
    expect(valuer.priceAtEx(WAKATI, at("2026-11-21"))).toEqual({ price: 0.0005, basis: "current" }); // prix 0 = invalide
    expect(valuer.priceAtEx(WAKATI, at("2026-11-10"))).toEqual({ price: 0.0005, basis: "current" });
  });
  it("autres actifs : dernier prix connu dans les 3 jours précédents, au-delà cours actuel", () => {
    expect(valuer.priceAtEx("FCFA", at("2026-11-23"))).toEqual({ price: 0.002, basis: "day" }); // 3 jours après le 20
    expect(valuer.priceAtEx("FCFA", at("2026-11-24"))).toEqual({ price: 0.0016, basis: "current" }); // 4 jours
  });
  it("un prix du jour négatif est ignoré ; un actif sans aucun cours vaut null", () => {
    expect(valuer.priceAtEx("BTC", at("2026-11-24"))).toEqual({ price: 61000, basis: "current" });
    expect(valuer.priceAtEx("NOPE", at("2026-11-24"))).toEqual({ price: null, basis: "current" });
  });
  it("le pic WAKATI ne retient que les prix valides", () => {
    expect(valuer.wakatiPeak).toBe(0.001);
  });
});

describe("coupes de fenêtres", () => {
  it("triées, sans doublon, avec « maintenant + 1 ms » et les 30 derniers jours", () => {
    for (const d of [0, 7, 30, 90]) {
      const cuts = pnlCuts(NOW, d);
      expect([...cuts].sort((a, b) => a - b)).toEqual(cuts);
      expect(new Set(cuts).size).toBe(cuts.length);
      expect(cuts).toContain(NOW + 1);
      expect(cuts).toContain(NOW - 30 * DAY);
    }
  });
  it("période de 30 jours : la frontière des 30 jours et celle de la période se confondent (pas de doublon)", () => {
    expect(pnlCuts(NOW, 30)).toEqual([NOW - 60 * DAY, NOW - 30 * DAY, NOW + 1]);
  });
});
