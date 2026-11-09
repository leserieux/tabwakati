"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { diffFields, getCurrentActor, logAdminAction } from "@/lib/audit";

const PATH = "/dashboard/futures";

function num(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
function numOrNull(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim().replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}
/** Champ « 0 = illimité » : vide = 0. */
function numOrZero(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? "").trim().replace(",", ".");
  if (raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}
function bool(fd: FormData, key: string): boolean { return fd.get(key) === "on"; }
function str(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }

function done(kind: "saved" | "error", summary: string, msg?: string): never {
  revalidatePath(PATH);
  revalidatePath("/dashboard");
  if (kind === "error") redirect(`${PATH}?error=${encodeURIComponent(summary)}&msg=${encodeURIComponent(msg ?? "")}`);
  redirect(`${PATH}?saved=${encodeURIComponent(summary)}`);
}

/** Règles de cohérence des réglages. Le serveur SQL refuse déjà certaines valeurs ; on explique ici pourquoi, avant d'écrire. */
function validate(p: Record<string, any>): string[] {
  const e: string[] = [];
  const isInt = (v: any) => Number.isInteger(v);

  for (const k of ["margin_default", "margin_min", "margin_max", "leverage_default", "leverage_min", "leverage_max", "open_fee_pct", "close_fee_pct",
    "fee_interval_seconds", "fee_rate_pct", "maintenance_margin_pct", "max_open_positions"]) {
    if (typeof p[k] !== "number" || Number.isNaN(p[k])) e.push(`Valeur numérique invalide : ${k}.`);
  }
  for (const k of ["max_notional_per_user", "max_total_notional"]) {
    if (typeof p[k] !== "number" || Number.isNaN(p[k]) || p[k] < 0) e.push(`${k} : un nombre positif (0 ou vide = illimité).`);
  }
  if (e.length) return e;

  if (p.margin_min <= 0) e.push("La marge minimale doit être supérieure à 0.");
  if (p.margin_max < p.margin_min) e.push("La marge maximale doit être ≥ la marge minimale.");
  if (p.margin_default < p.margin_min || p.margin_default > p.margin_max) e.push("La marge par défaut doit être comprise entre le minimum et le maximum.");

  if (![p.leverage_default, p.leverage_min, p.leverage_max].every(isInt)) e.push("Les leviers doivent être des nombres entiers.");
  if (p.leverage_min < 1) e.push("Le levier minimal est 1.");
  if (p.leverage_max < p.leverage_min) e.push("Le levier maximal doit être ≥ le levier minimal.");
  if (p.leverage_max > 125) e.push("Levier maximal limité à 125x.");
  if (p.leverage_default < p.leverage_min || p.leverage_default > p.leverage_max) e.push("Le levier par défaut doit être compris entre le minimum et le maximum.");
  const badPreset = (p.leverage_presets as number[]).find((x) => !isInt(x) || x < p.leverage_min || x > p.leverage_max);
  if (badPreset !== undefined) e.push(`Raccourci de levier ${badPreset}x hors de l'intervalle ${p.leverage_min}x – ${p.leverage_max}x.`);

  if (p.maintenance_margin_pct < 0.05 || p.maintenance_margin_pct > 20) e.push("La marge de maintenance doit être comprise entre 0,05 % et 20 %.");
  else if (p.leverage_max >= 1) {
    const dist = 100 / p.leverage_max - p.maintenance_margin_pct;
    if (dist <= 0) e.push(`Avec ${p.leverage_max}x, 100 / levier (${(100 / p.leverage_max).toFixed(2)} %) doit rester supérieur à la marge de maintenance (${p.maintenance_margin_pct} %) : sinon aucune position ne peut s'ouvrir.`);
    else if (dist < 0.2) e.push(`Avec ${p.leverage_max}x, la liquidation se déclencherait à moins de 0,2 % du prix d'entrée : baissez le levier maximal ou la marge de maintenance.`);
  }

  if (p.open_fee_pct < 0 || p.open_fee_pct > 2) e.push("Frais d'ouverture : entre 0 % et 2 % de la taille.");
  if (p.close_fee_pct < 0 || p.close_fee_pct > 2) e.push("Frais de fermeture : entre 0 % et 2 % de la taille.");
  if (p.fee_rate_pct < 0 || p.fee_rate_pct > 2) e.push("Frais périodiques : entre 0 % et 2 % de la taille par intervalle.");
  if (!isInt(p.fee_interval_seconds) || p.fee_interval_seconds < 0 || p.fee_interval_seconds > 604_800) e.push("Intervalle des frais : un nombre entier de secondes, de 0 (désactivé) à 604 800 (7 jours).");
  else if (p.fee_interval_seconds > 0 && p.fee_interval_seconds < 60) e.push("Intervalle des frais : 60 secondes minimum (ou 0 pour désactiver).");
  else if (p.fee_interval_seconds > 0 && (p.fee_rate_pct * 86_400) / p.fee_interval_seconds > 10) e.push("Frais périodiques supérieurs à 10 % de la taille par jour : valeur refusée (probable erreur de saisie).");

  if (!isInt(p.max_open_positions) || p.max_open_positions < 1 || p.max_open_positions > 20) e.push("Positions ouvertes par utilisateur : un entier de 1 à 20.");
  if (p.max_notional_per_user > 0 && p.max_total_notional > 0 && p.max_notional_per_user > p.max_total_notional) e.push("L'exposition maximale par joueur ne peut pas dépasser la capacité totale de la plateforme.");
  return e;
}

function parsePresets(raw: string): number[] {
  return raw.split(/[\s,;]+/).filter(Boolean).map(Number).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v !== a[i - 1]);
}

export async function updateFuturesConfig(formData: FormData) {
  const patch = {
    is_active: bool(formData, "is_active"),
    margin_default: num(formData, "margin_default"),
    margin_min: num(formData, "margin_min"),
    margin_max: num(formData, "margin_max"),
    leverage_default: num(formData, "leverage_default"),
    leverage_min: num(formData, "leverage_min"),
    leverage_max: num(formData, "leverage_max"),
    leverage_presets: parsePresets(str(formData, "leverage_presets")),
    open_fee_pct: num(formData, "open_fee_pct"),
    close_fee_pct: num(formData, "close_fee_pct"),
    fee_interval_seconds: num(formData, "fee_interval_seconds"),
    fee_rate_pct: num(formData, "fee_rate_pct"),
    maintenance_margin_pct: num(formData, "maintenance_margin_pct"),
    max_open_positions: num(formData, "max_open_positions"),
    tp_sl_enabled: bool(formData, "tp_sl_enabled"),
    max_notional_per_user: numOrZero(formData, "max_notional_per_user"),
    max_total_notional: numOrZero(formData, "max_total_notional")
  };

  const db = getSupabaseAdmin();
  const { data: before } = await db.from("futures_config").select("*").eq("id", 1).maybeSingle();
  const changes = diffFields(before, patch);

  const errors = validate(patch);
  if (errors.length) {
    await logAdminAction({ action: "futures.config.update", summary: "Réglages futures refusés", target: "futures_config#1", changes, status: "error", errorMessage: errors.join(" | ") });
    done("error", "Réglages futures", errors.join(" "));
  }
  if (changes.length === 0) done("saved", "Réglages futures (aucun changement)");

  const { error } = await db.from("futures_config").update({ ...patch, updated_at: new Date().toISOString(), updated_by: getCurrentActor() }).eq("id", 1);
  await logAdminAction({
    action: "futures.config.update", summary: "Réglages futures", target: "futures_config#1",
    changes, status: error ? "error" : "success", errorMessage: error?.message
  });
  if (error) done("error", "Réglages futures", error.message);
  done("saved", "Réglages futures");
}

/** Interrupteur : bloque (ou rouvre) l'ouverture de nouvelles positions. Les positions existantes restent surveillées et fermables. */
export async function setFuturesActive(formData: FormData) {
  const active = str(formData, "active") === "1";
  const db = getSupabaseAdmin();
  const { data: before } = await db.from("futures_config").select("is_active").eq("id", 1).maybeSingle();
  const { error } = await db.from("futures_config").update({ is_active: active, updated_at: new Date().toISOString(), updated_by: getCurrentActor() }).eq("id", 1);
  await logAdminAction({
    action: active ? "futures.enable" : "futures.disable",
    summary: active ? "Trading futures réactivé" : "Trading futures désactivé",
    target: "futures_config#1",
    changes: [{ field: "is_active", before: before?.is_active ?? null, after: active }],
    status: error ? "error" : "success", errorMessage: error?.message
  });
  if (error) done("error", "Interrupteur futures", error.message);
  done("saved", active ? "Trading futures réactivé" : "Trading futures désactivé");
}

/** Ferme une position au prix du marché (même verrou et mêmes règles que l'app : jamais de double fermeture). */
export async function forceClosePosition(formData: FormData) {
  const id = str(formData, "position_id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) done("error", "Fermeture forcée", "Identifiant de position invalide.");
  const db = getSupabaseAdmin();
  const { data: pos } = await db.from("futures_positions").select("user_id, side, leverage, margin").eq("id", id).maybeSingle();
  const { data, error } = await db.rpc("admin_futures_force_close", { p_position_id: id });
  const res: any = data;
  const ok = !error && res?.success === true;
  const alreadyDone = ok && !!res?.note; // le moteur l'avait déjà clôturée (liquidation, TP ou SL)
  await logAdminAction({
    action: "futures.position.force_close",
    summary: alreadyDone ? "Fermeture forcée : déjà clôturée par le moteur" : (pos ? `Position ${pos.side} ${pos.leverage}x fermée de force` : "Fermeture forcée"),
    target: `futures_positions#${id}`,
    changes: [{ field: "status", before: "open", after: ok ? (alreadyDone ? "closed (moteur)" : "closed (manual)") : "open" }, ...(ok && !alreadyDone ? [{ field: "exit_price", before: null, after: res?.exit_price ?? null }] : [])],
    status: ok ? "success" : "error", errorMessage: ok ? undefined : (error?.message || res?.error)
  });
  if (!ok) done("error", "Fermeture forcée", error?.message || res?.error || "Échec");
  done("saved", alreadyDone ? "Position déjà clôturée par le moteur" : "Position fermée");
}

/** Urgence : ferme toutes les positions ouvertes. Exige de taper FERMER. */
export async function forceCloseAll(formData: FormData) {
  if (str(formData, "confirm").toUpperCase() !== "FERMER") done("error", "Fermeture de toutes les positions", "Confirmation incorrecte : tapez FERMER.");
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("admin_futures_close_all");
  const res: any = data;
  const failed = Number(res?.failed ?? 0);
  const ok = !error && failed === 0;
  await logAdminAction({
    action: "futures.force_close_all",
    summary: `Fermeture de toutes les positions : ${res?.closed ?? 0} fermée(s), ${failed} échec(s)`,
    target: "futures_positions#all",
    status: ok ? "success" : "error", errorMessage: ok ? undefined : (error?.message || res?.error || `${failed} position(s) non fermée(s)`)
  });
  if (!ok) done("error", "Fermeture de toutes les positions", error?.message || `${res?.closed ?? 0} fermée(s), ${failed} échec(s) : ${res?.error ?? "prix en retard ou position déjà traitée"}.`);
  done("saved", `${res?.closed ?? 0} position(s) fermée(s)`);
}
