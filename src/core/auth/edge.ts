/**
 * Vérification COMPLÈTE d'un jeton de session dans le runtime Edge (middleware).
 * Utilise Web Crypto (disponible en Edge ET en Node 20+) : aucun import Node ici.
 * Avant, le middleware ne vérifiait que la PRÉSENCE du cookie ; un faux cookie passait jusqu'au layout.
 */
import { parseToken, type Role } from "@/core/auth/token";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparaison en temps constant de deux chaînes de même nature (signatures hexadécimales). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface EdgeSession { role: Role; sid?: string; expiresAt: number }

/** Session décrite par le jeton si celui-ci est bien signé avec `secret` et pas expiré, sinon null. Refuse tout (fail-closed) si le secret est absent. */
export async function verifySessionEdgeParsed(token: string | undefined | null, secret: string | undefined | null, now = Date.now()): Promise<EdgeSession | null> {
  if (!secret) return null;
  const parsed = parseToken(token);
  if (!parsed) return null;
  if (now > parsed.expiresAt) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(parsed.payload)));
  if (!constantTimeEqual(parsed.signature, expected)) return null;
  return { role: parsed.role, sid: parsed.sid, expiresAt: parsed.expiresAt };
}

/** Vrai si le jeton est bien signé avec `secret` et pas expiré. */
export async function verifySessionEdge(token: string | undefined | null, secret: string | undefined | null, now = Date.now()): Promise<boolean> {
  return (await verifySessionEdgeParsed(token, secret, now)) !== null;
}
