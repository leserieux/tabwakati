import { cookies } from "next/headers";
import { getSessionRole, SESSION_COOKIE_NAME, type Role } from "@/lib/auth";

/** Rôle de la session en cours (server-only), ou null si le cookie est absent, falsifié ou expiré. */
export function currentRole(): Role | null {
  return getSessionRole(cookies().get(SESSION_COOKIE_NAME)?.value);
}

/**
 * À appeler en PREMIÈRE ligne de toute action serveur qui modifie quelque chose.
 * Le middleware ne vérifie que la présence du cookie ; seule cette fonction contrôle la signature et le rôle.
 * Lève une erreur si la session est invalide, expirée ou en lecture seule.
 */
export function assertCanWrite(): void {
  const role = currentRole();
  if (role === null) throw new Error("Session invalide ou expirée : reconnecte-toi.");
  if (role !== "admin") throw new Error("Compte en lecture seule : cette action est réservée aux administrateurs.");
}
