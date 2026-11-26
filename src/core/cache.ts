/**
 * Cache mémoire très court (60 s) pour les rapports lourds. Par instance de serveur, volontairement simple :
 *  - le résultat porte l'heure réelle de son calcul (`computedAt`) : l'écran affiche la vraie fraîcheur, pas l'heure d'ouverture de la page ;
 *  - deux demandes simultanées partagent le même calcul (pas de ruée sur la base) ;
 *  - un résultat en erreur (`error` renseigné) n'est jamais gardé : on réessaie à la demande suivante ;
 *  - le bouton « Actualiser » (action serveur) vide le cache.
 * Ne pas y mettre une page qui écrit en base ou qui dépend de la session.
 */
export const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type Stored = { value: unknown; computedAt: number };
const store = new Map<string, Stored>();
const inflight = new Map<string, Promise<Stored>>();

const noError = (value: unknown): boolean =>
  !(value && typeof value === "object" && "error" in value && Boolean((value as { error?: unknown }).error));

export async function cachedFor<T>(
  key: string, ttlMs: number, load: () => Promise<T>,
  opts: { now?: () => number; cacheable?: (value: T) => boolean } = {}
): Promise<{ value: T; computedAt: number; cached: boolean }> {
  const now = opts.now ?? Date.now;
  const hit = store.get(key);
  if (hit && now() - hit.computedAt < ttlMs) return { value: hit.value as T, computedAt: hit.computedAt, cached: true };

  const running = inflight.get(key);
  if (running) { const r = await running; return { value: r.value as T, computedAt: r.computedAt, cached: false }; }

  const promise = (async (): Promise<Stored> => {
    const computedAt = now();
    const value = await load();
    if ((opts.cacheable ?? noError)(value)) {
      if (store.size >= MAX_ENTRIES) { const oldest = store.keys().next().value; if (oldest !== undefined) store.delete(oldest); }
      store.set(key, { value, computedAt });
    }
    return { value, computedAt };
  })();
  inflight.set(key, promise);
  try {
    const r = await promise;
    return { value: r.value as T, computedAt: r.computedAt, cached: false };
  } finally {
    inflight.delete(key);
  }
}

export function clearCache(): void {
  store.clear();
}
