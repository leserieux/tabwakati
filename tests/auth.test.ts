import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";
import { createSessionToken, getSessionRole, getSessionActor, verifySessionToken, identifyRole } from "@/core/auth/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "secret-de-test";
  process.env.ADMIN_PASSWORD = "mdp-admin";
  process.env.ADMIN_VIEWER_PASSWORD = "mdp-lecture";
});

describe("sessions et rôles", () => {
  it("un token porte le nom et le rôle choisis", () => {
    const t = createSessionToken("Aïcha", "viewer");
    expect(verifySessionToken(t)).toBe(true);
    expect(getSessionRole(t)).toBe("viewer");
    expect(getSessionActor(t)).toBe("Aïcha");
  });

  it("sans rôle précisé, la session est admin", () => {
    expect(getSessionRole(createSessionToken("Moussa"))).toBe("admin");
  });

  it("changer le rôle dans le token invalide la signature", () => {
    const t = createSessionToken("Aïcha", "viewer");
    const forged = t.replace(".viewer.", ".admin.");
    expect(forged).not.toBe(t);
    expect(getSessionRole(forged)).toBeNull();
    expect(verifySessionToken(forged)).toBe(false);
  });

  it("un token inventé ou vide est refusé", () => {
    expect(getSessionRole("n-importe-quoi")).toBeNull();
    expect(getSessionRole(undefined)).toBeNull();
    expect(getSessionRole(`${Date.now() + 100000}.YWJj.admin.0000`)).toBeNull();
  });

  it("les anciens tokens (sans rôle) restent valides et sont admin", () => {
    const payload = `${Date.now() + 3600_000}.${Buffer.from("Moussa").toString("base64url")}`;
    const sig = createHmac("sha256", "secret-de-test").update(payload).digest("hex");
    expect(getSessionRole(`${payload}.${sig}`)).toBe("admin");
  });

  it("un rôle inconnu est refusé même correctement signé", () => {
    const payload = `${Date.now() + 3600_000}.${Buffer.from("Moussa").toString("base64url")}.superadmin`;
    const sig = createHmac("sha256", "secret-de-test").update(payload).digest("hex");
    expect(getSessionRole(`${payload}.${sig}`)).toBeNull();
  });
});

describe("identifyRole : le mot de passe détermine le rôle", () => {
  it("mot de passe admin, lecture seule, ou faux", () => {
    expect(identifyRole("mdp-admin")).toBe("admin");
    expect(identifyRole("mdp-lecture")).toBe("viewer");
    expect(identifyRole("faux")).toBeNull();
  });

  it("deux mots de passe identiques : c'est le rôle le moins puissant qui s'applique", () => {
    process.env.ADMIN_VIEWER_PASSWORD = "mdp-admin";
    expect(identifyRole("mdp-admin")).toBe("viewer");
    process.env.ADMIN_VIEWER_PASSWORD = "mdp-lecture";
  });
});
