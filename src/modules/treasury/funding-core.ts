import { DUST_USD, EPS, toUsd, type PlanLine } from "@/modules/treasury/custody-plan";
import { formatNumber, formatUsd } from "@/core/format";

/**
 * Plan d'approvisionnement : « quoi approvisionner, combien, et avant quand ? », actif par actif.
 *
 * Il complète le plan de la Réserve de retrait (modules/treasury/custody-plan, qui reste la source de la cible et de l'état) avec trois choses :
 *  1. l'AUTONOMIE : pendant combien de jours ce qui est prêt à partir peut payer les retraits, au pire jour observé et au rythme moyen ;
 *  2. un TEST DE STRESS : et si les 1, 5 ou 10 plus gros utilisateurs retiraient tout leur solde disponible en même temps ?
 *  3. une ACTION chiffrée, avec d'où prendre l'argent (coffre, collecte, extérieur).
 * Ce fichier ne contient que de la logique pure (aucune base de données) pour pouvoir la tester ; le chargement des données est dans modules/treasury/funding.ts.
 */

export type Urgency = "now" | "soon" | "watch" | "ok" | "excess" | "unknown";
export type StressVerdict = "ok" | "move" | "short" | "unknown";

export interface StressCase {
  key: "top1" | "top5" | "top10";
  label: string;
  users: number;
  need: number; // somme des soldes disponibles de ces utilisateurs
  verdict: StressVerdict; // ok = payable tout de suite ; move = payable après avoir déplacé coffre/collecte ; short = pas payable même ainsi
  shortfall: number; // ce qui manque dans le portefeuille de retrait pour payer tout de suite
  shortfallAll: number; // ce qui manque même après avoir déplacé le coffre et la collecte
}

export interface FundingAction {
  kind: "fund" | "vault" | "none";
  amount: number; // à ajouter (fund) ou à mettre au coffre (vault)
  fromVault: number;
  fromCollect: number;
  external: number;
  usd: number | null;
}

export interface FundingLine {
  plan: PlanLine;
  urgency: Urgency;
  runwayPeak: number | null; // jours, au pire jour observé (null = aucun retrait observé ou lecture impossible)
  runwayAvg: number | null; // jours, au rythme moyen
  stress: StressCase[];
  unlock7: number; // staking bloqué qui arrive à échéance dans 7 jours (peut devenir retirable)
  action: FundingAction;
  why: string[]; // les raisons, en français simple
}

const STRESS_DEFS = [
  { key: "top1", label: "Le plus gros solde", n: 1 },
  { key: "top5", label: "Les 5 plus gros", n: 5 },
  { key: "top10", label: "Les 10 plus gros", n: 10 }
] as const;

export function computeFunding(plan: PlanLine, tops: number[], unlock7: number): FundingLine {
  const immediate = plan.withdrawable; // ce qui peut payer un retrait tout de suite (null = illisible)
  const reachable = immediate === null ? null : immediate + plan.vault + plan.onUsers; // + ce qu'on peut ramener du coffre / des adresses des utilisateurs

  const sorted = [...tops].sort((a, b) => b - a);
  const stress: StressCase[] = [];
  let prevUsers = 0;
  for (const def of STRESS_DEFS) {
    const part = sorted.slice(0, def.n);
    if (part.length === 0 || part.length === prevUsers) continue; // pas assez d'utilisateurs : on n'affiche pas deux fois le même cas
    prevUsers = part.length;
    const need = part.reduce((s, v) => s + v, 0);
    let verdict: StressVerdict = "unknown";
    let shortfall = 0;
    let shortfallAll = 0;
    if (immediate !== null && reachable !== null) {
      shortfall = Math.max(0, need - immediate);
      shortfallAll = Math.max(0, need - reachable);
      verdict = shortfall <= EPS ? "ok" : shortfallAll <= EPS ? "move" : "short";
    }
    stress.push({ key: def.key, label: def.label, users: part.length, need, verdict, shortfall, shortfallAll });
  }

  const peak = plan.stat.peak_day_out;
  const avg = plan.stat.avg_day_out;
  const runwayPeak = immediate !== null && peak > EPS ? immediate / peak : null;
  const runwayAvg = immediate !== null && avg > EPS ? immediate / avg : null;

  // ── Urgence : on garde l'état de la Réserve de retrait (même seuils) et on y ajoute l'autonomie et le test de stress ──
  const why: string[] = [];
  let urgency: Urgency;
  if (plan.state === "unknown") urgency = "unknown";
  else if (plan.state === "nothing") urgency = "ok";
  else if (plan.state === "danger") {
    urgency = "now";
    why.push("Le plus gros utilisateur ne pourrait pas retirer tout son solde d'un coup.");
  } else if (runwayPeak !== null && runwayPeak < 1) {
    urgency = "now";
    why.push("Au pire jour de retraits observé, ce qui est prêt à partir ne tient pas une journée.");
  } else if (plan.state === "refill") {
    urgency = "soon";
    why.push("Le portefeuille de retrait descend sous le seuil d'alerte.");
  } else if (stress.some((c) => c.verdict === "short")) {
    urgency = "soon";
    why.push("Même en ramenant le coffre et la collecte, on ne pourrait pas payer tous les plus gros soldes d'un coup.");
  } else if (stress.some((c) => c.verdict === "move")) {
    urgency = "watch";
    why.push("Si les plus gros utilisateurs retiraient ensemble, il faudrait d'abord déplacer de l'argent du coffre ou lancer la collecte.");
  } else if (plan.state === "excess") {
    urgency = "excess";
    why.push("Plus d'argent exposé que nécessaire.");
  } else urgency = "ok";

  if (unlock7 > EPS && (urgency === "now" || urgency === "soon" || urgency === "watch")) why.push(`${formatNumber(unlock7)} ${plan.asset} de staking bloqué arrivent à échéance dans 7 jours et pourront être retirés.`);
  if (plan.reservedForSwaps > EPS) why.push(`${formatNumber(plan.reservedForSwaps)} ${plan.asset} du portefeuille sont réservés aux swaps : ils ne comptent pas pour les retraits.`);

  // ── Action chiffrée ──
  const top5 = stress.find((c) => c.key === "top5") ?? stress[stress.length - 1];
  let amount = 0;
  let kind: FundingAction["kind"] = "none";
  if (plan.state === "danger" || plan.state === "refill") {
    amount = plan.move;
    kind = "fund";
  } else if ((urgency === "soon" || urgency === "watch") && top5 && top5.shortfall > EPS) {
    amount = top5.shortfall;
    kind = "fund";
  } else if (plan.state === "excess") {
    amount = plan.move;
    kind = "vault";
  }
  const usd = toUsd(amount, plan.priceUsd);
  if (usd !== null && usd < DUST_USD) { amount = 0; kind = "none"; }

  let fromVault = 0;
  let fromCollect = 0;
  let external = 0;
  if (kind === "fund") {
    fromVault = Math.min(amount, plan.vault);
    fromCollect = Math.min(amount - fromVault, plan.onUsers);
    external = Math.max(0, amount - fromVault - fromCollect);
  }

  return { plan, urgency, runwayPeak, runwayAvg, stress, unlock7, action: { kind, amount, fromVault, fromCollect, external, usd: kind === "none" ? null : usd }, why };
}

// ─────────────────────────── Présentation ───────────────────────────

export const URGENCY_LABEL: Record<Urgency, string> = {
  now: "Maintenant",
  soon: "Bientôt",
  watch: "À surveiller",
  ok: "Tout va bien",
  excess: "Trop plein",
  unknown: "Illisible"
};

export const URGENCY_TONE: Record<Urgency, "ok" | "warn" | "bad" | "info"> = { now: "bad", soon: "warn", watch: "info", ok: "ok", excess: "info", unknown: "bad" };

/** 0,4 → « 10 h », 2,5 → « 2,5 jours », 400 → « plus d'un an ». */
export function formatDays(d: number): string {
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  if (d > 365) return "plus d'un an";
  if (d < 10) return `${d.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} jour${d >= 2 ? "s" : ""}`;
  return `${Math.round(d)} jours`;
}

/** « jusqu'au 24/11 » : date jusqu'à laquelle l'autonomie tient. */
export function untilLabel(days: number, now = Date.now()): string {
  if (days > 365) return "";
  return `jusqu'au ${new Date(now + days * 86400000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}`;
}

function amountText(f: FundingLine, amount: number): string {
  const usd = toUsd(amount, f.plan.priceUsd);
  return `${formatNumber(amount)} ${f.plan.asset}${usd !== null ? ` (≈ ${formatUsd(usd)})` : ""}`;
}

/** Où prendre l'argent, en une phrase. */
export function sourcesText(f: FundingLine): string {
  const a = f.action;
  if (a.kind !== "fund") return "";
  const mobile = f.plan.kind === "mobile";
  const parts: string[] = [];
  if (a.fromVault > EPS) parts.push(`${formatNumber(a.fromVault)} depuis le coffre`);
  if (a.fromCollect > EPS) parts.push(`${formatNumber(a.fromCollect)} en lançant la collecte des dépôts`);
  if (a.external > EPS) parts.push(`${formatNumber(a.external)} à apporter ${mobile ? "sur le compte du prestataire de paiement" : "de l'extérieur"}`);
  return parts.join(", ");
}

/** La phrase d'action de l'accueil et de la page : quoi, combien, où, avant quand. */
export function actionText(f: FundingLine): string {
  const a = f.action;
  const asset = f.plan.asset;
  const where = f.plan.kind === "mobile" ? "le compte du prestataire de paiement" : "le portefeuille de retrait";
  const until = f.runwayPeak !== null ? ` Il tient ${formatDays(f.runwayPeak)} au pire jour observé.` : "";
  if (a.kind === "fund") {
    const src = sourcesText(f);
    return `${asset} : ajoute ${amountText(f, a.amount)} dans ${where}.${until}${src ? ` ${src.charAt(0).toUpperCase()}${src.slice(1)}.` : ""}`;
  }
  if (a.kind === "vault") return `${asset} : tu peux mettre ${amountText(f, a.amount)} à l'abri dans le coffre (trop d'argent exposé).`;
  return `${asset} : ${f.why[0] ?? "rien à faire."}`;
}
