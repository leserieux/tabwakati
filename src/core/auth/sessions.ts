/** Sessions admin en base (Node, serveur uniquement) : création à la connexion, révocation à la déconnexion ou sur ordre d'un super-admin. */
import { getSupabaseAdmin } from "@/core/db/supabase";
import { SESSION_TTL_MS } from "@/core/auth/token";

export async function createAdminSession(p: { actor: string; adminUserId: string | null; role: string; ip?: string; userAgent?: string | null }): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().from("admin_sessions").insert({
    actor: p.actor, admin_user_id: p.adminUserId, role: p.role, ip: p.ip ?? null, user_agent: p.userAgent ?? null,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  }).select("id").single();
  if (error || !data) return null;
  return data.id as string;
}

export async function revokeSession(sid: string, by: string, reason: string): Promise<void> {
  await getSupabaseAdmin().from("admin_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_by: by, revoke_reason: reason })
    .eq("id", sid).is("revoked_at", null);
}

/** Révoque toutes les sessions actives d'un administrateur. Renvoie le nombre de sessions fermées. */
export async function revokeAllSessionsFor(actor: string, by: string, reason: string): Promise<number> {
  const { data } = await getSupabaseAdmin().from("admin_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_by: by, revoke_reason: reason })
    .eq("actor", actor).is("revoked_at", null).gt("expires_at", new Date().toISOString()).select("id");
  return data?.length ?? 0;
}

/** Nombre de sessions actives par administrateur. */
export async function countActiveSessions(): Promise<Record<string, number>> {
  const { data } = await getSupabaseAdmin().from("admin_sessions").select("actor")
    .is("revoked_at", null).gt("expires_at", new Date().toISOString()).limit(1000);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ actor: string }>) out[r.actor] = (out[r.actor] ?? 0) + 1;
  return out;
}
