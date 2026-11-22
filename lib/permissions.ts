/** Rôles admin et permissions. Miroir de la table admin_role_permissions en base (la source de vérité côté dashboard). */
export type Permission =
  | "dashboard.read" | "users.read" | "users.notes" | "users.freeze" | "users.limits"
  | "finance.read" | "finance.write" | "withdrawals.review" | "kyc.review" | "risk.manage"
  | "tasks.manage" | "push.send" | "audit.read" | "admins.manage";

const MAP: Record<string, readonly Permission[]> = {
  finance: ["dashboard.read", "users.read", "finance.read", "finance.write", "withdrawals.review", "audit.read"],
  support: ["dashboard.read", "users.read", "users.notes", "tasks.manage", "push.send"],
  risk: ["dashboard.read", "users.read", "users.notes", "users.freeze", "users.limits", "risk.manage", "kyc.review", "withdrawals.review", "audit.read"],
  viewer: ["dashboard.read", "users.read", "finance.read"]
};

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super-admin",
  admin: "Super-admin (ancien accès)",
  finance: "Finance",
  support: "Support",
  risk: "Risque & conformité",
  viewer: "Lecture seule"
};

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === "admin" || role === "super_admin") return true;
  return MAP[role]?.includes(permission) ?? false;
}
