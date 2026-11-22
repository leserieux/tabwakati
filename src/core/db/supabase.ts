import { createClient } from "@supabase/supabase-js";

type AdminClient = ReturnType<typeof createClient>;
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
