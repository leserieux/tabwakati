/**
 * Valorisation centralisée (source unique) : prix valides, valeur USD, couverture.
 * Règle : un prix <= 0, NaN ou absent n'est PAS un prix. L'actif est "non valorisé"
 * et signalé, jamais compté silencieusement à 0 $ (ce qui masquerait un manque).
 */
export function isValidPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isFinite(p) && p > 0;
}

export function valueUsd(quantity: number, price: number | null | undefined): number | null {
  return isValidPrice(price) ? quantity * price : null;
}

export interface CoverageInput { asset: string; owed: number; held: number; price: number | null | undefined }
export interface CoverageResult {
  heldUsd: number;
  owedUsd: number;
  coveredUsd: number;
  missingUsd: number;
  coveragePct: number;
  /** Actifs avec solde/dû mais sans prix valide : exclus du calcul, à afficher en alerte. */
  unpriced: string[];
}

/** Couverture actif par actif (jamais de mélange de quantités), agrégée en USD. */
export function computeCoverage(lines: CoverageInput[]): CoverageResult {
  let heldUsd = 0, owedUsd = 0, coveredUsd = 0;
  const unpriced: string[] = [];
  for (const l of lines) {
    if (!isValidPrice(l.price)) {
      if (l.owed > 0 || l.held > 0) unpriced.push(l.asset);
      continue;
    }
    const owe = l.owed * l.price, held = l.held * l.price;
    heldUsd += held; owedUsd += owe; coveredUsd += Math.min(held, owe);
  }
  const missingUsd = Math.max(owedUsd - coveredUsd, 0);
  // Pas de passif valorisable => couverture inconnue plutôt que 100 % trompeur si des actifs ne sont pas valorisés.
  const coveragePct = owedUsd > 0 ? (coveredUsd / owedUsd) * 100 : unpriced.length ? NaN : 100;
  return { heldUsd, owedUsd, coveredUsd, missingUsd, coveragePct, unpriced };
}

export const DAY_MS = 24 * 3600 * 1000;

/** Fenêtre glissante de N jours UTC finissant aujourd'hui (inclus). */
export function lastDaysKeys(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}
