import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createSessionToken, getSessionRole, getSessionSid, getSessionActor } from "@/core/auth/auth";
import { verifySessionEdgeParsed } from "@/core/auth/edge";
import { parseToken } from "@/core/auth/token";
import { isSessionActiveEdge, clearSessionCache } from "@/core/auth/session-check-edge";
import { clientIp, isIpAllowed, isLoginBlocked, parseAllowlist, LOGIN_MAX_FAILURES_PER_IP } from "@/core/auth/access";

const SECRET = "secret-de-test";
const SID = "0b9f6c1e-2d4a-4f3b-9c7e-1a2b3c4d5e6f";

beforeAll(() => { process.env.SESSION_SECRET = SECRET; });

describe("jeton révocable (avec identifiant de session)", () => {
  it("le jeton porte l'identifiant de session, le rôle et le nom", () => {
    const t = createSessionToken("aicha", "support", SID);
    expect(getSessionSid(t)).toBe(SID);
    expect(getSessionRole(t)).toBe("support");
    expect(getSessionActor(t)).toBe("aicha");
  });

  it("changer l'identifiant de session ou le rôle invalide la signature", async () => {
    const t = createSessionToken("aicha", "support", SID);
    expect(getSessionRole(t.replace(SID, "11111111-2222-4333-8444-555555555555"))).toBeNull();
    expect(getSessionRole(t.replace(".support.", ".super_admin."))).toBeNull();
    expect(await verifySessionEdgeParsed(t.replace(".support.", ".super_admin."), SECRET)).toBeNull();
  });

  it("les jetons sans identifiant (anciens formats) restent valides mais non révocables", () => {
    const legacy = createSessionToken("aicha", "viewer");
    expect(getSessionRole(legacy)).toBe("viewer");
    expect(getSessionSid(legacy)).toBeNull();
  });

  it("un identifiant de session mal formé rend le jeton illisible", () => {
    expect(parseToken(`${Date.now() + 1000}.${Buffer.from("x").toString("base64url")}.admin.pas-un-uuid.${"0".repeat(64)}`)).toBeNull();
  });

  it("la vérification Edge renvoie le rôle et l'identifiant de session", async () => {
    const s = await verifySessionEdgeParsed(createSessionToken("aicha", "risk", SID), SECRET);
    expect(s?.role).toBe("risk");
    expect(s?.sid).toBe(SID);
  });
});

describe("révocation côté Edge", () => {
  beforeEach(() => clearSessionCache());
  const future = new Date(Date.now() + 3600_000).toISOString();
  const ok = (rows: unknown) => async () => ({ ok: true, json: async () => rows });

  it("session active : acceptée", async () => {
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), ok([{ revoked_at: null, expires_at: future }]))).toBe(true);
  });
  it("session révoquée : refusée", async () => {
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), ok([{ revoked_at: new Date().toISOString(), expires_at: future }]))).toBe(false);
  });
  it("session absente de la base : refusée", async () => {
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), ok([]))).toBe(false);
  });
  it("session expirée en base : refusée", async () => {
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), ok([{ revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString() }]))).toBe(false);
  });
  it("le résultat est gardé 30 s : la base n'est pas interrogée à chaque page, puis revérifiée", async () => {
    let calls = 0;
    const counting = async () => { calls++; return { ok: true, json: async () => [{ revoked_at: null, expires_at: future }] }; };
    const t0 = Date.now();
    await isSessionActiveEdge(SID, "https://x.supabase.co", "k", t0, counting);
    await isSessionActiveEdge(SID, "https://x.supabase.co", "k", t0 + 10_000, counting);
    expect(calls).toBe(1);
    await isSessionActiveEdge(SID, "https://x.supabase.co", "k", t0 + 31_000, counting);
    expect(calls).toBe(2);
  });
  it("base injoignable : on laisse passer (la signature est valide) sans mettre l'erreur en cache", async () => {
    const boom = async () => { throw new Error("réseau"); };
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), boom as never)).toBe(true);
    expect(await isSessionActiveEdge(SID, "https://x.supabase.co", "k", Date.now(), ok([]))).toBe(false); // pas de faux « actif » gardé
  });
});

describe("adresse IP : liste autorisée et limitation des connexions", () => {
  it("clientIp lit la première adresse de x-forwarded-for, sinon x-real-ip", () => {
    const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(h({}))).toBeUndefined();
  });

  it("sans liste, pas de restriction ; avec une liste, IP exacte ou plage IPv4", () => {
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist(undefined)).toBeNull();
    const list = parseAllowlist("203.0.113.7, 198.51.100.0/24")!;
    expect(isIpAllowed("203.0.113.7", list)).toBe(true);
    expect(isIpAllowed("198.51.100.200", list)).toBe(true);
    expect(isIpAllowed("198.51.101.1", list)).toBe(false);
    expect(isIpAllowed("8.8.8.8", list)).toBe(false);
  });

  it("une IP inconnue est refusée quand une liste existe (fail-closed)", () => {
    expect(isIpAllowed(undefined, ["203.0.113.7"])).toBe(false);
  });

  it("limitation des connexions : bloqué à partir du seuil", () => {
    expect(isLoginBlocked(LOGIN_MAX_FAILURES_PER_IP - 1)).toBe(false);
    expect(isLoginBlocked(LOGIN_MAX_FAILURES_PER_IP)).toBe(true);
  });
});
