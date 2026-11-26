import { describe, it, expect, beforeEach } from "vitest";
import { cachedFor, clearCache } from "@/core/cache";

let t = 1_000_000;
const clock = () => t;
beforeEach(() => { clearCache(); t = 1_000_000; });

function counter() {
  let calls = 0;
  return { load: async () => { calls += 1; return { n: calls }; }, get calls() { return calls; } };
}

describe("cache court des rapports", () => {
  it("garde le résultat pendant la durée demandée, puis recalcule", async () => {
    const c = counter();
    const a = await cachedFor("k", 60_000, c.load, { now: clock });
    t += 59_999;
    const b = await cachedFor("k", 60_000, c.load, { now: clock });
    t += 2;
    const d = await cachedFor("k", 60_000, c.load, { now: clock });
    expect([a.cached, b.cached, d.cached]).toEqual([false, true, false]);
    expect([a.value.n, b.value.n, d.value.n]).toEqual([1, 1, 2]);
    expect(c.calls).toBe(2);
  });

  it("renvoie l'heure réelle du calcul, pas l'heure de la demande", async () => {
    const c = counter();
    const first = await cachedFor("k", 60_000, c.load, { now: clock });
    t += 30_000;
    const second = await cachedFor("k", 60_000, c.load, { now: clock });
    expect(first.computedAt).toBe(1_000_000);
    expect(second.computedAt).toBe(1_000_000); // les données ont 30 s, l'écran doit le dire
  });

  it("des clés différentes ne se mélangent pas (par exemple deux périodes)", async () => {
    const c = counter();
    const a = await cachedFor("pnl:7", 60_000, c.load, { now: clock });
    const b = await cachedFor("pnl:30", 60_000, c.load, { now: clock });
    expect(a.value.n).toBe(1);
    expect(b.value.n).toBe(2);
  });

  it("deux demandes simultanées partagent un seul calcul", async () => {
    let calls = 0;
    const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { n: calls }; };
    const [a, b, c] = await Promise.all([cachedFor("k", 60_000, slow, { now: clock }), cachedFor("k", 60_000, slow, { now: clock }), cachedFor("k", 60_000, slow, { now: clock })]);
    expect(calls).toBe(1);
    expect([a.value.n, b.value.n, c.value.n]).toEqual([1, 1, 1]);
  });

  it("un résultat en erreur n'est jamais gardé : on réessaie à la demande suivante", async () => {
    let calls = 0;
    const flaky = async () => { calls += 1; return calls === 1 ? { error: "base injoignable", total: 0 } : { total: 42 }; };
    const a = await cachedFor("k", 60_000, flaky, { now: clock });
    const b = await cachedFor("k", 60_000, flaky, { now: clock });
    expect(a.value).toEqual({ error: "base injoignable", total: 0 });
    expect(b.value).toEqual({ total: 42 });
    expect(b.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("une exception n'est pas gardée, et ne bloque pas les demandes suivantes", async () => {
    let calls = 0;
    const boom = async () => { calls += 1; if (calls === 1) throw new Error("plantage"); return { ok: true }; };
    await expect(cachedFor("k", 60_000, boom, { now: clock })).rejects.toThrow("plantage");
    const again = await cachedFor("k", 60_000, boom, { now: clock });
    expect(again.value).toEqual({ ok: true });
  });

  it("« Actualiser » (clearCache) force un nouveau calcul", async () => {
    const c = counter();
    await cachedFor("k", 60_000, c.load, { now: clock });
    clearCache();
    const after = await cachedFor("k", 60_000, c.load, { now: clock });
    expect(after.cached).toBe(false);
    expect(c.calls).toBe(2);
  });

  it("le cache est borné : les plus anciennes entrées sont évincées", async () => {
    const c = counter();
    for (let i = 0; i < 205; i++) await cachedFor(`k${i}`, 60_000, c.load, { now: clock });
    const oldest = await cachedFor("k0", 60_000, c.load, { now: clock });
    const newest = await cachedFor("k204", 60_000, c.load, { now: clock });
    expect(oldest.cached).toBe(false);
    expect(newest.cached).toBe(true);
  });
});
