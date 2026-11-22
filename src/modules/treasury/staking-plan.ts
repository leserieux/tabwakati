/**
 * Plan de staking : combien envoyer en staking on-chain, combien garder dans les portefeuilles.
 * Logique PURE (aucun accès base ni réseau) pour pouvoir la tester ; le chargement est dans modules/treasury/staking-plan-data.ts.
 *
 * Principe : pour chaque actif on additionne ce qui peut sortir (retraits habituels + sorties de staking + déblocages
 * + intérêts) = « à garder dans les portefeuilles ». Ce qui reste au-dessus, avec une marge de sécurité, peut partir
 * en staking on-chain, sans jamais dépasser l'encours staké.
 */

import type { PlanLine } from "@/modules/treasury/custody-plan";

export const DUST_USD = 1;
export const HORIZONS_VIEW = [1, 7, 30, 90, 365] as const;
export const HORIZONS_DECISION = [7, 30, 90] as const;
export type DecisionHorizon = (typeof HORIZONS_DECISION)[number];

export type Scenario = "normal" | "prudent" | "extreme";
export const SCENARIOS: Record<Scenario, { label: string; text: string }> = {
  normal: { label: "Normal", text: "Les sorties du staking flexible suivent l'historique (pire jour des 90 derniers jours × jours de couverture)." },
  prudent: { label: "Prudent", text: "25 % du staking flexible sort, et 10 % du staking bloqué sort avant l'échéance (avec frais) si le retrait anticipé est permis." },
  extreme: { label: "Extrême", text: "Tout le staking sort en même temps (ruée) : tout le staking flexible, et tout le staking bloqué si le retrait anticipé est permis." }
};

export interface UnlockBuckets { overdue: number; d7: number; d30: number; d90: number; d180: number; d365: number; later: number }

export interface StakingPool {
  id: string; name: string; asset: string; type: string; lockDays: number; baseApy: number; isActive: boolean;
  instantEnabled: boolean; instantFeePct: number | null; capacity: number | null;
  /** Le moteur d'intérêts (distribute_staking_rewards) ne crédite des intérêts qu'à ce plan. */
  enginePays: boolean;
  stakers: number; staked: number; loanLocked: number; pending: number; earned: number;
  dailyPromised: number; dailyEngine: number; unlock: UnlockBuckets;
}

export interface UnstakeStat { asset: string; count: number; total: number; peakDay: number; avgDay: number }

export const isFlexible = (p: StakingPool) => p.type === "flexible" || p.lockDays <= 0;

/** Ce qui se débloque dans les `days` jours (échéances dépassées comprises). days ∈ {7, 30, 90}. */
export function unlockWithin(u: UnlockBuckets, days: number): number {
  let t = u.overdue + u.d7;
  if (days >= 30) t += u.d30;
  if (days >= 90) t += u.d90;
  return t;
}

/** Intérêts simples sur `days` jours (le moteur ne capitalise pas : le montant staké ne change pas). */
export const interestOver = (daily: number, days: number) => daily * days;

export type Verdict = "deploy" | "hold" | "shortfall" | "mobile" | "internal" | "nodata";

export interface AssetDecision {
  asset: string; kind: "crypto" | "mobile" | "internal"; priceUsd: number | null;
  stakers: number; staked: number; loanLocked: number; flexible: number; locked: number;
  pending: number; dailyPromised: number; dailyEngine: number; interestHorizon: number;
  unlockInHorizon: number; flexExit: number; lockedEarlyExit: number; stakingNeed: number;
  withdrawalReserve: number; keep: number; buffer: number;
  have: number | null; swapStock: number; available: number | null; hot: number | null; vault: number | null;
  deployable: number; shortfall: number; verdict: Verdict; message: string;
}

export interface AssetInput {
  asset: string; pools: StakingPool[]; plan: PlanLine | null; kind: "crypto" | "mobile" | "internal";
  unstake: UnstakeStat | null; priceUsd: number | null;
}

const exitable = (p: StakingPool) => Math.max(0, p.staked - p.loanLocked);
const usd = (n: number, price: number | null) => (price !== null && price > 0 ? n * price : null);
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: n >= 100 ? 2 : 6 });

export function decideAsset(inp: AssetInput, horizon: DecisionHorizon, scenario: Scenario): AssetDecision {
  const { asset, pools, plan, kind, unstake, priceUsd } = inp;
  const staked = pools.reduce((s, p) => s + p.staked, 0);
  const loanLocked = pools.reduce((s, p) => s + Math.min(p.loanLocked, p.staked), 0);
  const flexPools = pools.filter(isFlexible);
  const lockPools = pools.filter((p) => !isFlexible(p));
  const flexible = flexPools.reduce((s, p) => s + p.staked, 0);
  const locked = lockPools.reduce((s, p) => s + p.staked, 0);
  const pending = pools.reduce((s, p) => s + p.pending, 0);
  const dailyPromised = pools.reduce((s, p) => s + p.dailyPromised, 0);
  const dailyEngine = pools.reduce((s, p) => s + p.dailyEngine, 0);
  const interestHorizon = interestOver(dailyPromised, horizon);

  // Sorties de staking possibles dans l'horizon (la part en garantie d'un prêt ne peut pas sortir).
  const flexExitable = flexPools.reduce((s, p) => s + exitable(p), 0);
  const unlockInHorizon = lockPools.reduce((s, p) => s + Math.min(exitable(p), unlockWithin(p.unlock, horizon)), 0);
  const lockedEarlyBase = lockPools.reduce((s, p) => (p.instantEnabled ? s + Math.max(0, exitable(p) - unlockWithin(p.unlock, horizon)) : s), 0);

  const daysCover = plan?.policy.days_cover ?? 3;
  const histExit = unstake && unstake.peakDay > 0 ? daysCover * unstake.peakDay : 0.1 * flexExitable;
  const flexExit = scenario === "normal" ? Math.min(flexExitable, histExit) : scenario === "prudent" ? 0.25 * flexExitable : flexExitable;
  const lockedEarlyExit = scenario === "normal" ? 0 : scenario === "prudent" ? 0.1 * lockedEarlyBase : lockedEarlyBase;

  const stakingNeed = flexExit + unlockInHorizon + lockedEarlyExit + pending + interestHorizon;
  const withdrawalReserve = plan?.target ?? 0;
  const keep = withdrawalReserve + stakingNeed;
  const buffer = keep * ((plan?.policy.safety_pct ?? 20) / 100);

  const have = plan?.have ?? null;
  const swapStock = plan?.swapStock ?? 0;
  const available = have !== null ? Math.max(0, have - swapStock) : null;
  const free = available !== null ? available - keep - buffer : 0;
  const deployable = kind === "crypto" && available !== null ? Math.min(Math.max(0, free), staked) : 0;
  const shortfall = available !== null && kind !== "internal" ? Math.max(0, keep - available) : 0;

  const base = {
    asset, kind, priceUsd, stakers: pools.reduce((s, p) => s + p.stakers, 0), staked, loanLocked, flexible, locked, pending,
    dailyPromised, dailyEngine, interestHorizon, unlockInHorizon, flexExit, lockedEarlyExit, stakingNeed, withdrawalReserve, keep, buffer,
    have, swapStock, available, hot: plan?.hot ?? null, vault: plan?.vault ?? null, deployable, shortfall
  };
  const u = (n: number) => { const v = usd(n, priceUsd); return v === null ? "" : ` (≈ ${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $)`; };
  const dust = (n: number) => { const v = usd(n, priceUsd); return v !== null && v < DUST_USD; };

  if (kind === "internal") {
    return { ...base, verdict: "internal", message: `Jeton interne : pas de staking on-chain ni de réserve à couvrir. Les intérêts (${fmt(dailyPromised)} ${asset} par jour) sont créés par l'émission : à surveiller dans WAKATI › Offre.` };
  }
  if (have === null) {
    return { ...base, verdict: "nodata", message: "Solde détenu illisible (blockchain ou prestataire) : décision impossible tant que la lecture échoue." };
  }
  if (shortfall > 0 && !dust(shortfall)) {
    return { ...base, verdict: "shortfall", message: `Il manque ${fmt(shortfall)} ${asset}${u(shortfall)} pour tenir ce scénario : disponible ${fmt(available ?? 0)} (détenu ${fmt(have)}${swapStock > 0 ? ` − ${fmt(Math.min(swapStock, have))} réservés aux swaps` : ""}) contre ${fmt(keep)} à garder, hors marge de sécurité. N'envoyez rien en staking on-chain ; ${kind === "mobile" ? "alimentez le compte chez le prestataire" : "ramenez des fonds ou alimentez le portefeuille"}.` };
  }
  if (kind === "mobile") {
    return { ...base, verdict: "mobile", message: `Argent mobile : pas de staking on-chain. Gardez au moins ${fmt(keep)} ${asset}${u(keep)} disponibles chez le prestataire.` };
  }
  if (deployable > 0 && !dust(deployable)) {
    return { ...base, verdict: "deploy", message: `Vous pouvez envoyer jusqu'à ${fmt(deployable)} ${asset}${u(deployable)} en staking on-chain. Gardez ${fmt(keep + buffer)} ${asset} dans les portefeuilles (dont ${fmt(buffer)} de marge de sécurité).` };
  }
  return { ...base, verdict: "hold", message: `Rien à envoyer pour l'instant : tout ce que vous détenez sert de réserve (${fmt(keep + buffer)} ${asset} à garder, marge comprise).` };
}

export interface Totals { stakedUsd: number; dailyUsd: number; pendingUsd: number; unlockUsd: number; deployUsd: number; shortfallUsd: number; unpriced: string[] }

export function totalsOf(ds: AssetDecision[]): Totals {
  const t: Totals = { stakedUsd: 0, dailyUsd: 0, pendingUsd: 0, unlockUsd: 0, deployUsd: 0, shortfallUsd: 0, unpriced: [] };
  for (const d of ds) {
    const p = d.priceUsd;
    if (p === null || !(p > 0)) { if (d.staked > 0) t.unpriced.push(d.asset); continue; }
    t.stakedUsd += d.staked * p; t.dailyUsd += d.dailyPromised * p; t.pendingUsd += d.pending * p;
    t.unlockUsd += d.unlockInHorizon * p; t.deployUsd += d.deployable * p; t.shortfallUsd += d.shortfall * p;
  }
  return t;
}

/** Regroupe les plans par durée de blocage (0 = flexible). */
export function byLockPeriod(pools: StakingPool[]): { lockDays: number; pools: StakingPool[] }[] {
  const m = new Map<number, StakingPool[]>();
  for (const p of pools) { const k = isFlexible(p) ? 0 : p.lockDays; m.set(k, [...(m.get(k) ?? []), p]); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([lockDays, ps]) => ({ lockDays, pools: ps }));
}
