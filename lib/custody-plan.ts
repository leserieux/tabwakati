/**
 * Plan de réserve de retrait : pour chaque actif, combien garder « à portée de main » pour payer les retraits,
 * et combien d'argent libre peut travailler. Logique PURE (aucun accès à la base) pour pouvoir la tester.
 *
 * Vocabulaire (le même que sur la page) :
 *   - portefeuille de retrait = l'argent prêt à partir quand quelqu'un retire (le « chaud »)
 *   - coffre                  = l'argent mis à l'abri (le « froid »)
 *   - cible                   = ce qu'il faut avoir dans le portefeuille de retrait
 */

import { isValidPrice } from "@/lib/valuation";

export const EPS = 0.00000001;
/** Un écart de moins de ce montant en dollars est de la poussière : on ne dérange personne pour ça. */
export const DUST_USD = 1;

export interface Policy {
  asset_symbol: string;
  min_hot: number; // plancher à toujours garder prêt (en unités de l'actif)
  days_cover: number; // nombre de jours de retraits de pointe à couvrir
  low_pct: number; // alerte « à remplir » sous ce % de la cible
  high_pct: number; // alerte « trop plein » au-dessus de ce % de la cible
  invest_pct: number; // % de l'argent libre qu'on accepte de faire travailler
  safety_pct: number; // marge gardée en plus de ce qui est dû, en % du dû
}

export const DEFAULT_POLICY: Omit<Policy, "asset_symbol"> = {
  min_hot: 0,
  days_cover: 3,
  low_pct: 50,
  high_pct: 150,
  invest_pct: 0,
  safety_pct: 20
};

export interface WithdrawalStat {
  withdrawals_count: number;
  total_out: number;
  max_single: number;
  peak_day_out: number; // le plus gros total retiré en une seule journée
  avg_day_out: number;
  biggest_user_balance: number; // le plus gros solde disponible d'un seul utilisateur
}

export const EMPTY_STAT: WithdrawalStat = {
  withdrawals_count: 0,
  total_out: 0,
  max_single: 0,
  peak_day_out: 0,
  avg_day_out: 0,
  biggest_user_balance: 0
};

/** Ce que la solvabilité sait déjà d'un actif (voir lib/solvency.ts, type Line). */
export interface HoldingInput {
  asset: string;
  label: string;
  kind: "crypto" | "mobile";
  owe: number; // ce qu'on doit aux utilisateurs
  have: number | null; // ce qu'on détient réellement (null = lecture impossible)
  hot: number | null; // dans le portefeuille de retrait (ou chez le prestataire pour l'argent mobile)
  vault: number; // dans le coffre
  onUsers: number; // pas encore ramassé sur les adresses des utilisateurs
  priceUsd: number | null;
  error?: string;
}

export type PlanState = "ok" | "refill" | "danger" | "excess" | "unknown" | "nothing";
export type NeedRule = "floor" | "biggest" | "peak";

export interface PlanLine extends HoldingInput {
  policy: Policy;
  stat: WithdrawalStat;
  swapStock: number; // stock interne des swaps (treasury_wallets) : les swaps paient depuis le même portefeuille
  reservedForSwaps: number; // la part du portefeuille réservée aux swaps (jamais plus que ce qu'il contient)
  withdrawable: number | null; // ce qui reste dans le portefeuille pour payer les retraits = portefeuille − réservé aux swaps
  need: { floor: number; biggest: number; peak: number; winner: NeedRule };
  target: number; // ce qu'il faut pour payer les retraits (en plus du stock des swaps)
  low: number;
  high: number;
  state: PlanState;
  move: number; // > 0 : à ajouter (états refill/danger) ou à mettre au coffre (état excess)
  surplus: number | null; // détenu − dû
  freeSurplus: number; // argent libre : surplus − stock des swaps − marge de sécurité
  canWork: number; // la part de l'argent libre qu'on accepte de faire travailler
}

/** Valeur en dollars ; null si le prix est absent ou invalide (jamais compté silencieusement à 0 $). */
export function toUsd(amount: number, price: number | null | undefined): number | null {
  return isValidPrice(price) ? amount * price : null;
}

export function computePlan(h: HoldingInput, policy: Policy, stat: WithdrawalStat, swapStock: number): PlanLine {
  // Ce qu'il faut garder prêt = le plus grand de trois besoins, sans jamais dépasser ce qu'on doit :
  //  1. le plancher choisi ;  2. le plus gros solde d'un seul utilisateur (le pire retrait unique) ;
  //  3. quelques jours de retraits de pointe (le pire jour des 90 derniers jours × le nombre de jours).
  const floor = policy.min_hot;
  const biggest = Math.min(stat.biggest_user_balance, h.owe);
  const peak = policy.days_cover * stat.peak_day_out;
  const needMax = Math.max(floor, biggest, peak);
  const winner: NeedRule = needMax === floor && floor > 0 ? "floor" : needMax === biggest ? "biggest" : "peak";
  const target = Math.min(h.owe, needMax);
  const low = (target * policy.low_pct) / 100;
  const high = (target * policy.high_pct) / 100;

  const surplus = h.have !== null ? h.have - h.owe : null;
  const safety = (h.owe * policy.safety_pct) / 100;
  const freeSurplus = surplus !== null ? Math.max(0, surplus - swapStock - safety) : 0;
  const canWork = (freeSurplus * policy.invest_pct) / 100;

  // Les swaps paient depuis le même portefeuille : leur stock ne sert pas aux retraits (et ne doit jamais partir au coffre).
  const reservedForSwaps = h.hot !== null ? Math.min(swapStock, h.hot) : swapStock;
  const withdrawable = h.hot !== null ? h.hot - reservedForSwaps : null;

  let state: PlanState;
  let move = 0;
  if (h.have === null || withdrawable === null) {
    state = "unknown";
  } else if (h.owe <= EPS) {
    state = "nothing";
  } else if (withdrawable + EPS < biggest) {
    state = "danger"; // même le plus gros utilisateur ne pourrait pas tout retirer d'un coup
    move = target - withdrawable;
  } else if (withdrawable + EPS < low) {
    state = "refill";
    move = target - withdrawable;
  } else if (withdrawable > high + EPS) {
    state = "excess";
    move = withdrawable - target;
  } else {
    state = "ok";
  }

  // Poussière : si l'écart vaut moins de DUST_USD dollars, ce n'est pas la peine d'alerter.
  const moveUsd = toUsd(move, h.priceUsd);
  if ((state === "refill" || state === "danger" || state === "excess") && moveUsd !== null && moveUsd < DUST_USD) {
    state = "ok";
    move = 0;
  }

  return { ...h, policy, stat, swapStock, reservedForSwaps, withdrawable, need: { floor, biggest, peak, winner }, target, low, high, state, move, surplus, freeSurplus, canWork };
}

export type Verdict = "ok" | "warn" | "bad" | "unknown";

export interface Summary {
  verdict: Verdict;
  danger: PlanLine[];
  refill: PlanLine[];
  excess: PlanLine[];
  unknown: PlanLine[];
  canWorkUsd: number;
  freeUsd: number;
  unpriced: string[]; // actifs avec de l'argent libre mais sans prix : exclus des totaux en dollars
}

export function summarize(plans: PlanLine[]): Summary {
  const danger = plans.filter((p) => p.state === "danger");
  const refill = plans.filter((p) => p.state === "refill");
  const excess = plans.filter((p) => p.state === "excess");
  const unknown = plans.filter((p) => p.state === "unknown");
  let canWorkUsd = 0;
  let freeUsd = 0;
  const unpriced: string[] = [];
  for (const p of plans) {
    if (p.freeSurplus <= EPS) continue;
    if (!isValidPrice(p.priceUsd)) {
      unpriced.push(p.asset);
      continue;
    }
    canWorkUsd += p.canWork * p.priceUsd;
    freeUsd += p.freeSurplus * p.priceUsd;
  }
  const verdict: Verdict = danger.length > 0 ? "bad" : refill.length > 0 ? "warn" : unknown.length > 0 ? "unknown" : "ok";
  return { verdict, danger, refill, excess, unknown, canWorkUsd, freeUsd, unpriced };
}

/** Position (0 à 1) d'une valeur sur la jauge dont l'échelle va de 0 à `scale`. */
export function gaugePos(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return Math.max(0, Math.min(value / scale, 1));
}

/** Échelle de la jauge : assez large pour montrer la zone « trop plein » et la position actuelle. */
export function gaugeScale(p: PlanLine): number {
  return Math.max(p.high * 1.35, (p.withdrawable ?? 0) * 1.08, p.target * 1.5, EPS);
}
