"use server";

import { assertCanWrite } from "@/core/auth/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/core/db/data";
import { logAdminAction } from "@/core/audit";

const PATH = "/dashboard/notifications";
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TARGETS = 200;

function back(kind: "saved" | "error", msg: string): never {
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=1&msg=${encodeURIComponent(msg)}`);
}

/** Active ou coupe l'envoi de push pour un type de notification (table push_notification_types). N'efface rien : la notification dans l'app reste créée. */
export async function setPushType(fd: FormData) {
  assertCanWrite();
  const type = str(fd, "type");
  const enabled = str(fd, "enabled") === "1";
  const db = getSupabaseAdmin();
  const { data: before } = await db.from("push_notification_types").select("enabled").eq("type", type).maybeSingle();
  if (!before) back("error", `Type inconnu : ${type || "(vide)"}.`);
  const { error } = await db.from("push_notification_types").update({ enabled }).eq("type", type);
  await logAdminAction({
    action: enabled ? "push.type.enable" : "push.type.disable",
    summary: `Push « ${type} » ${enabled ? "réactivé" : "coupé"}`,
    target: `push_notification_types#${type}`,
    changes: [{ field: "enabled", before: before?.enabled ?? null, after: enabled }],
    status: error ? "error" : "success", errorMessage: error?.message
  });
  if (error) back("error", error.message);
  back("saved", `Push « ${type} » ${enabled ? "réactivé" : "coupé"}.`);
}

/** Transforme une liste libre (noms d'utilisateur, e-mails ou identifiants) en identifiants d'utilisateurs. */
async function resolveUsers(raw: string): Promise<{ ids: string[]; unknown: string[] }> {
  const tokens = [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean))];
  const db = getSupabaseAdmin();
  const ids = new Set<string>();
  const found = new Set<string>();
  const uuids = tokens.filter((t) => UUID.test(t));
  const emails = tokens.filter((t) => t.includes("@")).map((t) => t.toLowerCase());
  const names = tokens.filter((t) => !UUID.test(t) && !t.includes("@"));
  if (uuids.length) {
    const { data } = await db.from("users").select("id").in("id", uuids);
    (data ?? []).forEach((u: any) => { ids.add(u.id); found.add(String(u.id).toLowerCase()); });
  }
  if (emails.length) {
    const { data } = await db.from("users").select("id, email").in("email", emails);
    (data ?? []).forEach((u: any) => { ids.add(u.id); found.add(String(u.email).toLowerCase()); });
  }
  if (names.length) {
    const { data } = await db.from("users").select("id, username").in("username", names);
    (data ?? []).forEach((u: any) => { ids.add(u.id); found.add(String(u.username)); });
  }
  const unknown = tokens.filter((t) => !found.has(t) && !found.has(t.toLowerCase()));
  return { ids: [...ids], unknown };
}

/**
 * Envoie un message à tous les utilisateurs ou à une liste. Appelle directement l'edge function `send-push`
 * (clé serveur) pour obtenir le vrai résultat : appareils touchés, envois réussis, échecs.
 * Par défaut le message est aussi déposé dans la boîte de notifications de l'app (type admin_message).
 */
export async function sendBroadcast(fd: FormData) {
  assertCanWrite();
  const title = str(fd, "title");
  const body = str(fd, "body");
  const audience = str(fd, "audience") === "all" ? "all" : "users";
  const saveInApp = fd.get("save_in_app") === "on";

  if (title.length < 2 || title.length > 60) back("error", "Le titre doit faire entre 2 et 60 caractères.");
  if (body.length < 2 || body.length > 240) back("error", "Le message doit faire entre 2 et 240 caractères.");

  let userIds: string[] | null = null;
  let unknown: string[] = [];
  if (audience === "all") {
    if (str(fd, "confirm").toUpperCase() !== "ENVOYER") back("error", "Envoi à tous refusé : tapez ENVOYER pour confirmer.");
  } else {
    const r = await resolveUsers(str(fd, "recipients"));
    if (r.ids.length === 0) back("error", `Aucun destinataire reconnu${r.unknown.length ? ` (${r.unknown.slice(0, 5).join(", ")})` : ""}. Saisissez des noms d'utilisateur, e-mails ou identifiants.`);
    if (r.ids.length > MAX_TARGETS) back("error", `Trop de destinataires (${r.ids.length}) : maximum ${MAX_TARGETS}. Utilisez « Tous les utilisateurs » pour une diffusion générale.`);
    userIds = r.ids;
    unknown = r.unknown;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) back("error", "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.");

  let result: any = null;
  let failure: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 55_000);
    const res = await fetch(`${url}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ title, body, all: audience === "all", user_ids: userIds ?? [], save_in_app: saveInApp, data: {} }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    result = await res.json().catch(() => ({}));
    if (!res.ok) failure = result?.error || `HTTP ${res.status}`;
  } catch (e: any) {
    failure = e?.name === "AbortError" ? "Délai dépassé : l'envoi a peut-être abouti en partie, vérifiez avant de renvoyer." : (e?.message || "Erreur réseau");
  }

  const target = audience === "all" ? "users#all" : `users#${userIds!.length}`;
  await logAdminAction({
    action: "push.broadcast",
    summary: `Push « ${title} » → ${audience === "all" ? "tous les utilisateurs" : `${userIds!.length} utilisateur(s)`}${failure ? " (échec)" : ""}`,
    target,
    changes: [
      { field: "title", before: null, after: title },
      { field: "body", before: null, after: body },
      { field: "save_in_app", before: null, after: saveInApp },
      ...(failure ? [] : [{ field: "result", before: null, after: { devices: result?.devices ?? 0, sent: result?.sent ?? 0, failed: result?.failed ?? 0 } }])
    ],
    status: failure ? "error" : "success", errorMessage: failure ?? undefined
  });
  if (failure) back("error", failure);

  const devices = Number(result?.devices ?? 0);
  const sent = Number(result?.sent ?? 0);
  const failed = Number(result?.failed ?? 0);
  const parts = [
    devices === 0 ? "Aucun appareil enregistré : aucune notification push envoyée" : `${sent} push envoyé(s) sur ${devices} appareil(s)${failed ? `, ${failed} échec(s)` : ""}`,
    saveInApp ? "message déposé dans la boîte de notifications de l'app" : null,
    unknown.length ? `non reconnus : ${unknown.slice(0, 5).join(", ")}` : null
  ].filter(Boolean);
  back("saved", `${parts.join(" · ")}.`);
}
