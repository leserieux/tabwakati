import { getSupabaseAdmin } from "@/lib/data";

/** Bot Telegram : comptes liés et journal des liaisons. Fonction SQL admin_telegram_overview (migration 20261117). */

export interface TelegramLink {
  telegram_id: number; telegram_username: string | null; telegram_first_name: string | null;
  linked_via: string | null; lang: string | null; created_at: string;
  user_id: string; username: string | null; email: string | null;
}
export interface TelegramAuditRow { event: string; telegram_id: number | null; created_at: string; user_id: string | null; username: string | null; email: string | null }
export interface TelegramOverview {
  links: number; linked_7d: number; users_total: number;
  by_lang: { lang: string; n: number }[]; by_via: { via: string; n: number }[];
  tokens: { pending: number; used: number; expired: number };
  audit_30d: { event: string; n: number }[];
  recent_links: TelegramLink[]; recent_audit: TelegramAuditRow[];
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export async function loadTelegramOverview(): Promise<{ data: TelegramOverview | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_telegram_overview");
    if (error) return { data: null, error: error.message };
    const d: any = data ?? {};
    return {
      data: {
        links: n(d.links), linked_7d: n(d.linked_7d), users_total: n(d.users_total),
        by_lang: (d.by_lang ?? []).map((x: any) => ({ lang: String(x.lang), n: n(x.n) })),
        by_via: (d.by_via ?? []).map((x: any) => ({ via: String(x.via), n: n(x.n) })),
        tokens: { pending: n(d.tokens?.pending), used: n(d.tokens?.used), expired: n(d.tokens?.expired) },
        audit_30d: (d.audit_30d ?? []).map((x: any) => ({ event: String(x.event), n: n(x.n) })),
        recent_links: (d.recent_links ?? []) as TelegramLink[],
        recent_audit: (d.recent_audit ?? []) as TelegramAuditRow[]
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}

export const TELEGRAM_EVENT_LABELS: Record<string, string> = {
  token_created: "Lien de liaison créé",
  linked: "Compte lié",
  unlinked: "Compte délié",
  token_expired: "Lien expiré",
  token_rejected: "Lien refusé"
};
export const telegramEventLabel = (e: string) => TELEGRAM_EVENT_LABELS[e] ?? e;
