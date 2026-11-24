"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/core/auth/session";
import { getSupabaseAdmin } from "@/core/db/supabase";
import { getCurrentActor } from "@/core/audit";
import { executeApproved } from "@/core/approvals/executor";
import { HANDLERS } from "./handlers";

const PATH = "/dashboard/approvals";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function done(ok: boolean, msg: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}

function readId(fd: FormData): string {
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) done(false, "Demande invalide.");
  return id;
}

type RpcResult = { success?: boolean; error?: string; approval?: { id: string; action_type: string; reason: string; payload: Record<string, unknown> } } | null;

/** Valide une demande ET l'exécute tout de suite (le validateur est celui qui lance l'action : une seule prise en charge possible). */
export async function approveRequest(formData: FormData) {
  assertCan("approvals.decide");
  const id = readId(formData);
  const actor = getCurrentActor();
  const db = getSupabaseAdmin();

  const decision = await db.rpc("fn_admin_decide_approval", { p_id: id, p_decision: "approve", p_note: String(formData.get("note") ?? "") || null, p_actor: actor });
  const decided = decision.data as RpcResult;
  if (decision.error || !decided?.success) done(false, decision.error?.message ?? decided?.error ?? "Validation impossible.");

  const claim = await db.rpc("fn_admin_claim_approval", { p_id: id, p_actor: actor });
  const claimed = claim.data as RpcResult;
  if (claim.error || !claimed?.success || !claimed.approval) done(false, claim.error?.message ?? claimed?.error ?? "Prise en charge impossible.");

  const result = await executeApproved(claimed!.approval!, HANDLERS);
  await db.rpc("fn_admin_finish_approval", { p_id: id, p_ok: result.ok, p_result: result.message, p_actor: actor });
  done(result.ok, result.ok ? `Validée et exécutée : ${result.message}` : `Validée, mais l'exécution a échoué : ${result.message}`);
}

export async function rejectRequest(formData: FormData) {
  assertCan("approvals.decide");
  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_decide_approval", { p_id: readId(formData), p_decision: "reject", p_note: String(formData.get("note") ?? ""), p_actor: getCurrentActor() });
  const res = data as RpcResult;
  if (error || !res?.success) done(false, error?.message ?? res?.error ?? "Refus impossible.");
  done(true, "Demande refusée.");
}

export async function cancelRequest(formData: FormData) {
  assertCan("approvals.decide");
  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_cancel_approval", { p_id: readId(formData), p_actor: getCurrentActor() });
  const res = data as RpcResult;
  if (error || !res?.success) done(false, error?.message ?? res?.error ?? "Annulation impossible.");
  done(true, "Demande annulée.");
}
