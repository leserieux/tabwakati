import { getSupabaseAdmin, fetchAll, loadPrices, q } from "@/lib/data";
import { isValidPrice } from "./pricing";
import { FEE_TYPE_EXCLUSION_FILTER } from "./rules";
import type { FinancialMetrics, FinancialCategoryKey } from "./types";

const DAY = 86_400_000;
const WAKATI = "WAKATI";

type CatKey = FinancialCategoryKey;

const CATS: Record<CatKey, { label: string; sign: 1 | -1; hint: string }> = {
  fees: { label: "Frais (hors jeux)", sign: 1, hint: "Swap, retrait, prêts, achat WAKATI" },
  game_bets: { label: "Mises des joueurs", sign: 1, hint: "Tout ce que les joueurs ont misé (y compris la part jackpot, 5 %)" },
  game_wins: { label: "Gains payés aux joueurs", sign: -1, hint: "Inclut les gains des tours gratuits et du jackpot" },
  staking: { label: "Récompenses de staking", sign: -1, hint: "Versées aux utilisateurs qui stakent" },
  referral: { label: "Bonus de parrainage", sign: -1, hint: "Versés aux parrains" },
  defaults: { label: "Prêts score en défaut", sign: -1, hint: "Montant en défaut moins les sommes recouvrées ensuite. Les prêts liquidés ne sont pas inclus." },
};

const TX_CAT: Record<string, CatKey> = {
  game_bet: "game_bets",
  game_win: "game_wins",
  staking_reward: "staking",
  referral_bonus: "referral",
  score_loan_defaulted: "defaults",
  score_loan_debt_recovered: "defaults",
};

/** Types qui annulent (en partie) une catégorie : un défaut recouvré n'est plus une perte. */
const REVERSAL_TYPES = new Set(["score_loan_debt_recovered"]);

interface Event {
  cat: CatKey;
  asset: string;
  amount: number;
  ts: number;
  usd: number;
  /** +1 : événement de la catégorie ; -1 : annulation (ex. défaut recouvré). */
  dir: 1 | -1;
}

function emptyTotals() {
  const byCat = {} as Record<CatKey, any>;
  (Object.keys(CATS) as CatKey[]).forEach((k) => {
    byCat[k] = { usd: 0, real: 0, wakati: 0, count: 0, native: new Map<string, number>() };
  });
  return { byCat, realTotal: 0, wakatiTotal: 0, netTotal: 0, gameBets: 0, gameWins: 0, gameNet: 0, gameRtp: null as number | null };
}

function aggregate(events: Event[], from: number, to: number) {
  const totals = emptyTotals();
  for (const e of events) {
    if (e.ts < from || e.ts >= to) continue;
    const sign = CATS[e.cat].sign;
    const c = totals.byCat[e.cat];
    const signed = sign * e.dir * e.usd;
    c.usd += signed;
    c.count += e.dir;
    c.native.set(e.asset, (c.native.get(e.asset) ?? 0) + e.dir * e.amount);
    if (e.asset === WAKATI) {
      c.wakati += signed;
      totals.wakatiTotal += signed;
    } else {
      c.real += signed;
      totals.realTotal += signed;
    }
  }
  totals.netTotal = totals.realTotal + totals.wakatiTotal;
  totals.gameBets = totals.byCat.game_bets.usd;
  totals.gameWins = -totals.byCat.game_wins.usd;
  totals.gameNet = totals.gameBets - totals.gameWins;
  totals.gameRtp = totals.gameBets > 0 ? (totals.gameWins / totals.gameBets) * 100 : null;
  return totals;
}

export async function loadFinancialMetrics(options: { period?: number } = {}): Promise<FinancialMetrics> {
  const db = getSupabaseAdmin();
  const now = Date.now();
  // Attention : 0 = « depuis le début » ; ne pas utiliser || ici.
  const period = options.period ?? 30;
  const horizon = new Date(now - 400 * DAY).toISOString();
  const txTypes = Object.keys(TX_CAT);

  const [tx, fees, hist, prices, stake, wallets] = await Promise.all([
    fetchAll<any>((a, b) =>
      db
        .from("transactions")
        .select("type, asset_symbol, amount, created_at")
        .eq("status", "completed")
        .in("type", txTypes)
        .gte("created_at", horizon)
        .order("id")
        .range(a, b)
    ),
    fetchAll<any>((a, b) =>
      db
        .from("platform_fees")
        .select("asset_symbol, amount, collected_at")
        .eq("is_test", false)
        .not("fee_type", "in", FEE_TYPE_EXCLUSION_FILTER)
        .gte("collected_at", horizon)
        .order("id")
        .range(a, b)
    ),
    q<any>(db.from("wakati_price_history").select("computed_for_date, final_price_usd, created_at").order("computed_for_date", { ascending: true }).order("created_at", { ascending: true })),
    loadPrices(),
    q<any>(db.from("admin_staking_overview").select("total_staked, apr").eq("asset_symbol", WAKATI)),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance")),
  ]);

  const wakatiDaily = new Map<string, number>();
  for (const h of hist.rows) {
    const p = Number(h.final_price_usd);
    if (isValidPrice(p)) wakatiDaily.set(String(h.computed_for_date).slice(0, 10), p);
  }
  const wakatiNow = prices.get(WAKATI) ?? null;
  // Pic sur les 31 derniers jours uniquement (le texte du signal l'annonce ainsi).
  const peakFrom = new Date(now - 31 * DAY).toISOString().slice(0, 10);
  const recentWakati = [...wakatiDaily.entries()].filter(([day]) => day >= peakFrom).map(([, price]) => price);
  const wakatiPeak = recentWakati.length ? Math.max(...recentWakati) : null;

  const unpriced = new Set<string>();
  const priceAt = (asset: string, ts: number): number | null => {
    if (asset === WAKATI) {
      const d = wakatiDaily.get(new Date(ts).toISOString().slice(0, 10));
      if (isValidPrice(d)) return d;
    }
    const p = prices.get(asset);
    return isValidPrice(p) ? p : null;
  };

  const events: Event[] = [];
  const push = (cat: CatKey, asset: string, amount: number, ts: number, dir: 1 | -1 = 1) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const p = priceAt(asset, ts);
    if (p === null) unpriced.add(asset);
    events.push({ cat, asset, amount, ts, usd: p === null ? 0 : amount * p, dir });
  };

  for (const r of tx.rows) {
    const cat = TX_CAT[r.type];
    if (cat) push(cat, String(r.asset_symbol), Number(r.amount), new Date(r.created_at).getTime(), REVERSAL_TYPES.has(r.type) ? -1 : 1);
  }
  for (const r of fees.rows) {
    push("fees", String(r.asset_symbol), Number(r.amount), new Date(r.collected_at).getTime());
  }

  const end = now + 1;
  const start = period > 0 ? now - period * DAY : 0;
  const current = aggregate(events, start, end);
  const previous = period > 0 ? aggregate(events, start - period * DAY, start) : null;

  // Mensuel : 12 derniers mois
  const monthlyBreakdown: FinancialMetrics["monthlyBreakdown"] = [];
  const base = new Date(now);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const t = aggregate(events, d.getTime(), next);
    monthlyBreakdown.push({
      key: d.toISOString().slice(0, 7),
      fees: t.byCat.fees.usd,
      game: t.gameNet,
      costs: t.byCat.staking.usd + t.byCat.referral.usd + t.byCat.defaults.usd,
      net: t.netTotal,
    });
  }

  // Trésorerie actuelle
  const treasury = wallets.rows
    .map((w) => {
      const asset = String(w.asset_symbol);
      const balance = Number(w.balance || 0);
      const price = prices.get(asset) ?? null;
      return { asset, balance, price, usd: price === null ? null : balance * price };
    })
    .filter((w) => w.balance > 0)
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const treasuryUsd = treasury.reduce((s, w) => s + (w.usd ?? 0), 0);

  // Signaux de décision (projections toujours sur les 30 derniers jours)
  const last30 = aggregate(events, now - 30 * DAY, end);
  const signals: FinancialMetrics["signals"] = [];
  const f = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

  if (current.gameBets > 0 && current.gameRtp !== null) {
    const verb = current.gameNet >= 0 ? "rapportent" : "coûtent";
    const tone: FinancialMetrics["signals"][number]["tone"] = current.gameRtp > 100 ? "bad" : current.gameRtp >= 90 ? "warn" : "ok";
    const advice =
      current.gameRtp > 100
        ? "Les gains dépassent les mises : revoyez les segments de la roue, les tours gratuits ou le coût du tour."
        : current.gameRtp >= 90
          ? "La marge est mince : un coup de chance côté joueurs suffit à passer en perte."
          : "Marge confortable.";
    signals.push({
      tone,
      title: `Jeux : les joueurs récupèrent ${current.gameRtp.toFixed(0)} % des mises`,
      detail: `Sur la période, les jeux ${verb} ${f(Math.abs(current.gameNet))} (${f(current.gameBets)} misés, ${f(current.gameWins)} payés). ${advice}`,
    });
  }

  if (Math.abs(current.realTotal) > 0.005 || Math.abs(current.wakatiTotal) > 0.005) {
    if (current.netTotal > 0 && current.realTotal <= 0) {
      signals.push({
        tone: "warn",
        title: "Votre bénéfice est en WAKATI, pas en argent réel",
        detail: `Résultat en actifs réels (FCFA, crypto) : ${f(current.realTotal)}. Résultat en WAKATI : ${f(current.wakatiTotal)}. Le WAKATI est le jeton de l'app : il ne paie pas vos frais ni vos retraits.`,
      });
    } else if (current.realTotal > 0) {
      signals.push({
        tone: "ok",
        title: `Argent réel : ${f(current.realTotal)} sur la période`,
        detail: `Résultat en WAKATI : ${f(current.wakatiTotal)}. Le résultat réel est celui qui compte pour vos dépenses.`,
      });
    } else {
      signals.push({
        tone: "bad",
        title: `Argent réel : ${f(current.realTotal)} sur la période`,
        detail: `Résultat en WAKATI : ${f(current.wakatiTotal)}. La plateforme perd de la valeur réelle sur cette période.`,
      });
    }
  }

  const stakeRow = stake.rows[0];
  if (stakeRow && wakatiNow !== null) {
    const staked = Number(stakeRow.total_staked || 0);
    const apr = Number(stakeRow.apr || 0);
    const yearlyWakati = (staked * apr) / 100;
    const yearlyUsd = yearlyWakati * wakatiNow;
    const yearlyFees = last30.byCat.fees.usd * (365 / 30);
    signals.push({
      tone: yearlyUsd > yearlyFees && yearlyFees > 0 ? "warn" : "info",
      title: `Staking : environ ${Math.round(yearlyWakati).toLocaleString("fr-FR")} WAKATI de récompenses par an`,
      detail: `${Math.round(staked).toLocaleString("fr-FR")} WAKATI stakés à ${apr.toFixed(1)} % ≈ ${f(yearlyUsd)} par an au cours actuel, contre environ ${f(yearlyFees)} par an de frais au rythme des 30 derniers jours.`,
    });
  }

  if (wakatiNow !== null && wakatiPeak !== null && wakatiPeak > 0) {
    const drop = (1 - wakatiNow / wakatiPeak) * 100;
    if (drop >= 30) {
      signals.push({
        tone: "warn",
        title: `Le WAKATI est ${drop.toFixed(0)} % sous son pic récent`,
        detail: `Cours actuel ${wakatiNow.toFixed(5)} $ contre ${wakatiPeak.toFixed(5)} $ au plus haut des 31 derniers jours. Tous les montants en WAKATI valent moins en dollars : lisez aussi les montants natifs.`,
      });
    }
  }

  if (current.byCat.defaults.count > 0 && current.byCat.defaults.usd < 0) {
    signals.push({
      tone: "info",
      title: `${current.byCat.defaults.count} prêt(s) score en défaut non recouvré(s) sur la période`,
      detail: `Montant non remboursé (après recouvrements) : ${f(-current.byCat.defaults.usd)}. Les prêts liquidés ne sont pas dans ce total.`,
    });
  }

  const tw = treasury.find((w) => w.asset === WAKATI);
  const wakatiIn = events.filter((e) => e.asset === WAKATI && e.ts >= now - 30 * DAY).reduce((s, e) => s + CATS[e.cat].sign * e.dir * e.amount, 0);
  if (tw && wakatiIn < 0) {
    const days = tw.balance / (-wakatiIn / 30);
    signals.push({
      tone: days < 365 ? "warn" : "ok",
      title: days < 365 ? `Trésorerie WAKATI : environ ${Math.round(days)} jours de réserve` : "Trésorerie WAKATI : plus d'un an de réserve",
      detail: `Au rythme des 30 derniers jours (${Math.round(-wakatiIn).toLocaleString("fr-FR")} WAKATI sortis nets), la trésorerie de ${Math.round(tw.balance).toLocaleString("fr-FR")} WAKATI est suffisante pour ${days < 365 ? `environ ${Math.round(days)} jours` : "plus d'un an"}.`,
    });
  }

  if (unpriced.size) {
    signals.push({
      tone: "warn",
      title: "Actifs sans cours valide",
      detail: `${[...unpriced].join(", ")} : leurs flux sont exclus des totaux en dollars.`,
    });
  }

  return {
    period,
    byCat: current.byCat,
    realTotal: current.realTotal,
    wakatiTotal: current.wakatiTotal,
    netTotal: current.netTotal,
    gameBets: current.gameBets,
    gameWins: current.gameWins,
    gameNet: current.gameNet,
    gameRtp: current.gameRtp,
    deltaPrevious: previous ? current.netTotal - previous.netTotal : null,
    monthlyBreakdown,
    signals,
    treasury,
    treasuryUsd,
    unpriced: [...unpriced],
    wakatiPrice: wakatiNow,
    wakatiPeak,
    truncated: !!(tx.truncated || fees.truncated),
    error: [tx.error, fees.error, hist.error, stake.error, wallets.error].filter(Boolean).join(" · ") || undefined,
  };
}
