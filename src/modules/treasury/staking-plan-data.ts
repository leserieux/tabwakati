import { getSupabaseAdmin } from "@/core/db/data";
import type { StakingPool, UnstakeStat } from "@/modules/treasury/staking-plan";

/** Données du plan de staking : fonction SQL admin_staking_plan (migration 20261118). */

export interface UpcomingUnlock { asset: string; pool: string; amount: number; unlockAt: string; userId: string; user: string | null }
export interface EngineInfo {
  lastAccrualAt: string | null; lastRunDate: string | null;
  cron: { active: boolean; schedule: string; lastRun: string | null; lastStatus: string | null; lastMessage: string | null } | null;
}
export interface StakingPlanData { generatedAt: string; engine: EngineInfo; pools: StakingPool[]; upcoming: UpcomingUnlock[]; unstake: UnstakeStat[] }

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export async function loadStakingPlanData(): Promise<{ data: StakingPlanData | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_staking_plan");
    if (error) return { data: null, error: error.message };
    const d: any = data ?? {};
    const pools: StakingPool[] = (d.pools ?? []).map((p: any): StakingPool => ({
      id: String(p.id), name: String(p.name), asset: String(p.asset_symbol), type: String(p.staking_type ?? "flexible"), lockDays: n(p.lock_period_days),
      baseApy: n(p.base_apy), isActive: !!p.is_active, instantEnabled: !!p.instant_unstake_enabled,
      instantFeePct: p.instant_unstake_fee_percent == null ? null : n(p.instant_unstake_fee_percent),
      capacity: p.max_pool_capacity == null ? null : n(p.max_pool_capacity), enginePays: !!p.engine_pays,
      stakers: n(p.stakers), staked: n(p.staked), loanLocked: n(p.loan_locked), pending: n(p.pending), earned: n(p.earned),
      dailyPromised: n(p.daily_promised), dailyEngine: n(p.daily_engine),
      unlock: { overdue: n(p.unlock_overdue), d7: n(p.unlock_7d), d30: n(p.unlock_30d), d90: n(p.unlock_90d), d180: n(p.unlock_180d), d365: n(p.unlock_365d), later: n(p.unlock_later) }
    }));
    const c = d.engine?.cron;
    return {
      data: {
        generatedAt: String(d.generated_at ?? ""),
        engine: {
          lastAccrualAt: d.engine?.last_accrual_at ?? null, lastRunDate: d.engine?.last_run_date ?? null,
          cron: c ? { active: !!c.active, schedule: String(c.schedule ?? ""), lastRun: c.last_run ?? null, lastStatus: c.last_status ?? null, lastMessage: c.last_message ?? null } : null
        },
        pools,
        upcoming: (d.upcoming ?? []).map((u: any): UpcomingUnlock => ({ asset: String(u.asset_symbol), pool: String(u.pool_name), amount: n(u.amount), unlockAt: String(u.unlock_at), userId: String(u.user_id), user: u.username ?? u.email ?? null })),
        unstake: (d.unstake_stats ?? []).map((s: any): UnstakeStat => ({ asset: String(s.asset), count: n(s.count), total: n(s.total), peakDay: n(s.peak_day), avgDay: n(s.avg_day) }))
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}
