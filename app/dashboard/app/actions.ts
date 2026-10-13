"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { diffFields, logAdminAction } from "@/lib/audit";

const PATH = "/dashboard/app";
const back = (kind: "saved" | "error", msg: string): never => redirect(`${PATH}?${kind}=1&msg=${encodeURIComponent(msg)}`);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string) => { const raw = str(fd, k); return /^\d+$/.test(raw) ? Number(raw) : NaN; };

/** Vérifie rapidement que le lien répond. Ne bloque que sur un 404/410 certain : un réseau lent ne doit pas empêcher de publier. */
async function linkIsDead(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    return res.status === 404 || res.status === 410;
  } catch {
    return false;
  }
}

/** Publie (ou met à jour) la version Android que l'app propose à ses utilisateurs. */
export async function publishAppVersion(fd: FormData) {
  const latest = int(fd, "latest_build");
  const min = int(fd, "min_build");
  const name = str(fd, "latest_name") || null;
  const url = str(fd, "apk_url");
  const sha = str(fd, "apk_sha256").toLowerCase() || null;
  const notes = str(fd, "notes") || null;

  if (!Number.isInteger(latest) || latest < 1) back("error", "Le numéro de build doit être un entier positif (le nombre après le + dans pubspec.yaml).");
  if (!Number.isInteger(min) || min < 1) back("error", "Le build minimum doit être un entier positif.");
  if (min > latest) back("error", "Le build minimum ne peut pas dépasser le dernier build publié.");
  if (!/^https:\/\//i.test(url)) back("error", "Le lien de l'APK doit commencer par https://.");
  if (sha && !/^[0-9a-f]{64}$/.test(sha)) back("error", "L'empreinte SHA-256 doit faire 64 caractères hexadécimaux (ou rester vide).");

  const db = getSupabaseAdmin();
  const { data: before } = await db.from("app_versions").select("*").eq("platform", "android").maybeSingle();

  // Garde-fous : une faute de frappe ici peut bloquer tous les utilisateurs.
  if (before && latest < before.latest_build && fd.get("confirm_rollback") !== "on")
    back("error", `Le build ${latest} est plus ancien que le build publié (${before.latest_build}). Cochez « revenir en arrière » pour confirmer.`);
  if (min > (before?.min_build ?? 0) && min > 1 && fd.get("confirm_force") !== "on")
    back("error", `Le build minimum passe à ${min} : toutes les versions inférieures seront bloquées jusqu'à la mise à jour. Cochez la case de confirmation.`);
  if (await linkIsDead(url)) back("error", "Le lien de l'APK renvoie une erreur 404 : vérifiez l'adresse avant de publier.");

  const patch = { platform: "android", latest_build: latest, min_build: min, latest_name: name, apk_url: url, apk_sha256: sha, notes, updated_at: new Date().toISOString() };
  const { error } = await db.from("app_versions").upsert(patch, { onConflict: "platform" });

  await logAdminAction({
    action: "app.publish_version",
    summary: `Version Android ${name ?? ""} (build ${latest}, minimum ${min})`.replace("  ", " "),
    target: "app_versions#android",
    changes: diffFields(before, patch),
    status: error ? "error" : "success",
    errorMessage: error?.message
  });
  revalidatePath(PATH);
  if (error) back("error", error.message);
  back("saved", `Version ${name ?? latest} publiée : les applications la proposeront au prochain démarrage.`);
}
