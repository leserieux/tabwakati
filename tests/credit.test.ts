import { describe, it, expect } from "vitest";
import { guaranteedFlags, marginTone, type LoanRisk } from "@/modules/products/credit";

function loan(over: Partial<LoanRisk>): LoanRisk {
  return {
    loan_id: "l1", user_id: "u1", collateral_asset: "WAKATI", collateral_amount: 100, borrow_asset: "USDT",
    principal_amount: 50, accrued_interest: 0, total_debt: 50, debt_value_usd: 50, collateral_value_usd: 100,
    current_ltv_pct: 50, liquidation_ltv_snapshot: 80, marge_avant_liquidation_pct: 30, apr_rate_snapshot: 10,
    opened_at: "2026-11-01T00:00:00Z", collateral_source: "stake", duration_days: 30, due_at: null, grace_until: null,
    extensions_used: 0, risk_state: "en_cours", ...over
  };
}

describe("crédit : prêts à surveiller", () => {
  it("un prêt sain n'a aucun drapeau", () => {
    expect(guaranteedFlags(loan({})).length).toBe(0);
  });

  it("grâce expirée : saisie imminente, gravité maximale", () => {
    const f = guaranteedFlags(loan({ risk_state: "grace_expiree" }));
    expect(f.length).toBe(1);
    expect(f[0].tone).toBe("bad");
    expect(f[0].sev).toBe(100);
  });

  it("marge LTV sous 10 points : drapeau, d'autant plus grave que la marge est faible", () => {
    const low = guaranteedFlags(loan({ marge_avant_liquidation_pct: 2 }));
    const mid = guaranteedFlags(loan({ marge_avant_liquidation_pct: 8 }));
    expect(low[0].sev).toBeGreaterThan(mid[0].sev);
    expect(low[0].tone).toBe("bad");
  });

  it("marge exactement à 10 points : pas encore de drapeau", () => {
    expect(guaranteedFlags(loan({ marge_avant_liquidation_pct: 10 })).length).toBe(0);
  });

  it("marge inconnue (null) : pas de faux drapeau", () => {
    expect(guaranteedFlags(loan({ marge_avant_liquidation_pct: null })).length).toBe(0);
    expect(marginTone(null)).toBe("info");
  });

  it("grâce expirée ET marge faible : deux drapeaux cumulés", () => {
    expect(guaranteedFlags(loan({ risk_state: "grace_expiree", marge_avant_liquidation_pct: 3 })).length).toBe(2);
  });
});
