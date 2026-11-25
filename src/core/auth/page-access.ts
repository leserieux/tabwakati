/**
 * Matrice « page × permission ». Une seule source, utilisée par :
 *  - le middleware (refus 403 / redirection, y compris pour les actions serveur et les routes /api) ;
 *  - le menu et les onglets (une entrée non permise n'est pas affichée).
 *
 * Règle : le préfixe le plus long qui correspond gagne. Une URL SANS règle exige `settings.manage`
 * (super-administrateur seulement) : une page oubliée est refusée, jamais ouverte à tous.
 * Le test `tests/page-access.test.ts` vérifie que chaque page du menu a bien sa règle.
 */
import { hasPermission, type Permission } from "@/core/auth/permissions";

export const DEFAULT_PERMISSION: Permission = "settings.manage";

const RULES: ReadonlyArray<readonly [prefix: string, permission: Permission]> = [
  ["/dashboard/forbidden", "dashboard.read"],
  ["/dashboard/activity", "dashboard.read"],
  ["/dashboard/tasks", "dashboard.read"],

  // Utilisateurs et opérations (données personnelles)
  ["/dashboard/users", "users.read"],
  ["/dashboard/transactions", "users.read"],
  ["/dashboard/operations", "users.read"],
  ["/dashboard/analytics", "users.read"],
  ["/dashboard/telegram", "users.read"],
  ["/dashboard/pnl/acquisition", "users.read"],
  ["/dashboard/pnl/utilisateurs", "users.read"],

  // Trésorerie, revenus, produits, WAKATI : tout ce qui montre de l'argent
  ["/dashboard/assets", "finance.read"],
  ["/dashboard/funding", "finance.read"],
  ["/dashboard/treasury", "finance.read"],
  ["/dashboard/custody", "finance.read"],
  ["/dashboard/sweep", "finance.read"],
  ["/dashboard/liquidity", "finance.read"],
  ["/dashboard/staking-plan", "finance.read"],
  ["/dashboard/pnl", "finance.read"],
  ["/dashboard/fees", "finance.read"],
  ["/dashboard/credit", "finance.read"],
  ["/dashboard/futures", "finance.read"],
  ["/dashboard/games", "finance.read"],
  ["/dashboard/p2p", "finance.read"],
  ["/dashboard/markets", "finance.read"],
  ["/dashboard/wakati", "finance.read"],
  ["/dashboard/controls", "finance.read"],

  // Système
  ["/dashboard/audit", "audit.read"],
  ["/dashboard/admins", "admins.manage"],
  ["/dashboard/approvals", "approvals.decide"],
  ["/dashboard/alerts", "alerts.read"],
  ["/dashboard/notifications", "push.send"],
  ["/dashboard/settings", "settings.manage"],
  ["/dashboard/app", "settings.manage"],

  // Routes API (le middleware les couvre aussi ; chaque route revérifie)
  ["/api/transactions/export", "exports.run"],
  ["/api/custody/export", "exports.run"],
  ["/api/users", "exports.run"],
  ["/api/sweep", "finance.read"]
];

/** Chemin nettoyé : décodé, en minuscules, sans double barre ni barre finale. Un chemin illisible ou ambigu (« .. ») devient "" (donc refusé par défaut). */
function normalize(pathname: string): string {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return ""; }
  p = p.toLowerCase().replace(/\/{2,}/g, "/");
  if (/(^|\/)\.{1,2}(\/|$)/.test(p)) return ""; // segments "." ou ".." : chemin ambigu, refusé par défaut
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

function matchRule(p: string): { prefix: string; permission: Permission } | null {
  let best: { prefix: string; permission: Permission } | null = null;
  for (const [prefix, permission] of RULES) {
    if ((p === prefix || p.startsWith(`${prefix}/`)) && (!best || prefix.length > best.prefix.length)) best = { prefix, permission };
  }
  return best;
}

/** Permission exigée pour cette URL. */
export function requiredPermission(pathname: string): Permission {
  const p = normalize(pathname);
  if (p === "/dashboard") return "dashboard.read";
  return matchRule(p)?.permission ?? DEFAULT_PERMISSION;
}

/** Vrai si l'URL a une règle explicite (utile aux tests : aucune page du menu ne doit tomber sur la règle par défaut). */
export function hasExplicitRule(pathname: string): boolean {
  const p = normalize(pathname);
  return p === "/dashboard" || matchRule(p) !== null;
}

export function canAccess(role: string | null | undefined, pathname: string): boolean {
  return hasPermission(role, requiredPermission(pathname));
}
