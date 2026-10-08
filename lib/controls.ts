import { getSupabaseAdmin } from "@/lib/data";

export type ControlStatus = "ok" | "warn" | "bad" | "info";
export interface Control { check_key: string; category: string; label: string; status: ControlStatus; value: string; detail: string }
export interface ControlsReport { controls: Control[]; ok: number; warn: number; bad: number; info: number; error?: string }

/** Exécute les contrôles automatiques côté base (fonction admin_run_controls, lecture seule). */
export async function loadControls(): Promise<ControlsReport> {
  const empty = { controls: [] as Control[], ok: 0, warn: 0, bad: 0, info: 0 };
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_run_controls");
    if (error) return { ...empty, error: error.message };
    const controls = ((data as Control[]) || []);
    const count = (s: ControlStatus) => controls.filter((c) => c.status === s).length;
    return { controls, ok: count("ok"), warn: count("warn"), bad: count("bad"), info: count("info") };
  } catch (e: any) {
    return { ...empty, error: e?.message || "Erreur inconnue" };
  }
}

export const CATEGORY_ORDER = ["Comptabilité", "Prix", "Tâches planifiées", "Opérations", "Jeux", "Sécurité", "Système"];
const SEVERITY: Record<ControlStatus, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
export const bySeverity = (a: Control, b: Control) => SEVERITY[a.status] - SEVERITY[b.status];
