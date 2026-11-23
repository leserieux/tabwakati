import { describe, it, expect } from "vitest";
import { NAV } from "@/core/nav-config";
import { filterNav } from "@/core/nav-config";
import { canAccess, hasExplicitRule, requiredPermission, DEFAULT_PERMISSION } from "@/core/auth/page-access";

const ALL_ROLES = ["super_admin", "admin", "finance", "support", "risk", "viewer"];
const allHrefs = [...NAV.map((e) => e.href), ...NAV.flatMap((e) => (e.tabs ?? []).map((t) => t.href))];

describe("matrice page × permission", () => {
  it("chaque page du menu a une règle explicite (aucune ne tombe sur le refus par défaut)", () => {
    const missing = allHrefs.filter((h) => !hasExplicitRule(h));
    expect(missing).toEqual([]);
  });

  it("un compte support ne peut ni voir la trésorerie, ni les revenus, ni les produits", () => {
    for (const p of ["/dashboard/assets", "/dashboard/treasury", "/dashboard/custody", "/dashboard/sweep", "/dashboard/pnl", "/dashboard/fees", "/dashboard/futures", "/dashboard/wakati/burns", "/dashboard/controls"]) {
      expect(canAccess("support", p), p).toBe(false);
    }
  });

  it("un compte support garde ce qui sert à aider : utilisateurs, transactions, tâches, notifications", () => {
    for (const p of ["/dashboard", "/dashboard/users", "/dashboard/users/abc", "/dashboard/transactions", "/dashboard/tasks", "/dashboard/notifications"]) {
      expect(canAccess("support", p), p).toBe(true);
    }
  });

  it("un compte support ne peut pas exporter, ni voir le journal d'audit, les administrateurs ou les paramètres", () => {
    for (const p of ["/api/transactions/export", "/api/custody/export", "/api/users/abc/transactions/export", "/dashboard/audit", "/dashboard/admins", "/dashboard/settings"]) {
      expect(canAccess("support", p), p).toBe(false);
    }
  });

  it("la lecture seule voit les chiffres mais ni l'audit, ni les administrateurs, ni les paramètres, ni les exports", () => {
    expect(canAccess("viewer", "/dashboard/treasury")).toBe(true);
    expect(canAccess("viewer", "/dashboard/users")).toBe(true);
    for (const p of ["/dashboard/audit", "/dashboard/admins", "/dashboard/settings", "/api/transactions/export"]) expect(canAccess("viewer", p), p).toBe(false);
  });

  it("finance : trésorerie et exports oui, administrateurs et paramètres non ; risque : l'inverse côté trésorerie", () => {
    expect(canAccess("finance", "/dashboard/custody")).toBe(true);
    expect(canAccess("finance", "/api/custody/export")).toBe(true);
    expect(canAccess("finance", "/dashboard/admins")).toBe(false);
    expect(canAccess("finance", "/dashboard/settings")).toBe(false);
    expect(canAccess("risk", "/dashboard/treasury")).toBe(false);
    expect(canAccess("risk", "/dashboard/audit")).toBe(true);
  });

  it("le super-admin et l'ancien accès partagé ont accès à tout, y compris à une URL sans règle", () => {
    for (const p of [...allHrefs, "/dashboard/page-inconnue"]) {
      expect(canAccess("super_admin", p)).toBe(true);
      expect(canAccess("admin", p)).toBe(true);
    }
  });

  it("une URL sans règle est refusée à tous les autres rôles (refus par défaut)", () => {
    expect(requiredPermission("/dashboard/page-inconnue")).toBe(DEFAULT_PERMISSION);
    for (const r of ["finance", "support", "risk", "viewer"]) expect(canAccess(r, "/dashboard/page-inconnue")).toBe(false);
  });

  it("le préfixe le plus long gagne : /dashboard/pnl/utilisateurs (utilisateurs) contre /dashboard/pnl (finance)", () => {
    expect(requiredPermission("/dashboard/pnl")).toBe("finance.read");
    expect(requiredPermission("/dashboard/pnl/utilisateurs")).toBe("users.read");
    expect(requiredPermission("/dashboard/pnl/roue")).toBe("finance.read");
  });

  it("les astuces d'URL ne contournent pas la règle (encodage, majuscules, doubles barres, barre finale)", () => {
    expect(requiredPermission("/dashboard/%61dmins")).toBe("admins.manage");
    expect(requiredPermission("/DASHBOARD/Admins")).toBe("admins.manage");
    expect(requiredPermission("/dashboard//admins/")).toBe("admins.manage");
    expect(requiredPermission("/dashboard/admins/../treasury")).toBe(DEFAULT_PERMISSION); // chemin non normalisé : refusé par défaut
    expect(requiredPermission("/dashboard/%E0%A4%A")).toBe(DEFAULT_PERMISSION); // encodage invalide
  });

  it("un préfixe n'attrape pas un autre mot (/dashboard/usersx n'est pas /dashboard/users)", () => {
    expect(requiredPermission("/dashboard/usersx")).toBe(DEFAULT_PERMISSION);
  });
});

describe("menu filtré par rôle", () => {
  it("le support ne voit aucune entrée d'argent, et chaque entrée pointe vers un onglet qu'il peut ouvrir", () => {
    const keys = filterNav("support").map((e) => e.key);
    expect(keys).not.toContain("money");
    expect(keys).not.toContain("revenue");
    expect(keys).not.toContain("products");
    expect(keys).not.toContain("wakati");
    for (const e of filterNav("support")) expect(canAccess("support", e.href), e.href).toBe(true);
  });

  it("le super-admin voit tout le menu", () => {
    expect(filterNav("super_admin").map((e) => e.key)).toEqual(NAV.map((e) => e.key));
  });

  it("aucun rôle ne voit un onglet qu'il ne peut pas ouvrir", () => {
    for (const role of ALL_ROLES) {
      for (const e of filterNav(role)) for (const t of e.tabs ?? []) expect(canAccess(role, t.href), `${role} ${t.href}`).toBe(true);
    }
  });
});
