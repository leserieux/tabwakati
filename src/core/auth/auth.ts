import { createHmac, timingSafeEqual } from "crypto";
import {
  DEFAULT_ACTOR, SESSION_COOKIE_NAME, SESSION_TTL_MS, parseToken, sanitizeActor, type Role
} from "@/core/auth/token";

export { SESSION_COOKIE_NAME, SESSION_TTL_MS };
export type { Role };

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET manquant dans les variables d'environnement");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/** Crée un jeton de session signé "expiresAt.actorBase64.role.signature" (l'ancien format sans rôle reste lisible : rôle admin). */
export function createSessionToken(actor?: string, role: Role = "admin"): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const actorB64 = Buffer.from(sanitizeActor(actor), "utf8").toString("base64url");
  const payload = `${expiresAt}.${actorB64}.${role}`;
  return `${payload}.${sign(payload)}`;
}

/** Décode et vérifie un jeton. Renvoie null s'il est invalide ou expiré, sinon { actor, expiresAt, role }. */
function decodeSessionToken(token: string | undefined | null): { actor: string; expiresAt: number; role: Role } | null {
  const parsed = parseToken(token);
  if (!parsed) return null;

  const a = Buffer.from(parsed.signature);
  const b = Buffer.from(sign(parsed.payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() > parsed.expiresAt) return null;

  let actor = DEFAULT_ACTOR;
  try {
    actor = sanitizeActor(Buffer.from(parsed.actorB64, "base64url").toString("utf8"));
  } catch {
    // Ancien format de jeton (sans nom) : on retombe sur le nom par défaut.
  }
  return { actor, expiresAt: parsed.expiresAt, role: parsed.role };
}

/** Vrai si le jeton est valide et non expiré. */
export function verifySessionToken(token: string | undefined | null): boolean {
  return decodeSessionToken(token) !== null;
}

/** Nom de l'admin associé à ce jeton, ou null s'il est invalide ou expiré. */
export function getSessionActor(token: string | undefined | null): string | null {
  return decodeSessionToken(token)?.actor ?? null;
}

/** Rôle du jeton, ou null s'il est invalide ou expiré. */
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
