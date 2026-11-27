import { describe, it, expect } from "vitest";
import { parseAmount, validateAdjustment, safeReturnPath, MAX_ADJUST_AMOUNT } from "@/modules/operations/balance-adjust";
import { suggestedCredit, isStuck, toReview } from "@/modules/operations/deposit-review";
import { SENSITIVE_ACTIONS } from "@/core/approvals/policy";
import { canAccess } from "@/core/auth/page-access";
import { hasPermission } from "@/core/auth/permissions";

const UID = "ef788185-2d07-45b6-8b18-a582cb030205";
const TX = "2ba5f799-7f98-4ff8-989b-10bb5b3456b5";
const base = { user_id: UID, asset_symbol: "FCFA", direction: "credit", amount: "1000", reason: "Reçu confirmé chez PawaPay" };

describe("parseAmount", () => {
  it("accepte les formats usuels", () => {
    expect(parseAmount("1000")).toBe(1000);
    expect(parseAmount("1 000,5")).toBe(1000.5);
    expect(parseAmount("1\u00a0000.25")).toBe(1000.25);
  });
  it("refuse tout le reste (jamais NaN)", () => {
    for (const v of ["", "abc", "-5", "1e9", "0x10", "1,2,3", null, undefined]) expect(parseAmount(v as string)).toBeNull();
  });
});

describe("validateAdjustment", () => {
  it("accepte un crédit valide", () => {
    const r = validateAdjustment(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ userId: UID, asset: "FCFA", direction: "credit", amount: 1000, depositTxId: null, notify: true });
  });
  it("exige un motif d'au moins 5 caractères", () => {
    expect(validateAdjustment({ ...base, reason: "ok" }).ok).toBe(false);
    expect(validateAdjustment({ ...base, reason: "   " }).ok).toBe(false);
  });
  it("refuse montant nul, négatif, illisible ou démesuré", () => {
    for (const amount of ["0", "-1", "abc", ""]) expect(validateAdjustment({ ...base, amount }).ok, amount).toBe(false);
    expect(validateAdjustment({ ...base, amount: String(MAX_ADJUST_AMOUNT + 1) }).ok).toBe(false);
  });
  it("refuse un utilisateur ou un sens invalide", () => {
    expect(validateAdjustment({ ...base, user_id: "pas-un-uuid" }).ok).toBe(false);
    expect(validateAdjustment({ ...base, direction: "set" }).ok).toBe(false);
    expect(validateAdjustment({ ...base, asset_symbol: "" }).ok).toBe(false);
  });
  it("un dépôt à régulariser ne peut être que crédité", () => {
    expect(validateAdjustment({ ...base, deposit_tx_id: TX }).ok).toBe(true);
    expect(validateAdjustment({ ...base, deposit_tx_id: TX, direction: "debit" }).ok).toBe(false);
    expect(validateAdjustment({ ...base, deposit_tx_id: "xyz" }).ok).toBe(false);
  });
  it("la notification peut être désactivée", () => {
    const r = validateAdjustment({ ...base, notify: "off" });
    expect(r.ok && r.value.notify).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("n'accepte que les pages prévues", () => {
    expect(safeReturnPath("/dashboard/deposits")).toBe("/dashboard/deposits");
    expect(safeReturnPath(`/dashboard/users/${UID}`)).toBe(`/dashboard/users/${UID}`);
    for (const bad of ["https://evil.example", "//evil.example", "/dashboard/users/x", "/dashboard/settings", "", null]) {
      expect(safeReturnPath(bad as string)).toBe("/dashboard/deposits");
    }
  });
});

describe("dépôts à vérifier", () => {
  it("crédit proposé = montant − frais, jamais négatif", () => {
    expect(suggestedCredit(1000, 0)).toBe(1000);
    expect(suggestedCredit("1000", "25")).toBe(975);
    expect(suggestedCredit(10, 50)).toBe(0);
    expect(suggestedCredit("x", null)).toBe(0);
  });
  it("seul un dépôt en attente depuis plus d'une heure est « bloqué »", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    expect(isStuck("pending", "2026-11-28T10:00:00Z", now)).toBe(true);
    expect(isStuck("pending", "2026-11-28T11:30:00Z", now)).toBe(false);
    expect(isStuck("failed", "2026-11-01T10:00:00Z", now)).toBe(false);
  });
  it("lit les détails fournisseur dans metadata", () => {
    const r = toReview({ id: TX, user_id: UID, asset_symbol: "FCFA", amount: "500", fee: "0", status: "failed", created_at: "2026-11-15T16:03:09Z",
      metadata: { provider: "pawapay", phone: "237656780180", failure_reason: "timeout", provider_reference: "abc", external_reference: "DEP-1" } }, "alice");
    expect(r).toMatchObject({ userLabel: "alice", suggested: 500, provider: "pawapay", phone: "237656780180", reason: "timeout", providerRef: "abc", stuck: false });
  });
});

describe("droits", () => {
  it("l'action est sensible (motif + double validation possible)", () => {
    expect(Object.keys(SENSITIVE_ACTIONS)).toContain("balance.adjust");
  });
  it("seuls finance et super-admin peuvent écrire ; la page est lisible par finance et lecture seule", () => {
    expect(hasPermission("finance", "finance.write")).toBe(true);
    expect(hasPermission("super_admin", "finance.write")).toBe(true);
    for (const r of ["support", "risk", "viewer"]) expect(hasPermission(r, "finance.write"), r).toBe(false);
    expect(canAccess("finance", "/dashboard/deposits")).toBe(true);
    expect(canAccess("support", "/dashboard/deposits")).toBe(false);
  });
});
