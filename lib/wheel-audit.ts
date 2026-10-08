import { getSupabaseAdmin, fetchAll, q } from "@/lib/data";
import { loadValuer } from "@/lib/pnl";
import type { SignalItem } from "@/components/signals";

const DAY = 86_400_000;

interface Segment { id: number; label: string; reward_type: string; asset_symbol: string | null; reward_amount: number | null; probability: number; is_jackpot: boolean }
interface Spin { id: string; segment_id: number; bet_amount: number | string | null; bet_asset: string | null; final_reward_amount: number | string | null; reward_asset: string | null; created_at: string }

export interface WheelReport {
  periodDays: number;
  config: { costAmount: number; costAsset: string; jackpotPct: number; jackpotAmount: number; jackpotAsset: string } | null;
  theory: { evNative: number; evUsd: number | null; costUsd: number | null; rtpPct: number | null; houseEdgePct: number | null; breakEvenPrice: number | null; wakatiPrice: number | null; singleAsset: string | null } | null;
  observed: { spins: number; paid: number; free: number; betsUsd: number; paidPayoutUsd: number; freePayoutUsd: number; netUsd: number; rtpPaidPct: number | null; rtpAllPct: number | null; avgPayout: number | null; z: number | null };
  segments: { label: string; probability: number; expected: number; observed: number; z: number | null }[];
  oldSegmentSpins: number;
  byBetAsset: { asset: string; spins: number; bets: number; betsUsd: number; payoutUsd: number; rtp: number | null }[];
  signals: SignalItem[];
  error?: string;
}

export async function loadWheelAudit(periodDays: number, now = Date.now()): Promise<WheelReport> {
  const db = getSupabaseAdmin();
  const since = periodDays > 0 ? now - periodDays * DAY : 0;
  const [segRes, cfgRes, spinRes, valuer] = await Promise.all([
    q<any>(db.from("wheel_segments").select("id, label, reward_type, asset_symbol, reward_amount, probability, is_jackpot").eq("is_active", true)),
    q<any>(db.from("wheel_config").select("paid_spin_cost_amount, paid_spin_cost_asset, jackpot_contribution_pct, jackpot_current_amount, jackpot_asset_symbol").eq("id", 1)),
    fetchAll<Spin>((a, b) => db.from("wheel_spins").select("id, segment_id, bet_amount, bet_asset, final_reward_amount, reward_asset, created_at").gte("created_at", new Date(since).toISOString()).order("id").range(a, b)),
    loadValuer()
  ]);

  const segs: Segment[] = segRes.rows.map((s) => ({ id: Number(s.id), label: String(s.label), reward_type: String(s.reward_type), asset_symbol: s.asset_symbol, reward_amount: s.reward_amount === null ? null : Number(s.reward_amount), probability: Number(s.probability), is_jackpot: !!s.is_jackpot }));
  const pSum = segs.reduce((s, x) => s + x.probability, 0) || 1;
  const prob = (s: Segment) => s.probability / pSum;
  const c = cfgRes.rows[0];
  const config = c ? { costAmount: Number(c.paid_spin_cost_amount), costAsset: String(c.paid_spin_cost_asset), jackpotPct: Number(c.jackpot_contribution_pct), jackpotAmount: Number(c.jackpot_current_amount), jackpotAsset: String(c.jackpot_asset_symbol) } : null;

  // ─ Théorie (configuration actuelle) ─
  const assets = new Set(segs.map((s) => s.asset_symbol).filter(Boolean) as string[]);
  const singleAsset = assets.size === 1 ? [...assets][0] : null;
  const evNative = segs.reduce((s, x) => s + prob(x) * (x.reward_amount ?? 0), 0);
  let evUsd: number | null = 0;
  for (const x of segs) { const p = x.asset_symbol ? valuer.prices.get(x.asset_symbol) : undefined; if (!p) { evUsd = null; break; } evUsd += prob(x) * (x.reward_amount ?? 0) * p; }
  const costPrice = config ? valuer.prices.get(config.costAsset) ?? null : null;
  const costUsd = config && costPrice !== null ? config.costAmount * costPrice : null;
  const rtpPct = evUsd !== null && costUsd ? (evUsd / costUsd) * 100 : null;
  const theory = config ? {
    evNative, evUsd, costUsd, rtpPct, houseEdgePct: rtpPct === null ? null : 100 - rtpPct,
    breakEvenPrice: singleAsset && costUsd && evNative > 0 ? costUsd / evNative : null,
    wakatiPrice: singleAsset ? valuer.prices.get(singleAsset) ?? null : null, singleAsset
  } : null;

  // ─ Observé ─
  const spins = spinRes.rows;
  const isPaid = (s: Spin) => Number(s.bet_amount || 0) > 0;
  let betsUsd = 0, paidPayoutUsd = 0, freePayoutUsd = 0, paid = 0, free = 0, payoutNativeSum = 0, payoutN = 0;
  const bet = new Map<string, { spins: number; bets: number; betsUsd: number; payoutUsd: number }>();
  for (const s of spins) {
    const ts = new Date(s.created_at).getTime();
    const rAsset = s.reward_asset ?? singleAsset ?? "WAKATI";
    const rp = valuer.priceAt(rAsset, ts) ?? 0;
    const payUsd = Number(s.final_reward_amount || 0) * rp;
    payoutNativeSum += Number(s.final_reward_amount || 0); payoutN += 1;
    if (isPaid(s)) {
      paid++;
      const ba = s.bet_asset ?? "?"; const bp = valuer.priceAt(ba, ts) ?? 0; const bu = Number(s.bet_amount) * bp;
      betsUsd += bu; paidPayoutUsd += payUsd;
      const g = bet.get(ba) ?? { spins: 0, bets: 0, betsUsd: 0, payoutUsd: 0 };
      g.spins++; g.bets += Number(s.bet_amount); g.betsUsd += bu; g.payoutUsd += payUsd; bet.set(ba, g);
    } else { free++; freePayoutUsd += payUsd; }
  }
  const avgPayout = payoutN ? payoutNativeSum / payoutN : null;
  let z: number | null = null;
  if (singleAsset && payoutN >= 30 && evNative > 0) {
    const variance = segs.reduce((s, x) => s + prob(x) * Math.pow((x.reward_amount ?? 0) - evNative, 2), 0);
    z = variance > 0 ? ((avgPayout as number) - evNative) / Math.sqrt(variance / payoutN) : null;
  }

  // Répartition par segment (segments actifs)
  const n = spins.length;
  const known = new Set(segs.map((s) => s.id));
  const segments = segs.map((s) => {
    const observed = spins.filter((x) => x.segment_id === s.id).length;
    const p = prob(s); const expected = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    return { label: s.label, probability: p * 100, expected, observed, z: n >= 30 && sd > 0 ? (observed - expected) / sd : null };
  }).sort((a, b) => b.probability - a.probability);
  const oldSegmentSpins = spins.filter((x) => !known.has(x.segment_id)).length;

  const byBetAsset = [...bet.entries()].map(([asset, g]) => ({ asset, ...g, rtp: g.betsUsd > 0 ? (g.payoutUsd / g.betsUsd) * 100 : null })).sort((a, b) => b.spins - a.spins);

  const observed = {
    spins: n, paid, free, betsUsd, paidPayoutUsd, freePayoutUsd, netUsd: betsUsd - paidPayoutUsd - freePayoutUsd,
    rtpPaidPct: betsUsd > 0 ? (paidPayoutUsd / betsUsd) * 100 : null, rtpAllPct: betsUsd > 0 ? ((paidPayoutUsd + freePayoutUsd) / betsUsd) * 100 : null, avgPayout, z
  };

  // ─ Signaux ─
  const f = (x: number) => `${x < 0 ? "-" : ""}${Math.abs(x).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
  const signals: SignalItem[] = [];
  if (theory && theory.rtpPct !== null && theory.costUsd !== null && theory.evUsd !== null && config) {
    signals.push({ tone: theory.rtpPct >= 100 ? "bad" : theory.rtpPct >= 80 ? "warn" : "ok", title: `Théorie : le joueur récupère ${theory.rtpPct.toFixed(0)} % de sa mise`, detail: `Un tour coûte ${config.costAmount} ${config.costAsset} (${f(theory.costUsd)}) et verse en moyenne ${theory.evNative.toFixed(1)} ${theory.singleAsset ?? ""} (${f(theory.evUsd)}) au cours actuel. Marge théorique : ${(theory.houseEdgePct ?? 0).toFixed(0)} %.` });
  }
  if (theory?.breakEvenPrice && theory.wakatiPrice) {
    const ratio = theory.wakatiPrice / theory.breakEvenPrice;
    signals.push({ tone: ratio >= 1 ? "bad" : ratio >= 0.5 ? "warn" : "ok", title: `Seuil de rentabilité : ${theory.breakEvenPrice.toFixed(5)} $ par ${theory.singleAsset}`, detail: `Le jeu devient perdant si le ${theory.singleAsset} dépasse ce prix. Prix actuel : ${theory.wakatiPrice.toFixed(5)} $ (${(ratio * 100).toFixed(0)} % du seuil)${valuer.wakatiPeak && theory.singleAsset === "WAKATI" ? `, pic des 31 derniers jours : ${valuer.wakatiPeak.toFixed(5)} $` : ""}. Le coût d'un tour étant en FCFA et les gains en ${theory.singleAsset}, c'est le prix du ${theory.singleAsset} qui décide de votre marge.` });
  }
  if (observed.z !== null) {
    const az = Math.abs(observed.z);
    signals.push({ tone: az > 3 ? "bad" : az > 2 ? "warn" : "ok", title: az > 3 ? "Écart anormal entre les gains réels et la roue configurée" : az > 2 ? "Écart notable entre les gains réels et la roue" : "Le tirage est conforme à la roue configurée", detail: `Gain moyen observé : ${(observed.avgPayout ?? 0).toFixed(1)} ${theory?.singleAsset ?? ""} pour ${(theory?.evNative ?? 0).toFixed(1)} attendus sur ${n} tours (écart statistique : ${observed.z.toFixed(1)} écart-type). ${az > 3 ? "Vérifiez la configuration des segments et la fonction de tirage." : "En dessous de 2, l'écart s'explique par le hasard."}` });
  } else if (n > 0) signals.push({ tone: "info", title: "Trop peu de tours pour tester l'équité", detail: `${n} tour(s) sur la période : il en faut au moins 30 pour comparer aux probabilités.` });
  if (observed.free > 0) signals.push({ tone: "info", title: `Tours gratuits : ${f(observed.freePayoutUsd)} versés`, detail: `${observed.free} tours gratuits sur ${n} (${((observed.free / Math.max(n, 1)) * 100).toFixed(0)} %). Ils ne rapportent rien mais versent des gains : c'est votre coût d'acquisition. ${observed.betsUsd > 0 ? `Soit ${((observed.freePayoutUsd / observed.betsUsd) * 100).toFixed(0)} % des mises encaissées.` : ""}` });
  if (config && config.jackpotAmount > 0 && !segs.some((s) => s.is_jackpot)) signals.push({ tone: "warn", title: `Jackpot de ${config.jackpotAmount} ${config.jackpotAsset} impossible à gagner`, detail: `${config.jackpotPct} % de chaque mise alimente une cagnotte, mais aucun segment actif n'est marqué jackpot. Soit vous ajoutez le segment, soit vous retirez la contribution : les joueurs financent aujourd'hui une cagnotte qu'ils ne peuvent pas gagner.` });
  if (oldSegmentSpins > 0) signals.push({ tone: "info", title: `${oldSegmentSpins} tour(s) sur des segments aujourd'hui désactivés`, detail: "La roue a été reconfigurée pendant la période : la comparaison avec les probabilités actuelles est approximative. Choisissez une période plus courte pour un test précis." });

  return { periodDays, config, theory, observed, segments, oldSegmentSpins, byBetAsset, signals, error: [segRes.error, cfgRes.error, spinRes.error, valuer.error].filter(Boolean).join(" · ") || undefined };
}
