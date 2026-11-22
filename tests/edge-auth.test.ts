import { describe, it, expect, beforeAll } from "vitest";
import { createSessionToken } from "@/core/auth/auth";
import { verifySessionEdge } from "@/core/auth/edge";
import { parseToken } from "@/core/auth/token";

const SECRET = "secret-de-test";

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("middleware Edge : vérification complète du jeton", () => {
  it("un jeton émis par le serveur Node est accepté par la vérification Edge (même format, même signature)", async () => {
    expect(await verifySessionEdge(createSessionToken("Aïcha", "viewer"), SECRET)).toBe(true);
    expect(await verifySessionEdge(createSessionToken("Moussa"), SECRET)).toBe(true);
  });

  it("un faux cookie qui a la bonne forme mais pas la bonne signature est refusé (l'ancien middleware le laissait passer)", async () => {
    const fake = `${Date.now() + 3_600_000}.${Buffer.from("pirate").toString("base64url")}.admin.${"0".repeat(64)}`;
    expect(await verifySessionEdge(fake, SECRET)).toBe(false);
  });

  it("changer le rôle dans le jeton invalide la signature", async () => {
    const t = createSessionToken("Aïcha", "viewer");
    expect(await verifySessionEdge(t.replace(".viewer.", ".admin."), SECRET)).toBe(false);
  });

  it("un jeton expiré est refusé", async () => {
    const t = createSessionToken("Aïcha", "viewer");
    const expiresAt = Number(t.split(".")[0]);
    expect(await verifySessionEdge(t, SECRET, expiresAt + 1)).toBe(false);
    expect(await verifySessionEdge(t, SECRET, expiresAt - 1)).toBe(true);
  });

  it("sans secret, tout est refusé (jamais d'accès par défaut)", async () => {
    expect(await verifySessionEdge(createSessionToken("Aïcha"), undefined)).toBe(false);
    expect(await verifySessionEdge(createSessionToken("Aïcha"), "")).toBe(false);
  });

  it("jeton vide, absent ou mal formé : refusé", async () => {
    expect(await verifySessionEdge(undefined, SECRET)).toBe(false);
    expect(await verifySessionEdge("", SECRET)).toBe(false);
    expect(await verifySessionEdge("abc", SECRET)).toBe(false);
    expect(await verifySessionEdge("1.2.3.4.5", SECRET)).toBe(false);
  });

  it("un autre secret ne valide pas le jeton", async () => {
    expect(await verifySessionEdge(createSessionToken("Aïcha"), "un-autre-secret")).toBe(false);
  });
});

describe("parseToken : forme du jeton", () => {
  it("rôle inconnu ou date illisible : refusé", () => {
    expect(parseToken("123.abc.inconnu.sig")).toBeNull();
    expect(parseToken("pas-un-nombre.abc.admin.sig")).toBeNull();
  });
  it("ancien format sans rôle : lu comme admin", () => {
    expect(parseToken("123.abc.sig")?.role).toBe("admin");
  });
});
