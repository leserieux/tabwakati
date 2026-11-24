import { describe, it, expect } from "vitest";
import { summarizeRefusals, refusalKind, type RefusalRow } from "@/modules/treasury/refusals-core";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const row = (over: Partial<RefusalRow>): RefusalRow => ({
  id: 1, asset_symbol: "BTC", user_id: "u1", from_asset: "FCFA", from_amount: 1000, requested_amount: 0.00002779,
  reserve_amount: 0, shortfall_amount: 0.00002779, requested_usd: 1.64, shortfall_usd: 1.64, created_at: "2026-11-20T18:05:58Z", ...over
});

describe("refusalKind", () => {
  it("distingue vente de WAKATI, achat de WAKATI et swap", () => {
    expect(refusalKind({ asset_symbol: "FCFA", from_asset: "WAKATI" })).toBe("wakati_sale");
    expect(refusalKind({ asset_symbol: "WAKATI", from_asset: "FCFA" })).toBe("wakati_purchase");
    expect(refusalKind({ asset_symbol: "BTC", from_asset: "FCFA" })).toBe("swap");
  });
});

describe("summarizeRefusals", () => {
  it("regroupe par actif en manque et compte les utilisateurs distincts", () => {
    const r = summarizeRefusals([
      row({ id: 1, created_at: "2026-11-20T18:00:00Z" }),
      row({ id: 2, created_at: "2026-11-22T10:00:00Z", user_id: "u2", shortfall_usd: 3 }),
      row({ id: 3, created_at: "2026-11-22T11:00:00Z", user_id: "u2", asset_symbol: "FCFA", from_asset: "WAKATI" })
    ], [], NOW);
    const btc = r.byAsset.find((a) => a.asset === "BTC")!;
    expect(btc.count).toBe(2);
    expect(btc.users).toBe(2);
    expect(btc.shortfallUsd).toBe(3); // le plus gros manque, pas la somme
    expect(btc.requestedUsd).toBeCloseTo(3.28);
    expect(r.last7d).toBe(3);
    expect(r.last24h).toBe(0);
  });

  it("met les actifs encore bloqués en premier, même sans refus récent", () => {
    const r = summarizeRefusals(
      [row({ id: 1, asset_symbol: "BTC", created_at: "2026-11-23T10:00:00Z" })],
      [{ asset_symbol: "MATIC", liquidity_shortage_since: "2026-11-01T00:00:00Z" }],
      NOW
    );
    expect(r.byAsset[0].asset).toBe("MATIC");
    expect(r.byAsset[0].active).toBe(true);
    expect(r.byAsset[0].count).toBe(0);
    expect(r.byAsset[1].active).toBe(false);
    expect(r.active).toEqual(["MATIC"]);
  });

  it("ignore les refus hors fenêtre et gère les valeurs vides", () => {
    const r = summarizeRefusals([
      row({ id: 1, created_at: "2026-09-01T00:00:00Z" }),
      row({ id: 2, requested_usd: null, shortfall_usd: null, created_at: "2026-11-24T09:00:00Z" })
    ], [], NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.last24h).toBe(1);
    expect(r.usd7d).toBe(0);
  });
});
