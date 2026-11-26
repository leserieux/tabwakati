import { expect } from "vitest";

/** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes données à chaque exécution. */
export function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Transforme un rapport en objet comparable (Map → objet) */
export const plain = (r: unknown): unknown => JSON.parse(JSON.stringify(r, (_k, v) => (v instanceof Map ? Object.fromEntries([...v.entries()].sort()) : v)));
export function expectClose(actual: unknown, expected: unknown, path = "rapport"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const got = actual as number;
    const tol = 1e-9 * Math.max(1, Math.abs(expected));
    expect(Math.abs(got - expected), `${path}: ${got} ≠ ${expected}`).toBeLessThanOrEqual(tol);
  } else if (Array.isArray(expected)) {
    const got = actual as unknown[];
    expect(got.length, `${path}.length`).toBe(expected.length);
    expected.forEach((e, i) => expectClose(got[i], e, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    const got = actual as Record<string, unknown>;
    const exp = expected as Record<string, unknown>;
    expect(Object.keys(got).sort(), `${path} clés`).toEqual(Object.keys(exp).sort());
    for (const k of Object.keys(exp)) expectClose(got[k], exp[k], `${path}.${k}`);
  } else expect(actual, path).toEqual(expected);
}
