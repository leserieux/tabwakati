"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/core/auth/session";
import { getSupabaseAdmin } from "@/core/db/supabase";
import { getCurrentActor } from "@/core/audit";

const PATH = "/dashboard/alerts";

function done(ok: boolean, msg: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}

function readId(fd: FormData): number {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) done(false, "Alerte invalide.");
  return id;
}

type Rpc = { success?: boolean; error?: string } | null;

/** Prend l'alerte en charge : elle reste visible, marquée « prise en charge » avec ton nom. */
export async function acknowledgeAlert(formData: FormData) {
  assertCan("alerts.handle");
  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_ack_alert", { p_id: readId(formData), p_actor: getCurrentActor() });
  const res = data as Rpc;
  if (error || !res?.success) done(false, error?.message ?? res?.error ?? "Prise en charge impossible.");
  done(true, "Alerte prise en charge.");
}

/** Clôt l'alerte avec une note obligatoire. Si le problème persiste, une nouvelle alerte apparaît au prochain contrôle (10 minutes). */
export async function resolveAlert(formData: FormData) {
  assertCan("alerts.handle");
  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_resolve_alert", { p_id: readId(formData), p_note: String(formData.get("note") ?? ""), p_actor: getCurrentActor() });
  const res = data as Rpc;
  if (error || !res?.success) done(false, error?.message ?? res?.error ?? "Résolution impossible.");
  done(true, "Alerte résolue. Si le problème persiste, elle reviendra au prochain contrôle.");
}
