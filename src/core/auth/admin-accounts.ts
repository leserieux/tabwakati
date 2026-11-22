import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/core/db/supabase";
import type { Role } from "@/core/auth/auth";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, n, r, p, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Renvoie un message d'erreur, ou null si le mot de passe est acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Le mot de passe doit faire au moins 12 caractères.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Le mot de passe doit contenir des lettres et des chiffres.";
  return null;
}

export type AuthResult =
  | { status: "ok"; id: string; actor: string; role: Role }
  | { status: "no_account" }
  | { status: "denied" }; // mot de passe faux, compte désactivé ou verrouillé : même message côté client

/**
 * Connexion par compte nominatif. "no_account" = cet identifiant n'existe pas dans admin_users
 * (le routeur peut alors tomber sur l'ancien accès par mot de passe partagé).
 */
export async function authenticateAdmin(username: string, password: string, ip?: string): Promise<AuthResult> {
  const db = getSupabaseAdmin();
  const login = username.trim().toLowerCase();
  const { data, error } = await db.from("admin_users")
    .select("id, username, role, password_hash, is_active, failed_attempts, locked_until")
    .eq("username", login).limit(1);
  if (error || !data || data.length === 0) return { status: "no_account" };
  const acc = data[0] as { id: string; username: string; role: Role; password_hash: string | null; is_active: boolean; failed_attempts: number; locked_until: string | null };

  if (!acc.is_active) return { status: "denied" };
  if (acc.locked_until && new Date(acc.locked_until).getTime() > Date.now()) return { status: "denied" };

  if (!verifyPassword(password, acc.password_hash)) {
    const failed = (acc.failed_attempts || 0) + 1;
    await db.from("admin_users").update({
      failed_attempts: failed >= MAX_FAILED ? 0 : failed,
      locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", acc.id);
    return { status: "denied" };
  }

  await db.from("admin_users").update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString(), last_login_ip: ip ?? null }).eq("id", acc.id);
  return { status: "ok", id: acc.id, actor: acc.username, role: acc.role };
}
