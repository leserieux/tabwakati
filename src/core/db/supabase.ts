import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `any` volontaire : pas de types générés pour l'instant (voir roadmap, phase 3). Même typage que l'ancien `createClient(url, key)` sans générique.
// (Ne pas utiliser ReturnType<typeof createClient> : TypeScript en déduit des colonnes `unknown` et le build échoue.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, "public", any>;
let cached: { id: string; client: AdminClient } | null = null;

/**
 * Client Supabase avec la clé service_role (accès complet, RLS ignoré).
 * ATTENTION : server-only. Ne jamais l'importer dans un composant client ("use client") ni l'exposer au navigateur.
 *
 * Un seul client est créé par processus et réutilisé (avant : un nouveau client à chaque appel, des dizaines par page).
 * Il est recréé seulement si l'URL ou la clé changent.
 */
export function getSupabaseAdmin(): AdminClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans les variables d'environnement");
  }
  const id = `${url}|${key}`;
  if (!cached || cached.id !== id) {
    cached = { id, client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) };
  }
  return cached.client;
}
