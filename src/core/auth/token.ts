/**
 * Format du jeton de session : partie PURE, sans aucun import Node.
 * Elle est partagée par le serveur Node (auth.ts) et par le middleware Edge (edge.ts).
 *
 *   format actuel : "expiresAt.actorBase64.role.sessionId.signature"  (sessionId = ligne de admin_sessions : révocable)
 *   format 2      : "expiresAt.actorBase64.role.signature"            (sans identifiant : non révocable, expire seul)
 *   ancien format : "expiresAt.actorBase64.signature"                 (lu comme rôle « admin »)
 */

export const SESSION_COOKIE_NAME = "wakati_admin_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h

/** admin (ancien mot de passe partagé) et super_admin = tout ; viewer = lecture seule ; les autres : voir permissions.ts. */
export type Role = "admin" | "super_admin" | "finance" | "support" | "risk" | "viewer";
export const ROLES: readonly Role[] = ["admin", "super_admin", "finance", "support", "risk", "viewer"];

export const DEFAULT_ACTOR = "admin"; // utilisé si aucun nom n'a été saisi (anciens jetons, ou champ vide)
const MAX_ACTOR_LEN = 40;

/** Nettoie le nom saisi à la connexion : pas de séparateur, longueur raisonnable. */
export function sanitizeActor(name: string | undefined | null): string {
  const cleaned = (name || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, MAX_ACTOR_LEN);
  return cleaned || DEFAULT_ACTOR;
}

export interface ParsedToken {
  /** Texte signé (tout sauf la signature). */
  payload: string;
  signature: string;
  expiresAt: number;
  actorB64: string;
  role: Role;
  /** Identifiant de la session en base (jetons récents seulement) : sert à la révocation. */
  sid?: string;
}

const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Découpe un jeton et contrôle sa FORME (rôle connu, date lisible). Ne vérifie NI la signature NI l'expiration :
 * c'est le rôle de l'appelant (Node : HMAC + timingSafeEqual ; Edge : Web Crypto).
 */
export function parseToken(token: string | undefined | null): ParsedToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 3 || parts.length > 5) return null;
  const [expiresAtStr, actorB64] = parts;
  const signature = parts[parts.length - 1];
  const roleStr = parts.length >= 4 ? parts[2] : "admin"; // ancien format : toujours admin
  const sid = parts.length === 5 ? parts[3] : undefined;
  if (sid !== undefined && !SID_RE.test(sid)) return null;
  if (!ROLES.includes(roleStr as Role)) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return null;
  const payload = parts.slice(0, parts.length - 1).join(".");
  return { payload, signature, expiresAt, actorB64, role: roleStr as Role, sid };
}
