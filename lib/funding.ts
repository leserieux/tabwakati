import { getSupabaseAdmin } from "@/lib/data";
import type { Line } from "@/lib/solvency";
import { buildPlans } from "@/lib/custody-policy";
import { EPS } from "@/lib/custody-plan";
import { loadStakingPlanData } from "@/lib/staking-plan-data";
import { isFlexible, unlockWithin } from "@/lib/staking-plan";
import { computeFunding, type FundingLine, type Urgency } from "@/lib/funding-core";

/**
 * Chargement des données du plan d'approvisionnement (réserve de retrait, plus gros soldes, staking).
 * La logique de calcul est dans lib/funding-core.ts ; tout est ré-exporté ici pour que les pages importent depuis un seul endroit.
 */
export * from "@/lib/funding-core";

// ─────────────────────────── Chargement ───────────────────────────

/** Les plus gros soldes disponibles d'un actif (les `n` premiers). Ne lève jamais : l'erreur est renvoyée. */
export async function loadTopBalances(assets: string[], n = 10): Promise<{ map: Map<string, number[]>; error: string | null }> {
  const db = getSupabaseAdmin();
  const map = new Map<string, number[]>();
  const errors: string[] = [];
  await Promise.all(
    assets.map(async (asset) => {
      try {
        const { data, error } = await db.from("user_balances").select("available_balance").eq("asset_symbol", asset).gt("available_balance", 0).order("available_balance", { ascending: false }).limit(n);
        if (error) { errors.push(`${asset} : ${error.message}`); return; }
        map.set(asset, ((data as any[]) || []).map((r) => Number(r.available_balance) || 0));
      } catch (e: any) {
        errors.push(`${asset} : ${e?.message || "erreur inconnue"}`);
      }
    })
  );
  return { map, error: errors.length ? errors.join(" ; ") : null };
}

const RANK: Record<Urgency, number> = { now: 0, soon: 1, unknown: 2, watch: 3, excess: 4, ok: 5 };

export async function loadFunding(sol: { crypto: Line[]; mobile: Line[] }): Promise<{ lines: FundingLine[]; warning: string | null }> {
  const { plans, warning } = await buildPlans(sol);
  const [tops, staking] = await Promise.all([loadTopBalances(plans.filter((p) => p.owe > EPS).map((p) => p.asset)), loadStakingPlanData()]);

  const unlock7 = new Map<string, number>();
  for (const p of staking.data?.pools ?? []) {
    if (isFlexible(p)) continue;
    const exitable = Math.max(0, p.staked - p.loanLocked);
    const key = p.asset.toUpperCase();
    unlock7.set(key, (unlock7.get(key) ?? 0) + Math.min(exitable, unlockWithin(p.unlock, 7)));
  }

  const lines = plans.map((p) => computeFunding(p, tops.map.get(p.asset) ?? [], unlock7.get(p.asset.toUpperCase()) ?? 0));
  lines.sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || (b.action.usd ?? 0) - (a.action.usd ?? 0) || a.plan.asset.localeCompare(b.plan.asset));

  const problems = [warning, tops.error ? `soldes des utilisateurs illisibles (${tops.error})` : null, staking.error ? `staking illisible (${staking.error})` : null].filter(Boolean);
  return { lines, warning: problems.length ? problems.join(" · ") : null };
}

