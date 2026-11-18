import { getSupabaseAdmin } from "@/lib/data";

export type ControlStatus = "ok" | "warn" | "bad" | "info";
export interface Control { check_key: string; category: string; label: string; status: ControlStatus; value: string; detail: string }
export interface ControlsReport { controls: Control[]; ok: number; warn: number; bad: number; info: number; error?: string }

const fmtAge = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/**
 * Contrôles ajoutés côté dashboard (sans toucher à admin_run_controls) : flux de prix des jeux (prédiction + futures)
 * et appareils push. Données : admin_price_feed_health et admin_push_overview (migration 20261117). Jamais d'exception.
 */
async function extraControls(): Promise<Control[]> {
  const out: Control[] = [];
  const db = getSupabaseAdmin();
  try {
    const { data, error } = await db.rpc("admin_price_feed_health");
    if (!error && data) {
      const d: any = data;
      const assets: { asset: string; age_s: number; sources: number }[] = d.assets ?? [];
      const missing: string[] = d.missing ?? [];
      const worst = assets.reduce((m, a) => Math.max(m, Number(a.age_s) || 0), 0);
      const stale = assets.filter((a) => Number(a.age_s) > 30).map((a) => `${a.asset} (${fmtAge(Number(a.age_s))})`);
      const lowSrc = assets.filter((a) => Number(a.sources) < 2).map((a) => a.asset);
      let status: ControlStatus = "ok";
      let detail = `Dernier prix de chaque marché actif : ${assets.map((a) => `${a.asset} ${fmtAge(Number(a.age_s))}`).join(", ") || "aucun"}. La prédiction et les futures refusent d'opérer au-delà de 15 s.`;
      if (missing.length || assets.length === 0) { status = "bad"; detail = `Aucun prix enregistré pour : ${missing.join(", ") || "tous les marchés"}.`; }
      else if (worst > 120) { status = "bad"; detail = `Prix périmés : ${stale.join(", ")}. Prédiction et futures sont bloqués tant que le relevé ne repart pas.`; }
      else if (worst > 30) { status = "warn"; detail = `Prix en retard : ${stale.join(", ")}. Limite d'opération : 15 s.`; }
      else if (lowSrc.length) { status = "warn"; detail = `Un seul fournisseur de prix actif pour : ${lowSrc.join(", ")} (pas de recoupement).`; }
      out.push({ check_key: "game_price_feed_fresh", category: "Prix", label: "Prix des jeux (prédiction, futures)", status, value: assets.length ? `plus ancien : ${fmtAge(worst)}` : "aucun prix", detail });

      const c = d.cron;
      if (!c) out.push({ check_key: "game_price_feed_cron", category: "Tâches planifiées", label: "Relevé des prix des jeux (game-price-feed)", status: "bad", value: "absente", detail: "La tâche planifiée « game-price-feed » n'existe pas : les prix ne sont plus relevés." });
      else {
        const age = c.last_run ? (Date.now() - new Date(c.last_run).getTime()) / 1000 : null;
        let st: ControlStatus = "ok";
        let det = `Planifiée « ${c.schedule} », dernier passage il y a ${age === null ? "?" : fmtAge(age)} (${c.last_status ?? "?"}).`;
        if (!c.active) { st = "bad"; det = "La tâche « game-price-feed » est désactivée."; }
        else if (c.last_status && c.last_status !== "succeeded") { st = "bad"; det = `Dernier passage en échec (${c.last_status}) : ${c.last_message || "sans détail"}.`; }
        else if (age === null || age > 180) { st = "bad"; det = `La tâche n'a pas tourné depuis ${age === null ? "longtemps" : fmtAge(age)} (prévue chaque minute).`; }
        out.push({ check_key: "game_price_feed_cron", category: "Tâches planifiées", label: "Relevé des prix des jeux (game-price-feed)", status: st, value: age === null ? "jamais" : `il y a ${fmtAge(age)}`, detail: det });
      }
    }
  } catch { /* contrôle facultatif : ne casse jamais la page */ }

  try {
    const { data, error } = await db.rpc("admin_push_overview");
    if (!error && data) {
      const d: any = data;
      const devices = Number(d.devices) || 0;
      const users = Number(d.users_with_device) || 0;
      out.push({
        check_key: "push_devices", category: "Opérations", label: "Appareils enregistrés pour les push",
        status: devices === 0 ? "info" : "ok", value: `${devices} appareil(s) · ${users} utilisateur(s)`,
        detail: devices === 0 ? "Aucun appareil enregistré : aucune notification push ne peut partir (les notifications dans l'app fonctionnent)." : `${users} utilisateur(s) sur ${Number(d.users_total) || 0} sont joignables par push.`
      });
    }
  } catch { /* idem */ }
  return out;
}

/** Exécute les contrôles automatiques côté base (fonction admin_run_controls, lecture seule). */
export async function loadControls(): Promise<ControlsReport> {
  const empty = { controls: [] as Control[], ok: 0, warn: 0, bad: 0, info: 0 };
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_run_controls");
    if (error) return { ...empty, error: error.message };
    // Le burn WAKATI est 100 % comptable : on masque l'ancien contrôle « Burns envoyés on-chain ».
    const extra = await extraControls();
    const controls = [...((data as Control[]) || []).filter((c) => c.check_key !== "burn_pending_onchain"), ...extra];
    const count = (s: ControlStatus) => controls.filter((c) => c.status === s).length;
    return { controls, ok: count("ok"), warn: count("warn"), bad: count("bad"), info: count("info") };
  } catch (e: any) {
    return { ...empty, error: e?.message || "Erreur inconnue" };
  }
}

export const CATEGORY_ORDER = ["Comptabilité", "Prix", "Tâches planifiées", "Opérations", "Jeux", "Sécurité", "Système"];
const SEVERITY: Record<ControlStatus, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
export const bySeverity = (a: Control, b: Control) => SEVERITY[a.status] - SEVERITY[b.status];
