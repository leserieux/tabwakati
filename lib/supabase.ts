import { createClient } from "@supabase/supabase-js";

// ATTENTION: ce client utilise la clé service_role (accès complet, RLS
// ignoré). Il ne doit JAMAIS être importé dans un composant client
// ("use client") ni exposé au navigateur. Utilisation server-only uniquement
// (Server Components / API routes avec `export const runtime = "nodejs"`).
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans les variables d'environnement");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
