import { describe, it, expect } from "vitest";
import { computePlan, DEFAULT_POLICY } from "@/lib/custody-plan";

const stat: any = { withdrawals_count: 30, total_out: 9000, max_single: 900, peak_day_out: 600, avg_day_out: 100, biggest_user_balance: 2500 };
const holding = (over: Record<string, unknown>): any => ({ asset: "USDT", label: "USDT (BSC)", kind: "crypto", owe: 10000, have: 12000, hot: 800, vault: 3000, onUsers: 200, priceUsd: 1, ...over });
const policy = { asset_symbol: "USDT", ...DEFAULT_POLICY };

describe("computePlan : réserve de retrait", () => {
  it("danger quand le portefeuille ne paie pas le plus gros solde", () => {
    const p = computePlan(holding({ hot: 800 }), policy, stat, 0);
    expect(p.state).toBe("danger");
    expect(p.move).toBeCloseTo(p.target - 800, 5);
  });

  it("la cible ne dépasse jamais ce qui est dû", () => {
    const p = computePlan(holding({ owe: 1000 }), policy, stat, 0);
    expect(p.target).toBeLessThanOrEqual(1000);
  });

  it("rien n'est dû : état « nothing »", () => {
    const p = computePlan(holding({ owe: 0, have: 0, hot: 0, vault: 0, onUsers: 0 }), policy, stat, 0);
    expect(p.state).toBe("nothing");
  });

  it("trop plein : état « excess » avec un montant à mettre au coffre", () => {
    const p = computePlan(holding({ hot: 6000, owe: 8000 }), policy, { ...stat, biggest_user_balance: 2000 }, 0);
    expect(p.state).toBe("excess");
    expect(p.move).toBeGreaterThan(0);
  });

  it("la part réservée aux swaps ne compte pas pour les retraits", () => {
    const p = computePlan(holding({ hot: 3000 }), policy, stat, 1000);
    expect(p.withdrawable).toBe(2000);
  });

  it("solde illisible : état « unknown »", () => {
    const p = computePlan(holding({ have: null, hot: null }), policy, stat, 0);
    expect(p.state).toBe("unknown");
  });
});
