import { describe, it, expect, beforeAll } from "vitest";
import { hasPermission, isSuperAdmin } from "@/core/auth/permissions";
import { hashPassword, verifyPassword, passwordProblem } from "@/core/auth/admin-accounts";
import { createSessionToken, getSessionRole } from "@/core/auth/auth";

beforeAll(() => { process.env.SESSION_SECRET = "secret-de-test"; });

describe("permissions par rôle", () => {
  it("isSuperAdmin : super_admin et ancien admin seulement (la collecte réelle refusait à tort les super_admin)", () => {
    expect(isSuperAdmin("super_admin")).toBe(true);
    expect(isSuperAdmin("admin")).toBe(true);
    expect(isSuperAdmin("finance")).toBe(false);
    expect(isSuperAdmin("viewer")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });
  it("super_admin et l'ancien admin ont tout", () => {
    expect(hasPermission("super_admin", "admins.manage")).toBe(true);
    expect(hasPermission("admin", "users.freeze")).toBe(true);
  });
  it("le support ne peut pas geler ni gérer les admins", () => {
    expect(hasPermission("support", "users.notes")).toBe(true);
    expect(hasPermission("support", "users.freeze")).toBe(false);
    expect(hasPermission("support", "admins.manage")).toBe(false);
  });
  it("le risque peut geler mais pas toucher à la trésorerie", () => {
    expect(hasPermission("risk", "users.freeze")).toBe(true);
    expect(hasPermission("risk", "finance.write")).toBe(false);
  });
  it("la lecture seule ne peut rien écrire", () => {
    for (const p of ["users.freeze", "users.notes", "finance.write", "admins.manage"] as const) expect(hasPermission("viewer", p)).toBe(false);
  });
  it("rôle absent ou inconnu : refusé", () => {
    expect(hasPermission(null, "dashboard.read")).toBe(false);
    expect(hasPermission("inconnu", "dashboard.read")).toBe(false);
  });
});

describe("mots de passe", () => {
  it("hash vérifiable, faux mot de passe refusé", () => {
    const h = hashPassword("Un-Mot-De-Passe-2026");
    expect(verifyPassword("Un-Mot-De-Passe-2026", h)).toBe(true);
    expect(verifyPassword("autre-chose-12345", h)).toBe(false);
    expect(verifyPassword("x", null)).toBe(false);
  });
  it("règles de robustesse", () => {
    expect(passwordProblem("court1")).not.toBeNull();
    expect(passwordProblem("uniquementdeslettres")).not.toBeNull();
    expect(passwordProblem("Assez-Long-Avec-Chiffres-1")).toBeNull();
  });
});

describe("rôles dans le token", () => {
  it("un rôle métier est conservé et non falsifiable", () => {
    const t = createSessionToken("aicha", "support");
    expect(getSessionRole(t)).toBe("support");
    expect(getSessionRole(t.replace(".support.", ".super_admin."))).toBeNull();
  });
});
