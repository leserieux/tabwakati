import { cookies } from "next/headers";
import { getSessionRole, SESSION_COOKIE_NAME, type Role } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";

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
  if (role !== "admin" && role !== "super_admin") throw new Error("Cette action est réservée aux super-administrateurs.");
}

/** Vrai si la session en cours a cette permission (pour masquer un bouton). La sécurité reste dans assertCan. */
export function can(permission: Permission): boolean {
  return hasPermission(currentRole(), permission);
}

/** À appeler en première ligne d'une action serveur : exige la permission précise (users.freeze, admins.manage…). */
export function assertCan(permission: Permission): void {
  const role = currentRole();
  if (role === null) throw new Error("Session invalide ou expirée : reconnecte-toi.");
  if (!hasPermission(role, permission)) throw new Error(`Permission refusée (${permission}) pour le rôle ${role}.`);
}
