/**
 * Garde commune des routes API (/api/*), qui ne sont PAS couvertes par le middleware du dashboard.
 * Chaque route appelle getRequestSession() en première ligne : une seule règle, pas de copier-coller.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionActor, getSessionRole, SESSION_COOKIE_NAME, type Role } from "@/core/auth/auth";
import { isSuperAdmin } from "@/core/auth/permissions";

export interface RequestSession { actor: string; role: Role }

/** Session valide portée par la requête, ou null (cookie absent, falsifié ou expiré). */
export function getRequestSession(req: NextRequest): RequestSession | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const role = getSessionRole(token);
  if (!role) return null;
  return { actor: getSessionActor(token) ?? "admin", role };
}

export function unauthorized() {
  return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
}

export function forbidden(message = "Action réservée aux super-administrateurs.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** Vrai si le rôle peut écrire (super_admin ou ancien « admin »). */
export function canWrite(role: Role): boolean {
  return isSuperAdmin(role);
}
