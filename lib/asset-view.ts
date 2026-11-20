import { EPS, type Line, type Status } from "@/lib/solvency";

/** Présentation partagée d'une ligne de trésorerie (accueil, liste des actifs, fiche actif) : un seul vocabulaire partout. */
export type StatusTone = "ok" | "warn" | "bad" | "info";

export function statusTone(s: Status): StatusTone {
  return s === "covered" ? "ok" : s === "short" || s === "error" ? "bad" : s === "minor" || s === "sweep" ? "warn" : "info";
}

export function statusLabel(s: Status): string {
  switch (s) {
    case "covered": return "Couvert";
    case "minor": return "Écart mineur";
    case "short": return "Insuffisant";
    case "sweep": return "À collecter";
    case "error": return "Lecture impossible";
  }
}

/** Écart = détenu − dû (négatif = il manque de l'argent). null si le solde réel n'a pas pu être lu. */
export function lineGap(l: Line): number | null {
  return l.have === null ? null : l.have - l.owe;
}

/** Couverture de l'actif (1 = 100 %). Rien de dû => 1. Solde illisible => 0. */
export function lineRatio(l: Line): number {
  if (l.have === null) return 0;
  return l.owe > EPS ? l.have / l.owe : 1;
}

export function lineUsd(l: Line, qty: number | null): number | null {
  return qty !== null && l.priceUsd !== null ? qty * l.priceUsd : null;
}

/** Nom lisible du lieu où se trouve l'argent (argent mobile = chez le prestataire). */
export function isMobileLine(l: Line): boolean {
  return l.label.includes("PawaPay");
}
