import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "wakati_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export type Role = "admin" | "super_admin" | "finance" | "support" | "risk" | "viewer"; // admin (ancien mot de passe partagé) et super_admin = tout ; viewer = lecture seule ; les autres : voir lib/permissions.ts
const ROLES: Role[] = ["admin", "super_admin", "finance", "support", "risk", "viewer"];
const DEFAULT_ACTOR = "admin"; // utilisé si aucun nom n'a été saisi (anciens tokens, ou champ vide)
const MAX_ACTOR_LEN = 40;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET manquant dans les variables d'environnement");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/** Nettoie le nom saisi à la connexion : pas de séparateur, longueur raisonnable. */
function sanitizeActor(name: string | undefined | null): string {
  const cleaned = (name || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, MAX_ACTOR_LEN);
  return cleaned || DEFAULT_ACTOR;
}

/** Crée un token de session signé "expiresAt.actorBase64.role.signature" (les anciens tokens "expiresAt.actorBase64.signature" restent lisibles : rôle admin). */
export function createSessionToken(actor?: string, role: Role = "admin"): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const actorB64 = Buffer.from(sanitizeActor(actor), "utf8").toString("base64url");
  const payload = `${expiresAt}.${actorB64}.${role}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

/** Décode+vérifie un token. Renvoie null si invalide/expiré, sinon { actor, expiresAt }. */
function decodeSessionToken(token: string | undefined | null): { actor: string; expiresAt: number; role: Role } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const expiresAtStr = parts[0];
  const actorB64 = parts[1];
  const signature = parts[parts.length - 1];
  const roleStr = parts.length === 4 ? parts[2] : "admin"; // ancien format : toujours admin
  if (!ROLES.includes(roleStr as Role)) return null;
  const role = roleStr as Role;
  const payload = parts.length === 4 ? `${expiresAtStr}.${actorB64}.${roleStr}` : `${expiresAtStr}.${actorB64}`;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  let actor = DEFAULT_ACTOR;
  try {
    actor = sanitizeActor(Buffer.from(actorB64, "base64url").toString("utf8"));
  } catch {
    // Ancien format de token (sans nom) : on retombe sur le nom par défaut.
  }

  return { actor, expiresAt, role };
}

/** Vérifie un token de session. Retourne true s'il est valide et non expiré. */
export function verifySessionToken(token: string | undefined | null): boolean {
  return decodeSessionToken(token) !== null;
}

/** Nom de l'admin associé à ce token, ou null si le token est invalide/expiré. */
export function getSessionActor(token: string | undefined | null): string | null {
  return decodeSessionToken(token)?.actor ?? null;
}

/** Rôle du token (admin ou viewer), ou null si le token est invalide/expiré. */
export function getSessionRole(token: string | undefined | null): Role | null {
  return decodeSessionToken(token)?.role ?? null;
}

function safeEqual(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Compare le mot de passe fourni à ADMIN_PASSWORD, en temps constant. */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD manquant dans les variables d'environnement");
  return safeEqual(input, expected);
}

/**
 * Identifie le rôle d'après le mot de passe : ADMIN_PASSWORD => admin ; ADMIN_VIEWER_PASSWORD (optionnel) => viewer (lecture seule).
 * Les deux mots de passe doivent être différents ; en cas d'égalité, c'est le rôle le moins puissant qui s'applique.
 */
export function identifyRole(input: string): Role | null {
  const viewerPwd = process.env.ADMIN_VIEWER_PASSWORD;
  if (viewerPwd && safeEqual(input, viewerPwd)) return "viewer";
  return checkPassword(input) ? "admin" : null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
