/** Contrôles d'accès purs (sans Node) : adresse IP du visiteur, liste d'IP autorisées, limitation des tentatives de connexion. */

export const LOGIN_MAX_FAILURES_PER_IP = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Vrai si cette IP a déjà trop d'échecs de connexion récents. */
export function isLoginBlocked(recentFailures: number): boolean {
  return recentFailures >= LOGIN_MAX_FAILURES_PER_IP;
}

/** IP du visiteur d'après les en-têtes de proxy (Vercel place l'IP réelle en premier dans x-forwarded-for). */
export function clientIp(headers: { get(name: string): string | null }): string | undefined {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || undefined;
}

/** Variable ADMIN_IP_ALLOWLIST : liste séparée par des virgules (IP exactes ou plages IPv4 « a.b.c.d/24 »). Vide ou absente : pas de restriction. */
export function parseAllowlist(raw: string | undefined | null): string[] | null {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const a = ipv4ToInt(ip), b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** Une IP inconnue est refusée (fail-closed). */
export function isIpAllowed(ip: string | undefined, allowlist: string[]): boolean {
  if (!ip) return false;
  return allowlist.some((rule) => (rule.includes("/") ? inCidr(ip, rule) : rule === ip));
}
