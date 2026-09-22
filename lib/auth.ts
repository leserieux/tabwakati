import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "wakati_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
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

/** Crée un token de session signé "expiresAt.actorBase64.signature". */
export function createSessionToken(actor?: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const actorB64 = Buffer.from(sanitizeActor(actor), "utf8").toString("base64url");
  const payload = `${expiresAt}.${actorB64}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

/** Décode+vérifie un token. Renvoie null si invalide/expiré, sinon { actor, expiresAt }. */
function decodeSessionToken(token: string | undefined | null): { actor: string; expiresAt: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiresAtStr, actorB64, signature] = parts;
  const payload = `${expiresAtStr}.${actorB64}`;

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

  return { actor, expiresAt };
}

/** Vérifie un token de session. Retourne true s'il est valide et non expiré. */
export function verifySessionToken(token: string | undefined | null): boolean {
  return decodeSessionToken(token) !== null;
}

/** Nom de l'admin associé à ce token, ou null si le token est invalide/expiré. */
export function getSessionActor(token: string | undefined | null): string | null {
  return decodeSessionToken(token)?.actor ?? null;
}

/** Compare le mot de passe fourni à ADMIN_PASSWORD, en temps constant. */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD manquant dans les variables d'environnement");
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
