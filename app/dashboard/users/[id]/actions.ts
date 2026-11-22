"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/data";
import { getCurrentActor, logAdminAction } from "@/lib/audit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "withdrawals_blocked", "frozen"] as const;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Gèle / restreint / réactive un compte. L'écriture (statut, historique, journal d'audit) est faite atomiquement par la fonction SQL. */
export async function setAccountStatus(formData: FormData) {
  assertCan("users.freeze");
  const userId = str(formData, "user_id");
  const status = str(formData, "status");
  const reason = str(formData, "reason");
  if (!UUID.test(userId) || !(STATUSES as readonly string[]).includes(status)) throw new Error("Requête invalide.");
  const path = `/dashboard/users/${userId}`;

  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_set_account_status", {
    p_user_id: userId, p_status: status, p_reason: reason, p_actor: getCurrentActor()
  });
  const failure = error?.message || (data && data.success === false ? String(data.error) : null);
  revalidatePath(path);
  if (failure) redirect(`${path}?error=${encodeURIComponent(failure)}`);
  redirect(`${path}?saved=${encodeURIComponent("Statut du compte mis à jour")}`);
}

export async function addUserNote(formData: FormData) {
  assertCan("users.notes");
  const userId = str(formData, "user_id");
  const note = str(formData, "note");
  if (!UUID.test(userId)) throw new Error("Requête invalide.");
  const path = `/dashboard/users/${userId}`;
  if (note.length < 1 || note.length > 2000) redirect(`${path}?error=${encodeURIComponent("Note vide ou trop longue (2000 caractères max).")}`);

  const { error } = await getSupabaseAdmin().from("user_internal_notes").insert({ user_id: userId, author: getCurrentActor(), note });
  await logAdminAction({ action: "users.note", summary: "Note interne ajoutée", target: userId, status: error ? "error" : "success", errorMessage: error?.message });
  revalidatePath(path);
  if (error) redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  redirect(`${path}?saved=${encodeURIComponent("Note ajoutée")}`);
}
