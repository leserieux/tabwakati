/**
 * Révocation des sessions, côté Edge (middleware) : un jeton correctement signé n'est plus accepté
 * si sa ligne `admin_sessions` est révoquée, expirée ou supprimée.
 *
 * Un cache de 30 s évite un aller-retour base à chaque navigation : une révocation prend effet en 30 s au plus.
 * Si la base est injoignable, on laisse passer (la signature reste valide) plutôt que de déconnecter tout le monde.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { active: boolean; until: number }>();

type Fetcher = (url: string, init: { headers: Record<string, string>; cache: "no-store" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function isSessionActiveEdge(
  sid: string, supabaseUrl: string | undefined, serviceKey: string | undefined, now = Date.now(), fetcher: Fetcher = fetch as unknown as Fetcher
): Promise<boolean> {
  if (!supabaseUrl || !serviceKey) return true;
  const hit = cache.get(sid);
  if (hit && hit.until > now) return hit.active;
  try {
    const res = await fetcher(`${supabaseUrl}/rest/v1/admin_sessions?id=eq.${encodeURIComponent(sid)}&select=revoked_at,expires_at&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store"
    });
    if (!res.ok) return true;
    const rows = (await res.json()) as Array<{ revoked_at: string | null; expires_at: string }>;
    const row = rows[0];
    const active = !!row && !row.revoked_at && new Date(row.expires_at).getTime() > now;
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(sid, { active, until: now + TTL_MS });
    return active;
  } catch {
    return true;
  }
}

/** Pour les tests. */
export function clearSessionCache(): void {
  cache.clear();
}
