/**
 * Dépôts à vérifier : dépôts mobile money restés « failed » / « pending » / « processing ».
 * Le support vérifie chez le fournisseur (PawaPay) si l'argent est bien arrivé, puis crédite à la main (voir balances/actions.ts).
 * La logique d'affichage est pure (testée) ; seule `loadDepositsToReview` parle à la base.
 */
import { getSupabaseAdmin, q } from "@/core/db/data";

export const REVIEW_STATUSES = ["failed", "pending", "processing"] as const;
/** Fenêtre de recherche : assez large pour retrouver un dépôt signalé tardivement par un utilisateur. */
export const REVIEW_DAYS = 90;
/** Un dépôt « en attente » depuis plus longtemps que ça n'est plus en cours de traitement : il est bloqué. */
export const STUCK_AFTER_MINUTES = 60;

export type DepositRow = {
  id: string;
  user_id: string;
  asset_symbol: string;
  amount: number | string;
  fee: number | string | null;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type DepositReview = {
  id: string;
  userId: string;
  userLabel: string;
  asset: string;
  amount: number;
  fee: number;
  /** Montant proposé au crédit : le montant demandé moins les frais (même règle que la confirmation automatique). */
  suggested: number;
  status: string;
  createdAt: string;
  provider: string | null;
  phone: string | null;
  providerRef: string | null;
  externalRef: string | null;
  reason: string | null;
  stuck: boolean;
};

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Montant à créditer par défaut : amount − fee, jamais négatif. */
export function suggestedCredit(amount: number | string, fee: number | string | null | undefined): number {
  const a = Number(amount);
  const f = Number(fee ?? 0);
  if (!Number.isFinite(a) || a <= 0) return 0;
  return Math.max(0, a - (Number.isFinite(f) ? f : 0));
}

/** Un dépôt « pending/processing » ancien est bloqué ; un dépôt « failed » ne l'est pas (il est terminé, en échec). */
export function isStuck(status: string, createdAt: string, now: Date = new Date()): boolean {
  if (status === "failed") return false;
  const age = now.getTime() - new Date(createdAt).getTime();
  return Number.isFinite(age) && age > STUCK_AFTER_MINUTES * 60_000;
}

export function toReview(row: DepositRow, userLabel: string, now: Date = new Date()): DepositReview {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    userId: row.user_id,
    userLabel,
    asset: row.asset_symbol,
    amount: Number(row.amount),
    fee: Number(row.fee ?? 0),
    suggested: suggestedCredit(row.amount, row.fee),
    status: row.status,
    createdAt: row.created_at,
    provider: text(m.provider),
    phone: text(m.phone),
    providerRef: text(m.provider_reference),
    externalRef: text(m.external_reference),
    reason: text(m.failure_reason) ?? text(m.failure_code) ?? text(m.technical_detail),
    stuck: isStuck(row.status, row.created_at, now)
  };
}

export async function loadDepositsToReview(opts: { userId?: string; limit?: number } = {}): Promise<{ rows: DepositReview[]; error?: string }> {
  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - REVIEW_DAYS * 86_400_000).toISOString();
  let query = db
    .from("transactions")
    .select("id, user_id, asset_symbol, amount, fee, status, created_at, metadata")
    .eq("type", "deposit")
    .in("status", [...REVIEW_STATUSES])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const tx = await q<DepositRow>(query);
  if (tx.error) return { rows: [], error: tx.error };

  const ids = [...new Set(tx.rows.map((r) => r.user_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const users = await q<{ id: string; username: string | null; email: string | null }>(db.from("users").select("id, username, email").in("id", ids));
    for (const u of users.rows) names.set(u.id, u.username || u.email || u.id.slice(0, 8));
  }
  const now = new Date();
  return { rows: tx.rows.map((r) => toReview(r, names.get(r.user_id) ?? r.user_id.slice(0, 8), now)) };
}
