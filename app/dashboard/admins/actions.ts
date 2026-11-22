"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/data";
import { getCurrentActor, logAdminAction } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/admin-accounts";

const PATH = "/dashboard/admins";
const ROLES = ["super_admin", "finance", "support", "risk", "viewer"];
const USERNAME = /^[a-z0-9._-]{3,40}$/;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function done(ok: boolean, msg: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}

export async function createAdmin(formData: FormData) {
  assertCan("admins.manage");
  const username = str(formData, "username").toLowerCase();
  const role = str(formData, "role");
  const password = String(formData.get("password") ?? "");
  if (!USERNAME.test(username)) done(false, "Identifiant : 3 à 40 caractères (lettres minuscules, chiffres, . _ -).");
  if (!ROLES.includes(role)) done(false, "Rôle invalide.");
  const problem = passwordProblem(password);
  if (problem) done(false, problem);

  const { error } = await getSupabaseAdmin().from("admin_users").insert({
    username, display_name: str(formData, "display_name") || username, role, password_hash: hashPassword(password), created_by: getCurrentActor()
  });
  await logAdminAction({ action: "admins.create", summary: `Compte admin créé : ${username} (${role})`, target: username, status: error ? "error" : "success", errorMessage: error?.message });
  if (error) done(false, error.code === "23505" ? "Cet identifiant existe déjà." : error.message);
  done(true, `Compte ${username} créé.`);
}

export async function setAdminActive(formData: FormData) {
  assertCan("admins.manage");
  const username = str(formData, "username");
  const active = str(formData, "active") === "true";
  if (!active && username === getCurrentActor().toLowerCase()) done(false, "Tu ne peux pas désactiver ton propre compte.");
  const { error } = await getSupabaseAdmin().from("admin_users").update({ is_active: active, updated_at: new Date().toISOString() }).eq("username", username);
  await logAdminAction({ action: "admins.set_active", summary: `${active ? "Réactivation" : "Désactivation"} du compte ${username}`, target: username, status: error ? "error" : "success", errorMessage: error?.message });
  if (error) done(false, error.message);
  done(true, `Compte ${username} ${active ? "réactivé" : "désactivé"}.`);
}

export async function resetAdminPassword(formData: FormData) {
  assertCan("admins.manage");
  const username = str(formData, "username");
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) done(false, problem);
  const { error } = await getSupabaseAdmin().from("admin_users").update({ password_hash: hashPassword(password), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("username", username);
  await logAdminAction({ action: "admins.reset_password", summary: `Mot de passe réinitialisé : ${username}`, target: username, status: error ? "error" : "success", errorMessage: error?.message });
  if (error) done(false, error.message);
  done(true, `Mot de passe de ${username} réinitialisé.`);
}
