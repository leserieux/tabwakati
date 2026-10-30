"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin, loadPrices } from "@/lib/data";
import { logAdminAction, type AuditChange } from "@/lib/audit";
import { loadSolvencyLines } from "@/lib/solvency";
import { buildPlans, saveSnapshot } from "@/lib/custody-policy";

const PATH = "/dashboard/custody";

function fail(asset: string, msg: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(asset || "réglages")}&msg=${encodeURIComponent(msg)}`);
}

function num(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
  return raw === "" ? NaN : Number(raw);
}

/** Enregistre les réglages d'un actif. Mêmes limites que les contraintes de la base. */
export async function savePolicy(formData: FormData) {
  const asset = String(formData.get("asset_symbol") || "").trim();
  if (!asset) fail(asset, "Actif manquant.");

  const next = {
    min_hot: num(formData, "min_hot"),
    days_cover: num(formData, "days_cover"),
    low_pct: num(formData, "low_pct"),
    high_pct: num(formData, "high_pct"),
    invest_pct: num(formData, "invest_pct"),
    safety_pct: num(formData, "safety_pct")
  };
  for (const [k, v] of Object.entries(next)) if (!Number.isFinite(v)) fail(asset, `Le champ « ${k} » doit être un nombre.`);
  if (next.min_hot < 0) fail(asset, "Le plancher ne peut pas être négatif.");
  if (next.days_cover < 0 || next.days_cover > 90) fail(asset, "Le nombre de jours doit être entre 0 et 90.");
  if (next.low_pct <= 0 || next.low_pct > 100) fail(asset, "L'alerte « à remplir » doit être entre 1 et 100 % de la cible.");
  if (next.high_pct < 100 || next.high_pct > 1000) fail(asset, "L'alerte « trop plein » doit être entre 100 et 1000 % de la cible.");
  if (next.invest_pct < 0 || next.invest_pct > 100) fail(asset, "La part qui peut travailler doit être entre 0 et 100 %.");
  if (next.safety_pct < 0 || next.safety_pct > 1000) fail(asset, "La marge de sécurité doit être entre 0 et 1000 %.");

  const db = getSupabaseAdmin();
  const { data: before } = await db.from("custody_policy").select("*").eq("asset_symbol", asset).maybeSingle();
  const { error } = await db
    .from("custody_policy")
    .upsert({ asset_symbol: asset, ...next, updated_at: new Date().toISOString() }, { onConflict: "asset_symbol" });

  const defaults: Record<string, number> = { min_hot: 0, days_cover: 3, low_pct: 50, high_pct: 150, invest_pct: 0, safety_pct: 20 };
  const changes: AuditChange[] = Object.entries(next)
    .map(([field, after]) => ({ field, before: before ? Number((before as any)[field]) : defaults[field], after }))
    .filter((c) => c.before !== c.after);

  await logAdminAction({
    action: "custody.policy",
    summary: `Réserve de retrait ${asset}`,
    target: `custody_policy#${asset}`,
    changes,
    status: error ? "error" : "success",
    errorMessage: error?.message
  });

  revalidatePath(PATH);
  if (error) fail(asset, error.message);
  redirect(`${PATH}?saved=${encodeURIComponent(asset)}`);
}

/** Enregistre le relevé du jour tout de suite (il est aussi pris automatiquement une fois par jour). */
export async function takeSnapshot() {
  const prices = await loadPrices();
  const sol = await loadSolvencyLines(prices);
  if (sol.error) fail("relevé", sol.error);
  const { plans } = await buildPlans(sol);

  const unreadable = plans.filter((p) => p.have === null).map((p) => p.asset);
  if (unreadable.length > 0) {
    fail("relevé", `Relevé non enregistré : lecture impossible pour ${unreadable.join(", ")}. On n'enregistre pas un relevé incomplet, il ferait croire à un manque.`);
  }
  const error = await saveSnapshot(plans);
  await logAdminAction({
    action: "custody.snapshot",
    summary: "Relevé de couverture enregistré",
    target: "custody_snapshots",
    status: error ? "error" : "success",
    errorMessage: error ?? undefined
  });
  revalidatePath(PATH);
  if (error) fail("relevé", error);
  redirect(`${PATH}?snap=1`);
}
