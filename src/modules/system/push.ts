import { getSupabaseAdmin } from "@/core/db/data";

/** Notifications push (FCM) : appareils enregistrés, types activables, couverture. Fonction SQL admin_push_overview (migration 20261117). */

export interface PushType { type: string; enabled: boolean; notifs_30d: number }
export interface PushOverview {
  devices: number; users_with_device: number; users_total: number; last_registered_at: string | null;
  by_platform: { platform: string; devices: number; users: number }[];
  by_version: { version: string; devices: number }[];
  types: PushType[];
  types_without_push: { type: string; n: number }[];
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export async function loadPushOverview(): Promise<{ data: PushOverview | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_push_overview");
    if (error) return { data: null, error: error.message };
    const d: any = data ?? {};
    return {
      data: {
        devices: n(d.devices), users_with_device: n(d.users_with_device), users_total: n(d.users_total), last_registered_at: d.last_registered_at ?? null,
        by_platform: (d.by_platform ?? []).map((x: any) => ({ platform: String(x.platform), devices: n(x.devices), users: n(x.users) })),
        by_version: (d.by_version ?? []).map((x: any) => ({ version: String(x.version), devices: n(x.devices) })),
        types: (d.types ?? []).map((x: any) => ({ type: String(x.type), enabled: !!x.enabled, notifs_30d: n(x.notifs_30d) })),
        types_without_push: (d.types_without_push ?? []).map((x: any) => ({ type: String(x.type), n: n(x.n) }))
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}

/** Libellés lisibles des types de notification. Un type inconnu s'affiche tel quel. */
export const PUSH_TYPE_LABELS: Record<string, string> = {
  deposit_confirmed: "Dépôt confirmé",
  withdrawal_completed: "Retrait effectué",
  withdrawal_failed: "Retrait échoué",
  p2p_received: "Transfert P2P reçu",
  referral_bonus: "Bonus de parrainage",
  referral_success: "Parrainage réussi",
  score_loan_defaulted: "Prêt en défaut",
  loan_seized: "Garantie saisie",
  airtime_failed: "Recharge échouée",
  futures_liquidated: "Futures : liquidation",
  futures_tp_hit: "Futures : take profit atteint",
  futures_sl_hit: "Futures : stop loss atteint",
  prediction_won: "Prédiction gagnée",
  prediction_lost: "Prédiction perdue",
  admin_message: "Message de l'équipe"
};
export const pushTypeLabel = (t: string) => PUSH_TYPE_LABELS[t] ?? t;
