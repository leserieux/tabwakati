import { describe, it, expect } from "vitest";
import { redirect } from "next/navigation";
import {
  SENSITIVE_ACTIONS, isSensitiveType, reasonProblem, dualControlEnabled, formToPayload, payloadToFormData, redirectTarget, MAX_REASON
} from "@/core/approvals/policy";
import { executeApproved, type Handlers } from "@/core/approvals/executor";
import { evaluateGate } from "@/core/approvals/gate";
import { canAccess } from "@/core/auth/page-access";

describe("motif obligatoire", () => {
  it("refuse un motif vide, trop court ou trop long", () => {
    expect(reasonProblem("")).not.toBeNull();
    expect(reasonProblem(undefined)).not.toBeNull();
    expect(reasonProblem("   ab  ")).not.toBeNull();
    expect(reasonProblem("x".repeat(MAX_REASON + 1))).not.toBeNull();
  });
  it("accepte un motif clair", () => {
    expect(reasonProblem("Panne du flux de prix, fermeture d'urgence")).toBeNull();
    expect(reasonProblem("  cinq5  ")).toBeNull();
  });
});

describe("interrupteur de la double validation", () => {
  it("active seulement avec ADMIN_DUAL_CONTROL=on (tout le reste = inactive)", () => {
    expect(dualControlEnabled({ ADMIN_DUAL_CONTROL: "on" })).toBe(true);
    for (const v of [undefined, "", "off", "true", "1", "ON"]) expect(dualControlEnabled({ ADMIN_DUAL_CONTROL: v })).toBe(false);
  });
});

describe("conversion formulaire ⇄ demande", () => {
  it("garde les valeurs métier, écarte le motif, les champs techniques Next et les fichiers", () => {
    const fd = new FormData();
    fd.append("open_fee_pct", "0.05");
    fd.append("is_active", "on");
    fd.append("reason", "test motif");
    fd.append("$ACTION_ID_abc123", "");
    fd.append("$ACTION_REF_1", "");
    fd.append("fichier", new Blob(["x"]), "x.txt");
    expect(formToPayload(fd)).toEqual({ open_fee_pct: "0.05", is_active: "on" });
  });
  it("le rejeu reconstruit le même formulaire", () => {
    const fd = payloadToFormData({ a: "1", b: "deux", c: 3 as unknown as string });
    expect(fd.get("a")).toBe("1");
    expect(fd.get("b")).toBe("deux");
    expect(fd.get("c")).toBeNull(); // seules les chaînes sont rejouées
  });
  it("reconnaît le type d'action sensible et rien d'autre", () => {
    for (const t of Object.keys(SENSITIVE_ACTIONS)) expect(isSensitiveType(t)).toBe(true);
    for (const t of ["constructor", "toString", "futures.close", ""]) expect(isSensitiveType(t)).toBe(false);
  });
});

function nextRedirectError(url: string): Error {
  try { redirect(url); } catch (e) { return e as Error; }
  throw new Error("redirect n'a pas levé d'erreur");
}

describe("lecture d'une redirection Next", () => {
  it("extrait la destination d'un vrai redirect()", () => {
    expect(redirectTarget(nextRedirectError("/dashboard/futures?saved=ok"))).toBe("/dashboard/futures?saved=ok");
  });
  it("ignore les autres erreurs", () => {
    expect(redirectTarget(new Error("boom"))).toBeNull();
    expect(redirectTarget(null)).toBeNull();
    expect(redirectTarget({ digest: 42 })).toBeNull();
  });
});

const approved = { id: "0b9f6c1e-2d4a-4f3b-9c7e-1a2b3c4d5e6f", reason: "Validée par Bob", payload: { confirm: "FERMER" } };
const noop = async () => {};
const handlers = (over: Partial<Handlers>): Handlers => ({
  "futures.force_close_all": noop, "futures.config": noop, "wakati.burn_now": noop,
  "wakati.burn_settings": noop, "wakati.reserve_settings": noop, "sweep.real": noop, ...over
});

describe("exécution d'une demande validée", () => {
  it("succès : l'action se termine par une redirection « saved »", async () => {
    const r = await executeApproved({ ...approved, action_type: "futures.force_close_all" }, handlers({
      "futures.force_close_all": async () => { redirect("/dashboard/futures?saved=3%20position(s)%20ferm%C3%A9e(s)"); }
    }));
    expect(r).toEqual({ ok: true, message: "3 position(s) fermée(s)" });
  });

  it("échec métier : la redirection « error » est reconnue comme un échec", async () => {
    const r = await executeApproved({ ...approved, action_type: "wakati.burn_now" }, handlers({
      "wakati.burn_now": async () => { redirect("/dashboard/wakati/burns?error=1&msg=Prix%20p%C3%A9rim%C3%A9"); }
    }));
    expect(r).toEqual({ ok: false, message: "Prix périmé" });
  });

  it("une erreur inattendue est un échec, avec son message", async () => {
    const r = await executeApproved({ ...approved, action_type: "futures.config" }, handlers({ "futures.config": async () => { throw new Error("base injoignable"); } }));
    expect(r).toEqual({ ok: false, message: "base injoignable" });
  });

  it("un type inconnu n'exécute rien", async () => {
    let called = false;
    const r = await executeApproved({ ...approved, action_type: "danger.tout_effacer" }, handlers({ "sweep.real": async () => { called = true; } }));
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("les valeurs enregistrées (et non celles d'un navigateur) sont celles rejouées", async () => {
    let seen: Record<string, string> = {};
    await executeApproved({ ...approved, action_type: "wakati.burn_settings", payload: { burn_share_pct: "30", enabled: "on" } }, handlers({
      "wakati.burn_settings": async (fd) => { seen = Object.fromEntries([...fd.entries()] as [string, string][]); }
    }));
    expect(seen).toEqual({ burn_share_pct: "30", enabled: "on" });
  });
});

describe("barrière : le rejeu ne peut pas être falsifié", () => {
  it("pendant le rejeu, la barrière laisse passer avec le motif de la demande (sans toucher à la base)", async () => {
    let outcome: Awaited<ReturnType<typeof evaluateGate>> | null = null;
    await executeApproved({ ...approved, action_type: "wakati.burn_now" }, handlers({
      "wakati.burn_now": async () => { outcome = await evaluateGate({ type: "wakati.burn_now", reason: "", payload: {} }); }
    }));
    expect(outcome).toEqual({ kind: "proceed", reason: "Validée par Bob", approvalId: approved.id });
  });

  it("hors rejeu, sans motif : refusé", async () => {
    expect((await evaluateGate({ type: "futures.force_close_all", reason: "", payload: {} })).kind).toBe("reason_missing");
  });

  it("hors rejeu, un faux identifiant d'approbation dans le formulaire ne change rien", async () => {
    const forged = await evaluateGate({ type: "futures.config", reason: "", payload: { __approval_id: approved.id, approval_id: approved.id } });
    expect(forged.kind).toBe("reason_missing");
  });

  it("le contexte de rejeu ne fuit pas après l'exécution", async () => {
    await executeApproved({ ...approved, action_type: "wakati.burn_now" }, handlers({}));
    expect((await evaluateGate({ type: "wakati.burn_now", reason: "", payload: {} })).kind).toBe("reason_missing");
  });
});

describe("accès à la page Validations", () => {
  it("réservée aux super-admins", () => {
    for (const r of ["super_admin", "admin"]) expect(canAccess(r, "/dashboard/approvals")).toBe(true);
    for (const r of ["finance", "risk", "support", "viewer"]) expect(canAccess(r, "/dashboard/approvals")).toBe(false);
  });
});
