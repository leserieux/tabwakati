/**
 * Barrière des actions sensibles. Chaque action sensible appelle `gateForm` (ou `evaluateGate`) AVANT d'écrire :
 *  - motif absent ou trop court → refus ;
 *  - double validation active → la demande est enregistrée, l'action ne s'exécute PAS ;
 *  - double validation inactive → l'action s'exécute, le motif est tracé dans le journal d'audit ;
 *  - exécution d'une demande validée (rejeu par `executeApproved`) → passe, avec le motif de la demande.
 *
 * Le « rejeu » est reconnu par un contexte serveur privé (AsyncLocalStorage) que seul `runAsApproved` peut poser :
 * un champ de formulaire forgé par un navigateur ne peut jamais court-circuiter la validation.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/core/db/supabase";
import { getCurrentActor, logAdminAction } from "@/core/audit";
import { SENSITIVE_ACTIONS, dualControlEnabled, formToPayload, reasonProblem, type SensitiveType } from "@/core/approvals/policy";

// Singleton partagé via globalThis : si Next duplique ce module dans deux bundles, le contexte de rejeu reste le même.
type ReplayStore = { approvalId: string; reason: string };
const globalStore = globalThis as { __wkApprovalReplay?: AsyncLocalStorage<ReplayStore> };
const replayContext = (globalStore.__wkApprovalReplay ??= new AsyncLocalStorage<ReplayStore>());

/** Exécute `fn` comme rejeu d'une demande validée. Réservé à core/approvals/executor.ts. */
export function runAsApproved<T>(ctx: { approvalId: string; reason: string }, fn: () => Promise<T>): Promise<T> {
  return replayContext.run(ctx, fn);
}

export type GateOutcome =
  | { kind: "proceed"; reason: string; approvalId?: string }
  | { kind: "reason_missing"; message: string }
  | { kind: "pending"; approvalId: string; message: string }
  | { kind: "error"; message: string };

export async function evaluateGate(p: { type: SensitiveType; summary?: string; reason: string; payload: Record<string, string> }): Promise<GateOutcome> {
  const replay = replayContext.getStore();
  if (replay) return { kind: "proceed", reason: replay.reason, approvalId: replay.approvalId };

  const problem = reasonProblem(p.reason);
  if (problem) return { kind: "reason_missing", message: problem };
  const reason = p.reason.trim();
  const summary = p.summary ?? SENSITIVE_ACTIONS[p.type];

  if (!dualControlEnabled()) {
    await logAdminAction({ action: "sensitive.confirmed", summary: `${summary} (motif : ${reason})`, target: p.type, status: "success" });
    return { kind: "proceed", reason };
  }

  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_request_approval", {
    p_type: p.type, p_summary: summary, p_reason: reason, p_payload: p.payload, p_requested_by: getCurrentActor()
  });
  const res = data as { success?: boolean; id?: string; error?: string } | null;
  if (error || !res?.success || !res.id) return { kind: "error", message: error?.message ?? res?.error ?? "Demande de validation impossible." };
  return { kind: "pending", approvalId: res.id, message: "Demande envoyée : un second super-admin doit la valider (Système › Validations). L'action n'a pas encore été exécutée." };
}

/** Version « formulaire » : lit le motif et les champs du formulaire. */
export function gateForm(type: SensitiveType, formData: FormData, summary?: string): Promise<GateOutcome> {
  return evaluateGate({ type, summary, reason: String(formData.get("reason") ?? ""), payload: formToPayload(formData) });
}

/** Renvoie sur la page d'origine avec le bon message quand l'action ne doit pas s'exécuter maintenant. */
export function gateRedirect(returnTo: string, outcome: Exclude<GateOutcome, { kind: "proceed" }>): never {
  if (outcome.kind === "pending") redirect(`${returnTo}?pending=${encodeURIComponent(outcome.message)}`);
  redirect(`${returnTo}?error=${encodeURIComponent("Action sensible")}&msg=${encodeURIComponent(outcome.message)}`);
}
