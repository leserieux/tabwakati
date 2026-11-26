import { describe, it, expect, afterEach } from "vitest";
import { fetchAll, callsiteOf, setDataAlertReporter, type DataAlert } from "@/core/db/data";

type Page = (from: number, to: number) => Promise<{ data: { id: number }[] | null; error: { message: string } | null }>;
/** Une table fictive de `total` lignes, lue 1000 par 1000 comme PostgREST. */
const table = (total: number): Page => async (from, to) => ({
  data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({ id: from + i })), error: null
});
const forever: Page = async (from, to) => ({ data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null });

const alerts: DataAlert[] = [];
const capture = async (a: DataAlert) => { alerts.push(a); };
afterEach(() => { alerts.length = 0; setDataAlertReporter(null); });

describe("lecture complète d'une table (fetchAll)", () => {
  it("une petite lecture ne signale rien", async () => {
    setDataAlertReporter(capture);
    const r = await fetchAll(table(2500), 200_000, { site: "modules/x.ts" });
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBeUndefined();
    expect(alerts).toEqual([]);
  });

  it("une lecture volumineuse (au-delà du seuil) crée une alerte « moyenne » qui nomme la page", async () => {
    setDataAlertReporter(capture);
    const r = await fetchAll(table(3500), 200_000, { warnRows: 2000, site: "modules/users/user-profit.ts" });
    expect(r.rows).toHaveLength(3500);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("medium");
    expect(alerts[0].key).toBe("large_modules/users/user-profit.ts");
    expect(alerts[0].title).toContain("modules/users/user-profit.ts");
  });

  it("une lecture tronquée crée une alerte « élevée » et renvoie truncated, avec exactement maxRows lignes", async () => {
    setDataAlertReporter(capture);
    const r = await fetchAll(forever, 3000, { site: "modules/metrics/analytics.ts" });
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(3000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "high", key: "truncated_modules/metrics/analytics.ts" });
    expect(alerts[0].title).toContain("partiels");
  });

  it("une table qui fait pile un multiple de 1000 n'est pas prise pour une table tronquée", async () => {
    setDataAlertReporter(capture);
    const r = await fetchAll(table(3000), 200_000, { site: "modules/x.ts" });
    expect(r.rows).toHaveLength(3000);
    expect(r.truncated).toBeUndefined();
    expect(alerts).toEqual([]);
  });

  it("une erreur de lecture est renvoyée telle quelle, sans fausse alerte de volume", async () => {
    setDataAlertReporter(capture);
    const failing: Page = async (from) => (from === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null } : { data: null, error: { message: "timeout" } });
    const r = await fetchAll(failing, 200_000, { warnRows: 500, site: "modules/x.ts" });
    expect(r.error).toBe("timeout");
    expect(r.rows).toHaveLength(1000);
    expect(alerts).toEqual([]);
  });

  it("un signalement qui échoue ne casse jamais la lecture", async () => {
    setDataAlertReporter(async () => { throw new Error("base injoignable"); });
    const r = await fetchAll(forever, 2000, { site: "modules/x.ts" });
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(2000);
  });
});

describe("page concernée d'après la pile d'appels", () => {
  it("retrouve le fichier appelant, hors data.ts", () => {
    const stack = [
      "Error",
      "    at fetchAll (webpack-internal:///(rsc)/./src/core/db/data.ts:31:22)",
      "    at loadAnalytics (webpack-internal:///(rsc)/./src/modules/metrics/analytics.ts:19:12)",
      "    at AnalyticsPage (webpack-internal:///(rsc)/./src/app/dashboard/analytics/page.tsx:20:5)"
    ].join("\n");
    expect(callsiteOf(stack)).toBe("modules/metrics/analytics.ts");
  });
  it("gère les chemins de pages dynamiques et renvoie « inconnu » sans pile", () => {
    expect(callsiteOf("    at X (/var/task/src/app/dashboard/users/[id]/page.tsx:10:1)")).toBe("app/dashboard/users/[id]/page.tsx");
    expect(callsiteOf(undefined)).toBe("inconnu");
    expect(callsiteOf("Error\n    at node:internal/process:1:1")).toBe("inconnu");
  });
});
