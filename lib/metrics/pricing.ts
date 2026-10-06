import { computeCoverage, isValidPrice, valueUsd, DAY_MS, lastDaysKeys } from "@/lib/valuation";

export { computeCoverage, isValidPrice, valueUsd, DAY_MS, lastDaysKeys };

export function sumUsd(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (isValidPrice(value) ? value : 0), 0);
}

export function normalizeMapValue(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function safePercentage(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}
