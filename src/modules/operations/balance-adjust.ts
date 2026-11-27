/**
 * Correction manuelle d'un solde : validation pure du formulaire (testée sans base).
 * L'écriture elle-même est faite atomiquement par la fonction SQL `fn_admin_adjust_balance`
 * (verrou de ligne, grand livre `balance_ledger`, transaction « balance_adjustment » ou régularisation d'un dépôt).
 */
import { reasonProblem } from "@/core/approvals/policy";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Garde-fou contre une faute de frappe (un zéro de trop) : au-delà, la correction est refusée. */
export const MAX_ADJUST_AMOUNT = 1_000_000_000;

export type Direction = "credit" | "debit";

export type AdjustRequest = {
  userId: string;
  asset: string;
  direction: Direction;
  amount: number;
  reason: string;
  /** Dépôt « failed/pending » à régulariser : la transaction existante passe à « completed » (pas de doublon). */
  depositTxId: string | null;
  notify: boolean;
};

/** « 1 000,5 », « 1000.5 », « 1 000 » → nombre ; tout le reste → null (jamais NaN). */
export function parseAmount(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function validateAdjustment(raw: Record<string, string | null | undefined>): { ok: true; value: AdjustRequest } | { ok: false; error: string } {
  const userId = String(raw.user_id ?? "").trim();
  const asset = String(raw.asset_symbol ?? "").trim();
  const direction = String(raw.direction ?? "").trim();
  const depositTxId = String(raw.deposit_tx_id ?? "").trim();
  const reason = String(raw.reason ?? "").trim();

  if (!UUID_RE.test(userId)) return { ok: false, error: "Utilisateur invalide." };
  if (!asset || !/^[A-Za-z0-9_.-]{1,20}$/.test(asset)) return { ok: false, error: "Choisis un actif." };
  if (direction !== "credit" && direction !== "debit") return { ok: false, error: "Choisis créditer ou débiter." };
  if (depositTxId && !UUID_RE.test(depositTxId)) return { ok: false, error: "Dépôt invalide." };
  if (depositTxId && direction !== "credit") return { ok: false, error: "Un dépôt à régulariser ne peut être que crédité." };

  const amount = parseAmount(raw.amount);
  if (amount === null || amount <= 0) return { ok: false, error: "Le montant doit être un nombre supérieur à 0." };
  if (amount > MAX_ADJUST_AMOUNT) return { ok: false, error: `Montant trop élevé (maximum ${MAX_ADJUST_AMOUNT.toLocaleString("fr-FR")}) : vérifie les zéros.` };

  const problem = reasonProblem(reason);
  if (problem) return { ok: false, error: problem };

  return { ok: true, value: { userId, asset, direction, amount, reason, depositTxId: depositTxId || null, notify: raw.notify !== "off" } };
}

/** Page de retour autorisée après l'action (jamais une URL fournie telle quelle par le navigateur). */
export function safeReturnPath(raw: string | null | undefined): string {
  const p = String(raw ?? "").trim();
  if (p === "/dashboard/deposits") return p;
  const m = /^\/dashboard\/users\/([0-9a-f-]{36})$/i.exec(p);
  if (m && UUID_RE.test(m[1])) return p;
  return "/dashboard/deposits";
}
