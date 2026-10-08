import { getSupabaseAdmin, fetchAll, loadPrices, q } from "@/lib/data";
import { isValidPrice } from "@/lib/valuation";

/**
 * Compte de résultat de la plateforme.
 *
 * Entrées : frais hors jeux, mises des joueurs.
 * Sorties : gains payés, récompenses de staking, bonus de parrainage, prêts score en défaut.
 * La marge des jeux (game_house_edge) n'est PAS comptée à part : elle fait déjà partie des mises (sinon double comptage).
 *
 * Valorisation : le WAKATI est valorisé au prix du jour quand il est connu (wakati_price_history, ~31 jours),
 * sinon au cours actuel ; les autres actifs au cours actuel. Un actif sans cours valide est signalé, jamais compté à 0 en silence.
 */

export type CatKey = "fees" | "game_bets" | "game_wins" | "staking" | "referral" | "defaults";

export const CATS: Record<CatKey, { label: string; sign: 1 | -1; hint: string }> = {
  fees: { label: "Frais (hors jeux)", sign: 1, hint: "Swap, retrait, prêts, achat WAKATI" },
  game_bets: { label: "Mises des joueurs", sign: 1, hint: "Tout ce que les joueurs ont misé (y compris la part jackpot, 5 %)" },
  game_wins: { label: "Gains payés aux joueurs", sign: -1, hint: "Inclut les gains des tours gratuits et du jackpot" },
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

interface Ev { cat: CatKey; asset: string; amount: number; ts: number; usd: number }

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
}


export interface Valuer {
  prices: Map<string, number>;
  wakatiNow: number | null;
  wakatiPeak: number | null;
  wakatiDaily: Map<string, number>;
  priceAt: (asset: string, ts: number) => number | null;
  error?: string;
}

/** Valorisation commune : WAKATI au prix du jour quand il est connu, sinon cours actuel ; autres actifs au cours actuel. */
export async function loadValuer(): Promise<Valuer> {
  const db = getSupabaseAdmin();
  const [hist, prices] = await Promise.all([
    q<any>(db.from("wakati_price_history").select("computed_for_date, final_price_usd, created_at").order("computed_for_date", { ascending: true }).order("created_at", { ascending: true })),
    loadPrices()
  ]);
  const wakatiDaily = new Map<string, number>();
  for (const h of hist.rows) { const p = Number(h.final_price_usd); if (isValidPrice(p)) wakatiDaily.set(String(h.computed_for_date).slice(0, 10), p); }
  const wakatiNow = prices.get(WAKATI) ?? null;
  const wakatiPeak = wakatiDaily.size ? Math.max(...wakatiDaily.values()) : null;
  const priceAt = (asset: string, ts: number): number | null => {
    if (asset === WAKATI) {
      const d = wakatiDaily.get(new Date(ts).toISOString().slice(0, 10));
      if (isValidPrice(d)) return d;
    }
    const p = prices.get(asset);
    return isValidPrice(p) ? p : null;
  };
  return { prices, wakatiNow, wakatiPeak, wakatiDaily, priceAt, error: hist.error };
}

function emptyTotals(): Totals {
  const byCat = {} as Totals["byCat"];
  (Object.keys(CATS) as CatKey[]).forEach((k) => { byCat[k] = { usd: 0, real: 0, wakati: 0, count: 0, native: new Map() }; });
  return { net: 0, real: 0, wakati: 0, byCat, bets: 0, wins: 0, gameNet: 0, rtp: null };
}

function aggregate(events: Ev[], from: number, to: number): Totals {
  const t = emptyTotals();
  for (const e of events) {
    if (e.ts < from || e.ts >= to) continue;
    const sign = CATS[e.cat].sign;
    const c = t.byCat[e.cat];
    const signed = sign * e.usd;
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
}

export async function loadPnl(periodDays: number, now = Date.now()): Promise<PnlReport> {
  const db = getSupabaseAdmin();
  const horizon = new Date(now - 400 * DAY).toISOString();
  const txTypes = Object.keys(TX_CAT);

  const [tx, fees, valuer, stake, wallets] = await Promise.all([
    fetchAll<any>((a, b) => db.from("transactions").select("type, asset_symbol, amount, created_at").eq("status", "completed").in("type", txTypes).gte("created_at", horizon).order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("platform_fees").select("asset_symbol, amount, collected_at").eq("is_test", false).not("fee_type", "in", "(game_house_edge,game_net_loss)").gte("collected_at", horizon).order("id").range(a, b)),
    loadValuer(),
    q<any>(db.from("admin_staking_overview").select("total_staked, apr").eq("asset_symbol", WAKATI)),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance"))
  ]);

  const { prices, wakatiNow, wakatiPeak, priceAt } = valuer;
  const unpriced = new Set<string>();

  const events: Ev[] = [];
  const push = (cat: CatKey, asset: string, amount: number, ts: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const p = priceAt(asset, ts);
    if (p === null) unpriced.add(asset);
    events.push({ cat, asset, amount, ts, usd: p === null ? 0 : amount * p });
  };
  for (const r of tx.rows) { const cat = TX_CAT[r.type]; if (cat) push(cat, String(r.asset_symbol), Number(r.amount), new Date(r.created_at).getTime()); }
  for (const r of fees.rows) push("fees", String(r.asset_symbol), Number(r.amount), new Date(r.collected_at).getTime());

  const end = now + 1;
  const start = periodDays > 0 ? now - periodDays * DAY : 0;
  const current = aggregate(events, start, end);
  const previous = periodDays > 0 ? aggregate(events, start - periodDays * DAY, start) : null;

  // Mensuel : 12 derniers mois
  const months: PnlReport["months"] = [];
  const base = new Date(now);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const t = aggregate(events, d.getTime(), next);
    months.push({ key: d.toISOString().slice(0, 7), fees: t.byCat.fees.usd, game: t.gameNet, costs: t.byCat.staking.usd + t.byCat.referral.usd + t.byCat.defaults.usd, net: t.net });
  }

  // Trésorerie actuelle
  const treasury = wallets.rows.map((w) => {
    const asset = String(w.asset_symbol); const balance = Number(w.balance || 0); const price = prices.get(asset) ?? null;
    return { asset, balance, price, usd: price === null ? null : balance * price };
  }).filter((w) => w.balance > 0).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const treasuryUsd = treasury.reduce((s, w) => s + (w.usd ?? 0), 0);

  // Signaux de décision (toujours sur les 30 derniers jours pour les projections)
  const last30 = aggregate(events, now - 30 * DAY, end);
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
  const wakatiIn = events.filter((e) => e.asset === WAKATI && e.ts >= now - 30 * DAY).reduce((s, e) => s + CATS[e.cat].sign * e.amount, 0);
  if (tw && wakatiIn < 0) {
    const days = tw.balance / (-wakatiIn / 30);
    signals.push({ tone: days < 365 ? "warn" : "ok", title: days < 365 ? `Trésorerie WAKATI : environ ${Math.round(days)} jours de réserve` : "Trésorerie WAKATI : plus d'un an de réserve", detail: `Au rythme des 30 derniers jours (${Math.round(-wakatiIn).toLocaleString("fr-FR")} WAKATI sortis nets), la trésorerie de ${Math.round(tw.balance).toLocaleString("fr-FR")} WAKATI est suffisante pour ${days < 365 ? `environ ${Math.round(days)} jours` : "plus d'un an"}.` });
  }

  if (unpriced.size) signals.push({ tone: "warn", title: "Actifs sans cours valide", detail: `${[...unpriced].join(", ")} : leurs flux sont exclus des totaux en dollars.` });

  return {
    periodDays, current, previous, months, signals, treasury, treasuryUsd,
    unpriced: [...unpriced], wakatiPrice: wakatiNow, wakatiPeak,
    valuationNote: "Le WAKATI est valorisé au prix du jour quand il est connu (environ 31 derniers jours), sinon au cours actuel. Les autres actifs sont valorisés au cours actuel.",
    error: [tx.error, fees.error, valuer.error, stake.error, wallets.error].filter(Boolean).join(" · ") || undefined,
    truncated: !!(tx.truncated || fees.truncated)
  };
}
