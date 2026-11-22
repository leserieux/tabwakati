import { describe, it, expect } from "vitest";
import { computePlan, DEFAULT_POLICY } from "@/lib/custody-plan";
import { computeFunding, actionText, formatDays } from "@/lib/funding-core";

function plan(over: { h?: Record<string, unknown>; stat?: Record<string, unknown>; swap?: number } = {}) {
  const h: any = { asset: "USDT", label: "USDT (BSC)", kind: "crypto", owe: 10000, have: 12000, hot: 800, vault: 3000, onUsers: 200, priceUsd: 1, ...over.h };
  const stat: any = { withdrawals_count: 30, total_out: 9000, max_single: 900, peak_day_out: 600, avg_day_out: 100, biggest_user_balance: 2500, ...over.stat };
  return computePlan(h, { asset_symbol: h.asset, ...DEFAULT_POLICY }, stat, over.swap ?? 0);
}

const TOPS = [2500, 1800, 1500, 900, 700, 500, 300, 200, 100, 50];

describe("computeFunding", () => {
  it("le portefeuille ne paie pas le plus gros solde : urgence « maintenant », action prise dans le coffre", () => {
    const f = computeFunding(plan(), TOPS, 0);
    expect(f.plan.state).toBe("danger");
    expect(f.urgency).toBe("now");
    expect(f.action.kind).toBe("fund");
    expect(f.action.amount).toBeCloseTo(1700, 5);
    expect(f.action.fromVault).toBeCloseTo(1700, 5);
    expect(f.action.external).toBe(0);
  });

  it("l'autonomie se calcule sur le pire jour et sur le rythme moyen", () => {
    const f = computeFunding(plan(), TOPS, 0);
    expect(f.runwayPeak).toBeCloseTo(800 / 600, 5);
    expect(f.runwayAvg).toBeCloseTo(8, 5);
  });

  it("test de stress : le plus gros solde est payable après déplacement, les 5 plus gros non", () => {
    const f = computeFunding(plan(), TOPS, 0);
    const byKey = Object.fromEntries(f.stress.map((c) => [c.key, c]));
    expect(byKey.top1.verdict).toBe("move");
    expect(byKey.top1.need).toBe(2500);
    expect(byKey.top5.verdict).toBe("short");
    expect(byKey.top5.need).toBe(7400);
  });

  it("trop d'argent exposé : action « mettre au coffre », rien à ajouter", () => {
    const f = computeFunding(plan({ h: { hot: 6000, vault: 3000, onUsers: 0, have: 9500, owe: 8000 }, stat: { biggest_user_balance: 2000 } }), [2000, 1000, 800], 0);
    expect(f.urgency).toBe("excess");
    expect(f.action.kind).toBe("vault");
    expect(f.stress.every((c) => c.verdict === "ok")).toBe(true);
  });

  it("rien n'est dû : tout va bien, aucun test de stress", () => {
    const f = computeFunding(plan({ h: { owe: 0, have: 0, hot: 0, vault: 0, onUsers: 0 } }), [], 0);
    expect(f.urgency).toBe("ok");
    expect(f.stress.length).toBe(0);
    expect(f.action.kind).toBe("none");
  });

  it("solde illisible : urgence « illisible », jamais un faux chiffre", () => {
    const f = computeFunding(plan({ h: { have: null, hot: null } }), [100], 0);
    expect(f.urgency).toBe("unknown");
    expect(f.stress[0].verdict).toBe("unknown");
    expect(f.runwayPeak).toBeNull();
  });

  it("moins de 5 utilisateurs : on n'affiche pas deux fois le même cas", () => {
    const f = computeFunding(plan(), [500, 300], 0);
    expect(f.stress.map((c) => c.users)).toEqual([1, 2]);
  });

  it("la phrase d'action cite l'actif et la source de l'argent", () => {
    const text = actionText(computeFunding(plan(), TOPS, 0));
    expect(text).toContain("USDT");
    expect(text).toContain("coffre");
  });
});

describe("formatDays", () => {
  it("moins d'un jour en heures, puis en jours, puis « plus d'un an »", () => {
    expect(formatDays(0.4)).toBe("10 h");
    expect(formatDays(40)).toBe("40 jours");
    expect(formatDays(900)).toBe("plus d'un an");
  });
});
