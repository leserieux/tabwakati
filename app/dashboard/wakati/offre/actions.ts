"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { diffFields, getCurrentActor, logAdminAction, type AuditChange } from "@/lib/audit";

const PATH = "/dashboard/wakati/offre";
const back = (kind: "saved" | "error", msg: string): never => redirect(`${PATH}?${kind}=1&msg=${encodeURIComponent(msg)}`);

type NumOpts = { min?: number; max?: number; minExclusive?: boolean; integer?: boolean };

function readNum(fd: FormData, key: string, label: string, opts: NumOpts, errors: string[]): number | null {
  const raw = String(fd.get(key) ?? "").trim().replace(",", ".");
  if (raw === "") { errors.push(`${label} : valeur requise.`); return null; }
  const n = Number(raw);
  if (!Number.isFinite(n)) { errors.push(`${label} : nombre invalide.`); return null; }
  if (opts.integer && !Number.isInteger(n)) { errors.push(`${label} : doit être un nombre entier.`); return null; }
  if (opts.min !== undefined && (opts.minExclusive ? n <= opts.min : n < opts.min)) { errors.push(`${label} : doit être ${opts.minExclusive ? "supérieur à" : "au moins"} ${opts.min}.`); return null; }
  if (opts.max !== undefined && n > opts.max) { errors.push(`${label} : ne peut pas dépasser ${opts.max}.`); return null; }
  return n;
}

/** Réglages du plafond d'émission : validés ici et par les contraintes de la table, journalisés avant / après. */
export async function updateEmissionSettings(formData: FormData) {
  const errors: string[] = [];
  const checked = (k: string) => formData.get(k) === "on";
  const patch = {
    enabled: checked("enabled"),
    enforce: checked("enforce"),
    budget_pct_per_month: readNum(formData, "budget_pct_per_month", "Budget mensuel (% de la trésorerie)", { min: 0, max: 100, minExclusive: true }, errors),
    window_days: readNum(formData, "window_days", "Fenêtre de calcul (jours)", { min: 1, max: 365, integer: true }, errors),
    count_game_net: checked("count_game_net"),
    gate_staking: checked("gate_staking"),
    gate_referral: checked("gate_referral"),
    referral_bonus_referred: readNum(formData, "referral_bonus_referred", "Bonus du filleul (WAKATI)", { min: 0 }, errors),
    referral_bonus_referrer: readNum(formData, "referral_bonus_referrer", "Bonus du parrain (WAKATI)", { min: 0 }, errors),
    price_step_wakati: readNum(formData, "price_step_wakati", "Pas de l'exemple de sensibilité du prix (WAKATI)", { min: 0, minExclusive: true }, errors),
    runway_window_days: readNum(formData, "runway_window_days", "Fenêtre de la tenue de trésorerie (jours)", { min: 7, max: 365, integer: true }, errors),
    updated_by: getCurrentActor()
  };
  if (errors.length > 0) back("error", errors.join(" "));

  const db = getSupabaseAdmin();
  const { data: before } = await db.from("emission_settings").select("*").eq("id", 1).maybeSingle();
  const changes: AuditChange[] = diffFields(before, patch);
  if (changes.length === 0) back("saved", "Plafond d'émission : aucun changement.");

  const { error } = await db.from("emission_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  await logAdminAction({
    action: "emission.settings.update",
    summary: "Plafond d'émission WAKATI",
    target: "emission_settings#1",
    changes,
    status: error ? "error" : "success",
    errorMessage: error?.message
  });
  revalidatePath(PATH);
  if (error) back("error", `Plafond d'émission : ${error.message}`);
  back("saved", `Plafond d'émission : réglages enregistrés (${changes.length} changement${changes.length > 1 ? "s" : ""}). Appliqués dès le prochain paiement.`);
}
