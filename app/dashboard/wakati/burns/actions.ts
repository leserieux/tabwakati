"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { diffFields, getCurrentActor, logAdminAction, type AuditChange } from "@/lib/audit";

const PATH = "/dashboard/wakati/burns";
const back = (kind: "saved" | "error", msg: string): never => redirect(`${PATH}?${kind}=1&msg=${encodeURIComponent(msg)}`);

/** Confirme qu'un burn comptable a bien été envoyé à l'adresse de burn on-chain (hash de transaction). */
export async function confirmOnchainBurn(formData: FormData) {
  const id = String(formData.get("id") || "");
  const hash = String(formData.get("tx_hash") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("error", "Identifiant de burn invalide.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) back("error", "Hash invalide : il doit commencer par 0x suivi de 64 caractères hexadécimaux.");

  const db = getSupabaseAdmin();
  const { data, error } = await db.from("token_burns").update({ status: "completed", tx_hash: hash }).eq("id", id).eq("status", "pending_onchain").select("id, amount");
  const ok = !error && !!data && data.length === 1;
  await logAdminAction({
    action: "burn.confirm_onchain",
    summary: `Burn ${id.slice(0, 8)} confirmé on-chain`,
    target: `token_burns#${id}`,
    changes: [{ field: "status", before: "pending_onchain", after: ok ? "completed" : "pending_onchain" }, { field: "tx_hash", before: null, after: ok ? hash : null }],
    status: ok ? "success" : "error",
    errorMessage: error?.message ?? (ok ? undefined : "Burn introuvable ou déjà confirmé")
  });
  revalidatePath(PATH);
  if (!ok) back("error", error?.message ?? "Burn introuvable ou déjà confirmé.");
  back("saved", "Burn confirmé on-chain.");
}

/** Lance tout de suite le passage de burn (le même que la tâche quotidienne de 00:20 UTC). Sous le seuil de prix, il ne brûle rien. */
export async function burnNow() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("fn_run_burn", { p_force: false });
  const res = data as { success?: boolean; status?: string; wakati_burned?: number; note?: string } | null;
  const ok = !error && res?.success === true;
  await logAdminAction({
    action: "burn.run_now",
    summary: `Passage de burn manuel (${res?.status ?? "erreur"})`,
    target: "burn_settings#1",
    status: ok ? "success" : "error",
    errorMessage: error?.message
  });
  revalidatePath(PATH);
  if (!ok) back("error", error?.message ?? "Le passage de burn a échoué.");
  back("saved", res?.wakati_burned ? `${res.wakati_burned} WAKATI brûlés (en attente d'envoi on-chain).` : res?.note ?? "Rien à brûler : tout le bénéfice va dans la caisse.");
}

// ───────── Réglages (burn + caisse) ─────────

type NumOpts = { min?: number; max?: number; minExclusive?: boolean; nullable?: boolean };

/** Lit un nombre du formulaire et le valide ; renvoie une erreur lisible plutôt que d'écrire n'importe quoi en base. */
function readNum(fd: FormData, key: string, label: string, opts: NumOpts, errors: string[]): number | null {
  const raw = String(fd.get(key) ?? "").trim().replace(",", ".");
  if (raw === "") {
    if (opts.nullable) return null;
    errors.push(`${label} : valeur requise.`);
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) { errors.push(`${label} : nombre invalide.`); return null; }
  if (opts.min !== undefined && (opts.minExclusive ? n <= opts.min : n < opts.min)) { errors.push(`${label} : doit être ${opts.minExclusive ? "supérieur à" : "au moins"} ${opts.min}.`); return null; }
  if (opts.max !== undefined && n > opts.max) { errors.push(`${label} : ne peut pas dépasser ${opts.max}.`); return null; }
  return n;
}

async function saveSettings(opts: {
  table: string; id: number; action: string; summary: string; patch: Record<string, unknown>;
}) {
  const db = getSupabaseAdmin();
  const { data: before } = await db.from(opts.table).select("*").eq("id", opts.id).maybeSingle();
  const changes: AuditChange[] = diffFields(before, opts.patch);
  if (changes.length === 0) back("saved", `${opts.summary} : aucun changement.`);
  const { error } = await db.from(opts.table).update({ ...opts.patch, updated_at: new Date().toISOString() }).eq("id", opts.id);
  await logAdminAction({
    action: opts.action,
    summary: opts.summary,
    target: `${opts.table}#${opts.id}`,
    changes,
    status: error ? "error" : "success",
    errorMessage: error?.message
  });
  revalidatePath(PATH);
  if (error) back("error", `${opts.summary} : ${error.message}`);
  back("saved", `${opts.summary} : réglages enregistrés (${changes.length} changement${changes.length > 1 ? "s" : ""}).`);
}

/** Réglages du burn : seuil de prix, part brûlée, plafonds. Appliqués dès le prochain passage (00:20 UTC). */
export async function updateBurnSettings(formData: FormData) {
  const errors: string[] = [];
  const patch = {
    enabled: formData.get("enabled") === "on",
    burn_start_price_fcfa: readNum(formData, "burn_start_price_fcfa", "Seuil de prix (FCFA)", { min: 0, minExclusive: true }, errors),
    burn_share_pct: readNum(formData, "burn_share_pct", "Part du bénéfice brûlée (%)", { min: 0, max: 100 }, errors),
    max_treasury_pct_per_day: readNum(formData, "max_treasury_pct_per_day", "Plafond par jour (% de la trésorerie)", { min: 0, max: 100, minExclusive: true, nullable: true }, errors),
    max_daily_burn_wakati: readNum(formData, "max_daily_burn_wakati", "Plafond par jour (WAKATI)", { min: 0, minExclusive: true, nullable: true }, errors),
    min_burn_wakati: readNum(formData, "min_burn_wakati", "Burn minimum (WAKATI)", { min: 0 }, errors),
    min_treasury_keep_wakati: readNum(formData, "min_treasury_keep_wakati", "Trésorerie à conserver (WAKATI)", { min: 0 }, errors),
    supply_cap_wakati: readNum(formData, "supply_cap_wakati", "Plafond de l'offre (WAKATI)", { min: 0, minExclusive: true, nullable: true }, errors),
    updated_by: getCurrentActor()
  };
  if (errors.length > 0) back("error", errors.join(" "));
  await saveSettings({ table: "burn_settings", id: 1, action: "burn.settings.update", summary: "Réglages du burn", patch });
}

/** Réglages de la caisse et du calcul du prix (mêmes champs que Réglages > Prix WAKATI). */
export async function updateReserveSettings(formData: FormData) {
  const errors: string[] = [];
  const patch = {
    profit_share_pct: readNum(formData, "profit_share_pct", "Part versée à la caisse (%)", { min: 0, max: 100 }, errors),
    max_daily_change_pct: readNum(formData, "max_daily_change_pct", "Variation max du prix par jour (%)", { min: 0, max: 100, minExclusive: true }, errors),
    price_floor_usd: readNum(formData, "price_floor_usd", "Prix plancher (USD)", { min: 0, minExclusive: true }, errors),
    is_active: formData.get("is_active") === "on"
  };
  if (errors.length > 0) back("error", errors.join(" "));
  await saveSettings({ table: "wakati_reserve_state", id: 1, action: "settings.wakati_reserve_state.update", summary: "Caisse et prix du WAKATI", patch });
}
