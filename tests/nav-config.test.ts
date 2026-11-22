import { describe, it, expect } from "vitest";
import { NAV, resolveNav } from "@/core/nav-config";

describe("navigation : une URL appartient à une seule entrée", () => {
  it("l'accueil n'a pas d'onglets", () => {
    expect(resolveNav("/dashboard").entry?.key).toBe("today");
    expect(resolveNav("/dashboard").tab).toBeNull();
  });

  it("le href le plus long gagne : /dashboard/wakati/staking est dans Produits, pas dans WAKATI", () => {
    expect(resolveNav("/dashboard/wakati/staking").entry?.key).toBe("products");
    expect(resolveNav("/dashboard/wakati/prix").entry?.key).toBe("wakati");
  });

  it("les pages sans layout propre (Réserve de retrait, Administrateurs) ont bien leurs onglets", () => {
    expect(resolveNav("/dashboard/custody").entry?.key).toBe("money");
    expect(resolveNav("/dashboard/admins").entry?.key).toBe("system");
  });

  it("une sous-page garde l'onglet de sa page parente", () => {
    expect(resolveNav("/dashboard/assets/BTC").tab).toBe("/dashboard/assets");
    expect(resolveNav("/dashboard/users/123").entry?.key).toBe("users");
  });

  it("chaque onglet de la navigation mène à une entrée unique (pas de doublon d'URL)", () => {
    const hrefs = NAV.flatMap((e) => (e.tabs ?? []).map((t) => t.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
