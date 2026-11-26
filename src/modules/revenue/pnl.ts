import { getSupabaseAdmin, loadPrices, q } from "@/core/db/data";
import { isValidPrice } from "@/core/valuation";
import { EXCLUDED_FEE_TYPES } from "@/modules/metrics/rules";

/**
 * Compte de résultat de la plateforme.
 *
 * Entrées : frais hors jeux, mises des joueurs.
 * Sorties : gains payés, récompenses de staking, bonus de parrainage, prêts score en défaut.
 * La marge des jeux (game_house_edge) n'est PAS comptée à part : elle fait déjà partie des mises (sinon double comptage).
 *
 * Valorisation au prix du jour (coût historique) quand il est connu : WAKATI via wakati_price_history, les autres actifs via
 * asset_prices_history (moyenne journalière). Quand aucun prix de l'époque n'existe, le cours actuel est utilisé et la part
 * concernée est indiquée. Un actif sans cours valide est signalé, jamais compté à 0 en silence.
 */

export type CatKey = "fees" | "game_bets" | "game_wins" | "staking" | "referral" | "defaults";

export const CATS: Record<CatKey, { label: string; sign: 1 | -1; hint: string }> = {
  fees: { label: "Frais (hors jeux)", sign: 1, hint: "Swap, retrait, prêts, achat WAKATI, frais futures (ouverture, périodiques, fermeture)" },
  game_bets: { label: "Mises des joueurs", sign: 1, hint: "Tout ce que les joueurs ont misé (y compris la part jackpot, 5 %). Futures : pertes de trading des joueurs (hors frais), à la clôture des positions" },
  game_wins: { label: "Gains payés aux joueurs", sign: -1, hint: "Inclut les gains des tours gratuits et du jackpot. Futures : gains de trading des joueurs (hors frais), à la clôture des positions" },
  staking: { label: "Récompenses de staking", sign: -1, hint: "Versées aux utilisateurs qui stakent" },
  referral: { label: "Bonus de parrainage", sign: -1, hint: "Versés aux parrains" },
  defaults: { label: "Prêts score en défaut", sign: -1, hint: "Montant non remboursé. Les prêts liquidés ne sont pas inclus." }
};

const TX_CAT: Record<string, CatKey> = {
  game_bet: "game_bets",
  game_win: "game_wins",
  staking_reward: "staking",
  referral_bonus: "referral",
  score_loan_defaulted: "defaults"
};

const DAY = 86_400_000;
const WAKATI = "WAKATI";


export interface Totals {
  net: number; real: number; wakati: number;
  byCat: Record<CatKey, { usd: number; real: number; wakati: number; count: number; native: Map<string, number> }>;
  bets: number; wins: number; gameNet: number; rtp: number | null;
}

export interface Signal { tone: "ok" | "warn" | "bad" | "info"; title: string; detail: string }

export interface PnlReport {
  periodDays: number;
  current: Totals;
  previous: Totals | null;
  months: { key: string; fees: number; game: number; costs: number; net: number }[];
  signals: Signal[];
  treasury: { asset: string; balance: number; price: number | null; usd: number | null }[];
  treasuryUsd: number;
  unpriced: string[];
  wakatiPrice: number | null;
  wakatiPeak: number | null;
  valuationNote: string;
  error?: string;
  truncated: boolean;
  /** Valeur absolue des flux (USD) valorisée au prix du jour vs au cours actuel faute d'historique. */
  valuation: { dayUsd: number; currentUsd: number; dayPct: number | null };
}


export interface Valuer {
  prices: Map<string, number>;
  wakatiNow: number | null;
  wakatiPeak: number | null;
  wakatiDaily: Map<string, number>;
  priceAt: (asset: string, ts: number) => number | null;
  /** Même prix que priceAt, avec l'origine : "day" = prix de l'époque, "current" = cours actuel faute d'historique. */
  priceAtEx: (asset: string, ts: number) => { price: number | null; basis: "day" | "current" };
  error?: string;
}

export interface ValuerInputs {
  /** Historique du prix WAKATI : le dernier enregistrement d'un jour l'emporte. */
  wakatiHistory: { computed_for_date: unknown; final_price_usd: unknown }[];
  /** Prix journaliers des autres actifs : { actif: { "YYYY-MM-DD": prix } }. */
  dailyPrices: Record<string, Record<string, number>>;
  /** Cours actuels. */
  prices: Map<string, number>;
  error?: string;
}

/** Construit le valorisateur à partir de données déjà chargées (fonction pure, testable sans base). */
export function makeValuer(inputs: ValuerInputs): Valuer {
  const { prices } = inputs;
  // Prix journaliers des autres actifs : { asset: { "YYYY-MM-DD": prix } }
  const dailyByAsset = new Map<string, Map<string, number>>();
  for (const [asset, days] of Object.entries(inputs.dailyPrices ?? {})) {
    const m = new Map<string, number>();
    for (const [d, p] of Object.entries(days)) { const v = Number(p); if (isValidPrice(v)) m.set(d, v); }
    if (m.size) dailyByAsset.set(asset, m);
  }
  const wakatiDaily = new Map<string, number>();
  for (const h of inputs.wakatiHistory) { const p = Number(h.final_price_usd); if (isValidPrice(p)) wakatiDaily.set(String(h.computed_for_date).slice(0, 10), p); }
  const wakatiNow = prices.get(WAKATI) ?? null;
  const wakatiPeak = wakatiDaily.size ? Math.max(...wakatiDaily.values()) : null;
  const priceAtEx = (asset: string, ts: number): { price: number | null; basis: "day" | "current" } => {
    const day = new Date(ts).toISOString().slice(0, 10);
    if (asset === WAKATI) {
      const d = wakatiDaily.get(day);
      if (isValidPrice(d)) return { price: d as number, basis: "day" };
    } else {
      const m = dailyByAsset.get(asset);
      if (m) {
        // Jour exact, sinon le dernier prix connu dans les 3 jours précédents (trous de collecte).
        for (let back = 0; back <= 3; back++) {
          const dd = new Date(ts - back * DAY).toISOString().slice(0, 10);
          const v = m.get(dd);
          if (isValidPrice(v)) return { price: v as number, basis: "day" };
        }
      }
    }
    const p = prices.get(asset);
    return { price: isValidPrice(p) ? (p as number) : null, basis: "current" };
  };
  const priceAt = (asset: string, ts: number): number | null => priceAtEx(asset, ts).price;
  return { prices, wakatiNow, wakatiPeak, wakatiDaily, priceAt, priceAtEx, error: inputs.error };
}

/** Valorisation commune : WAKATI au prix du jour quand il est connu, sinon cours actuel ; autres actifs au cours actuel. */
export async function loadValuer(): Promise<Valuer> {
  const db = getSupabaseAdmin();
  const [hist, prices, daily] = await Promise.all([
    q<any>(db.from("wakati_price_history").select("computed_for_date, final_price_usd, created_at").order("computed_for_date", { ascending: true }).order("created_at", { ascending: true })),
    loadPrices(),
    db.rpc("admin_daily_prices")
  ]);
  return makeValuer({
    wakatiHistory: hist.rows, dailyPrices: (daily.data ?? {}) as Record<string, Record<string, number>>, prices,
    error: [hist.error, daily.error?.message].filter(Boolean).join(" · ") || undefined
  });
}

function emptyTotals(): Totals {
  const byCat = {} as Totals["byCat"];
  (Object.keys(CATS) as CatKey[]).forEach((k) => { byCat[k] = { usd: 0, real: 0, wakati: 0, count: 0, native: new Map() }; });
  return { net: 0, real: 0, wakati: 0, byCat, bets: 0, wins: 0, gameNet: 0, rtp: null };
}

/** Groupe de flux renvoyé par la base (fonction admin_pnl_aggregate) : catégorie × actif × jour UTC × segment de fenêtre. */
export interface PnlGroup { cat: CatKey; asset_symbol: string; day: string; seg: number | string; cnt: number | string; amount_sum: number | string }

interface Flow { cat: CatKey; asset: string; amount: number; count: number; dayMs: number; seg: number; usd: number }

function aggregate(flows: Flow[], keep: (f: Flow) => boolean): Totals {
  const t = emptyTotals();
  for (const e of flows) {
    if (!keep(e)) continue;
    const sign = CATS[e.cat].sign;
    const c = t.byCat[e.cat];
    const signed = sign * e.usd;
    c.usd += signed; c.count += e.count;
    c.native.set(e.asset, (c.native.get(e.asset) ?? 0) + e.amount);
    if (e.asset === WAKATI) { c.wakati += signed; t.wakati += signed; } else { c.real += signed; t.real += signed; }
    t.net += signed;
  }
  t.bets = t.byCat.game_bets.usd;
  t.wins = -t.byCat.game_wins.usd;
  t.gameNet = t.bets - t.wins;
  t.rtp = t.bets > 0 ? (t.wins / t.bets) * 100 : null;
  return t;
}

/**
 * Instants (triés, sans doublon) où une fenêtre de période commence ou finit. La base les reçoit pour découper
 * chaque groupe : un flux d'une même journée mais de part et d'autre d'une frontière (en milieu de journée) tombe
 * ainsi dans deux groupes, et les totaux restent exacts à la milliseconde.
 */
export function pnlCuts(now: number, periodDays: number): number[] {
  const set = new Set<number>([now + 1, now - 30 * DAY]);
  if (periodDays > 0) { const start = now - periodDays * DAY; set.add(start); set.add(start - periodDays * DAY); }
  return [...set].sort((a, b) => a - b);
}

export interface FlowResult {
  current: Totals; previous: Totals | null; last30: Totals; months: PnlReport["months"];
  /** WAKATI net entré (+) ou sorti (-) depuis 30 jours : sert à estimer la réserve en jours. */
  wakatiNet30: number;
  unpriced: Set<string>; dayUsd: number; currentUsd: number;
}

/**
 * Valorise les groupes (au prix du jour de chaque groupe : le prix ne dépend que de l'actif et du jour UTC) et calcule
 * la période courante, la précédente, les 30 derniers jours et les 12 derniers mois. Fonction pure, comparée à l'ancien
 * calcul flux par flux dans tests/pnl.test.ts.
 */
export function computeFlows(groups: PnlGroup[], valuer: Pick<Valuer, "priceAtEx">, now: number, periodDays: number): FlowResult {
  const cuts = pnlCuts(now, periodDays);
  const end = now + 1;
  const start = periodDays > 0 ? now - periodDays * DAY : 0;
  const unpriced = new Set<string>();
  let dayUsd = 0, currentUsd = 0;
  const flows: Flow[] = [];
  for (const g of groups) {
    const amount = Number(g.amount_sum);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const dayMs = Date.parse(`${g.day}T00:00:00.000Z`);
    const { price: p, basis } = valuer.priceAtEx(g.asset_symbol, dayMs);
    if (p === null) unpriced.add(g.asset_symbol);
    else if (basis === "day") dayUsd += amount * p;
    else currentUsd += amount * p;
    flows.push({ cat: g.cat, asset: g.asset_symbol, amount, count: Number(g.cnt), dayMs, seg: Number(g.seg), usd: p === null ? 0 : amount * p });
  }

  // Un flux de [cuts[i], cuts[j]) a un segment compris entre i+1 et j.
  const segAfter = (t: number) => cuts.indexOf(t) + 1;
  const between = (from: number | null, to: number | null) => {
    const lo = from === null ? 0 : segAfter(from);
    const hi = to === null ? cuts.length : segAfter(to) - 1;
    return (f: Flow) => f.seg >= lo && f.seg <= hi;
  };

  const current = aggregate(flows, between(periodDays > 0 ? start : null, end));
  const previous = periodDays > 0 ? aggregate(flows, between(start - periodDays * DAY, start)) : null;
  const last30 = aggregate(flows, between(now - 30 * DAY, end));

  // Mensuel : 12 derniers mois (frontières à minuit UTC : on raisonne par jour)
  const months: PnlReport["months"] = [];
  const base = new Date(now);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const t = aggregate(flows, (f) => f.dayMs >= d.getTime() && f.dayMs < next);
    months.push({ key: d.toISOString().slice(0, 7), fees: t.byCat.fees.usd, game: t.gameNet, costs: t.byCat.staking.usd + t.byCat.referral.usd + t.byCat.defaults.usd, net: t.net });
  }

  const since30 = between(now - 30 * DAY, null);
  const wakatiNet30 = flows.filter((f) => f.asset === WAKATI && since30(f)).reduce((sum, f) => sum + CATS[f.cat].sign * f.amount, 0);
  return { current, previous, last30, months, wakatiNet30, unpriced, dayUsd, currentUsd };
}

export async function loadPnl(periodDays: number, now = Date.now()): Promise<PnlReport> {
  const db = getSupabaseAdmin();
  const horizon = new Date(now - 400 * DAY).toISOString();

  const [flows, valuer, stake, wallets] = await Promise.all([
    // Flux regroupés par la base (catégorie × actif × jour × segment) : quelques centaines de lignes, jamais tout l'historique.
    // Futures : PNL de trading RÉALISÉ des positions clôturées ; la marge d'une position ouverte n'est pas un gain.
    db.rpc("admin_pnl_aggregate", { p_cuts: pnlCuts(now, periodDays).map((t) => new Date(t).toISOString()), p_horizon: horizon, p_excluded_fee_types: [...EXCLUDED_FEE_TYPES] }),
    loadValuer(),
    q<any>(db.from("admin_staking_overview").select("total_staked, apr").eq("asset_symbol", WAKATI)),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance"))
  ]);

  const { prices, wakatiNow, wakatiPeak } = valuer;
  const { current, previous, last30, months, wakatiNet30, unpriced, dayUsd, currentUsd } = computeFlows((flows.data ?? []) as PnlGroup[], valuer, now, periodDays);

  // Trésorerie actuelle
  const treasury = wallets.rows.map((w) => {
    const asset = String(w.asset_symbol); const balance = Number(w.balance || 0); const price = prices.get(asset) ?? null;
    return { asset, balance, price, usd: price === null ? null : balance * price };
  }).filter((w) => w.balance > 0).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const treasuryUsd = treasury.reduce((s, w) => s + (w.usd ?? 0), 0);

  // Signaux de décision (toujours sur les 30 derniers jours pour les projections)
  const signals: Signal[] = [];
  const f = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

  if (current.bets > 0 && current.rtp !== null) {
    const verb = current.gameNet >= 0 ? "rapportent" : "coûtent";
    const tone: Signal["tone"] = current.rtp > 100 ? "bad" : current.rtp >= 90 ? "warn" : "ok";
    signals.push({ tone, title: `Jeux : les joueurs récupèrent ${current.rtp.toFixed(0)} % des mises`, detail: `Sur la période, les jeux ${verb} ${f(Math.abs(current.gameNet))} (${f(current.bets)} misés, ${f(current.wins)} payés). ${current.rtp > 100 ? "Les gains dépassent les mises : revoyez les segments de la roue, les tours gratuits ou le coût du tour." : current.rtp >= 90 ? "La marge est mince : un coup de chance côté joueurs suffit à passer en perte." : "Marge confortable."}` });
  }

  if (current.real > 0.005 || current.wakati > 0.005 || current.real < -0.005 || current.wakati < -0.005) {
    if (current.net > 0 && current.real <= 0) signals.push({ tone: "warn", title: "Votre bénéfice est en WAKATI, pas en argent réel", detail: `Résultat en actifs réels (FCFA, crypto) : ${f(current.real)}. Résultat en WAKATI : ${f(current.wakati)}. Le WAKATI est le jeton de l'app : il ne paie pas vos frais ni vos retraits.` });
    else if (current.real > 0) signals.push({ tone: "ok", title: `Argent réel : ${f(current.real)} sur la période`, detail: `Résultat en WAKATI : ${f(current.wakati)}. Le résultat réel est celui qui compte pour vos dépenses.` });
    else signals.push({ tone: "bad", title: `Argent réel : ${f(current.real)} sur la période`, detail: `Résultat en WAKATI : ${f(current.wakati)}. La plateforme perd de la valeur réelle sur cette période.` });
  }

  const stakeRow = stake.rows[0];
  if (stakeRow && wakatiNow !== null) {
    const staked = Number(stakeRow.total_staked || 0); const apr = Number(stakeRow.apr || 0);
    const yearlyWakati = staked * apr / 100; const yearlyUsd = yearlyWakati * wakatiNow;
    const yearlyFees = last30.byCat.fees.usd * (365 / 30);
    signals.push({ tone: yearlyUsd > yearlyFees && yearlyFees > 0 ? "warn" : "info", title: `Staking : environ ${Math.round(yearlyWakati).toLocaleString("fr-FR")} WAKATI de récompenses par an`, detail: `${Math.round(staked).toLocaleString("fr-FR")} WAKATI stakés à ${apr.toFixed(1)} % ≈ ${f(yearlyUsd)} par an au cours actuel, contre environ ${f(yearlyFees)} par an de frais au rythme des 30 derniers jours.` });
  }

  if (wakatiNow !== null && wakatiPeak !== null && wakatiPeak > 0) {
    const drop = (1 - wakatiNow / wakatiPeak) * 100;
    if (drop >= 30) signals.push({ tone: "warn", title: `Le WAKATI est ${drop.toFixed(0)} % sous son pic récent`, detail: `Cours actuel ${wakatiNow.toFixed(5)} $ contre ${wakatiPeak.toFixed(5)} $ au plus haut des 31 derniers jours. Tous les montants en WAKATI valent moins en dollars : lisez aussi les montants natifs.` });
  }

  if (current.byCat.defaults.count > 0) signals.push({ tone: "info", title: `${current.byCat.defaults.count} prêt(s) score en défaut sur la période`, detail: `Montant non remboursé : ${f(-current.byCat.defaults.usd)}. Les prêts liquidés ne sont pas dans ce total.` });

  const tw = treasury.find((w) => w.asset === WAKATI);
  const wakatiIn = wakatiNet30;
  if (tw && wakatiIn < 0) {
    const days = tw.balance / (-wakatiIn / 30);
    signals.push({ tone: days < 365 ? "warn" : "ok", title: days < 365 ? `Trésorerie WAKATI : environ ${Math.round(days)} jours de réserve` : "Trésorerie WAKATI : plus d'un an de réserve", detail: `Au rythme des 30 derniers jours (${Math.round(-wakatiIn).toLocaleString("fr-FR")} WAKATI sortis nets), la trésorerie de ${Math.round(tw.balance).toLocaleString("fr-FR")} WAKATI est suffisante pour ${days < 365 ? `environ ${Math.round(days)} jours` : "plus d'un an"}.` });
  }

  if (unpriced.size) signals.push({ tone: "warn", title: "Actifs sans cours valide", detail: `${[...unpriced].join(", ")} : leurs flux sont exclus des totaux en dollars.` });

  return {
    periodDays, current, previous, months, signals, treasury, treasuryUsd,
    unpriced: [...unpriced], wakatiPrice: wakatiNow, wakatiPeak,
    valuationNote: (() => {
      const total = dayUsd + currentUsd;
      const pct = total > 0 ? (dayUsd / total) * 100 : null;
      return pct === null
        ? "Chaque flux est valorisé au prix du jour quand il est connu, sinon au cours actuel."
        : `Chaque flux est valorisé au prix du jour quand il est connu (WAKATI depuis le 4 septembre 2026, autres actifs selon l'historique de prix), sinon au cours actuel. ${pct.toFixed(0)} % de la valeur des flux est au prix du jour, ${(100 - pct).toFixed(0)} % au cours actuel (estimation, surtout du WAKATI plus ancien).`;
    })(),
    valuation: { dayUsd, currentUsd, dayPct: dayUsd + currentUsd > 0 ? (dayUsd / (dayUsd + currentUsd)) * 100 : null },
    error: [flows.error?.message, valuer.error, stake.error, wallets.error].filter(Boolean).join(" · ") || undefined,
    truncated: false
  };
}
