/**
 * « Ce chiffre est-il normal ? » : comparaison d'un chiffre à la période précédente, en logique pure.
 * Règles simples et affichées à l'admin (pas de boîte noire) :
 *  - on compare à une période de même durée juste avant ;
 *  - sous une base minimale, on ne compare pas (un +300 % sur 1 utilisateur ne veut rien dire) ;
 *  - un écart de 30 % ou plus est signalé comme inhabituel ; moins de 2 % = stable.
 */
export type Direction = "up" | "down" | "flat" | "na";

export interface Delta {
  direction: Direction;
  pct: number | null; // variation en % (null si non comparable)
  unusual: boolean; // écart inhabituel (≥ seuil)
  tone?: "positive" | "negative"; // selon le sens qui est bon pour toi
  text: string; // « ↑ +24 % » ou « base trop faible pour comparer »
}

export interface CompareOptions {
  minBase?: number; // valeur précédente minimale (en valeur absolue) pour comparer
  threshold?: number; // % à partir duquel l'écart est inhabituel
  goodWhen?: "up" | "down" | "none"; // sens favorable
}

const ARROW: Record<Direction, string> = { up: "↑", down: "↓", flat: "→", na: "" };

function formatPctSigned(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct);
  return `${sign}${abs >= 10 ? Math.round(abs) : abs.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function compare(current: number | null, previous: number | null, opts: CompareOptions = {}): Delta {
  const { minBase = 0, threshold = 30, goodWhen = "up" } = opts;
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { direction: "na", pct: null, unusual: false, text: "pas de période précédente à comparer" };
  }
  if (Math.abs(previous) < Math.max(minBase, 1e-9)) {
    return { direction: "na", pct: null, unusual: false, text: "base trop faible pour comparer" };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const direction: Direction = Math.abs(pct) < 2 ? "flat" : pct > 0 ? "up" : "down";
  const unusual = Math.abs(pct) >= threshold;
  const tone = direction === "flat" || goodWhen === "none" ? undefined : (direction === "up") === (goodWhen === "up") ? "positive" : "negative";
  return { direction, pct, unusual, tone, text: direction === "flat" ? "→ stable" : `${ARROW[direction]} ${formatPctSigned(pct)}` };
}

/** Variation d'un pourcentage (ex. couverture) en POINTS, pas en % de % : 98 → 95 = −3 points. */
export function comparePoints(current: number | null, previous: number | null, opts: { threshold?: number; goodWhen?: "up" | "down" } = {}): Delta {
  const { threshold = 5, goodWhen = "up" } = opts;
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { direction: "na", pct: null, unusual: false, text: "pas de relevé à comparer" };
  }
  const diff = current - previous;
  const direction: Direction = Math.abs(diff) < 0.5 ? "flat" : diff > 0 ? "up" : "down";
  const tone = direction === "flat" ? undefined : (direction === "up") === (goodWhen === "up") ? "positive" : "negative";
  const abs = Math.abs(diff).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return { direction, pct: diff, unusual: Math.abs(diff) >= threshold, tone, text: direction === "flat" ? "→ stable" : `${ARROW[direction]} ${diff > 0 ? "+" : "−"}${abs} pts` };
}
