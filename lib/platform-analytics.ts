import { getSupabaseAdmin, q } from "@/lib/data";
import { SUCCESS_STATUSES } from "@/lib/transactions";

export type PlatformCohortRow = {
  cohortMonth: string;
  users: number;
  depositors: number;
  deposits: number;
  withdrawals: number;
  fees: number;
  activeUsers90d: number;
  retention90dPct: number;
  netCashflow: number;
};

type UserRow = { id: string; created_at: string | null };
type TransactionRow = { user_id: string; type: string | null; amount: number | null; fee: number | null; status: string | null; created_at: string | null };

function monthOf(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 7);
}

/** Agrégats de cohortes simples pour la phase LTV/rétention, sans P&L réel. */
export async function loadPlatformCohorts(): Promise<{ rows: PlatformCohortRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [users, transactions] = await Promise.all([
    q<UserRow>(db.from("users").select("id, created_at").order("created_at", { ascending: true })),
    q<TransactionRow>(db.from("transactions").select("user_id, type, amount, fee, status, created_at").in("status", SUCCESS_STATUSES)),
  ]);

  const cohorts = new Map<string, { users: Set<string>; depositorIds: Set<string>; deposits: number; withdrawals: number; fees: number; activeIds: Set<string> }>();
  const userCohort = new Map<string, string>();
  for (const user of users.rows) {
    const cohort = monthOf(user.created_at);
    if (!cohort) continue;
    userCohort.set(user.id, cohort);
    const row = cohorts.get(cohort) || { users: new Set<string>(), depositorIds: new Set<string>(), deposits: 0, withdrawals: 0, fees: 0, activeIds: new Set<string>() };
    row.users.add(user.id);
    cohorts.set(cohort, row);
  }

  for (const tx of transactions.rows) {
    const cohort = userCohort.get(tx.user_id);
    if (!cohort) continue;
    const row = cohorts.get(cohort);
    if (!row) continue;
    const type = String(tx.type || "");
    const amount = Number(tx.amount || 0);
    const createdAt = tx.created_at ? new Date(tx.created_at).getTime() : NaN;
    if (type === "deposit") { row.deposits += amount; row.depositorIds.add(tx.user_id); }
    if (type === "withdrawal") row.withdrawals += amount;
    if (type === "fee" || type.endsWith("_fee")) row.fees += amount || Number(tx.fee || 0);
    if (Number.isFinite(createdAt) && Date.now() - createdAt <= 90 * 24 * 3600 * 1000) row.activeIds.add(tx.user_id);
  }

  const rows = [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohortMonth, row]) => ({
    cohortMonth,
    users: row.users.size,
    depositors: row.depositorIds.size,
    deposits: row.deposits,
    withdrawals: row.withdrawals,
    fees: row.fees,
    activeUsers90d: row.activeIds.size,
    retention90dPct: row.users.size ? (row.activeIds.size / row.users.size) * 100 : 0,
    netCashflow: row.deposits - row.withdrawals,
  }));
  return { rows, error: [users.error, transactions.error].filter(Boolean).join(" · ") || undefined };
}
