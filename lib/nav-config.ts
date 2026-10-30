import type { ComponentProps } from "react";
import type { Icon } from "@/components/ui";

type IconName = ComponentProps<typeof Icon>["name"];
export interface Tab { href: string; label: string }
export interface NavEntry { key: string; label: string; icon: IconName; href: string; tabs?: Tab[] }

/**
 * Navigation par question que se pose l'admin : 6 entrées.
 * Les sous-pages d'un même sujet sont des onglets (SectionTabs). Les URLs des pages n'ont pas changé :
 * seul leur rattachement à une entrée a changé (ex. /dashboard/pnl/acquisition est maintenant sous « Utilisateurs »).
 */
export const NAV: NavEntry[] = [
  { key: "today", label: "Aujourd'hui", icon: "grid", href: "/dashboard" },
  { key: "money", label: "Argent", icon: "shield", href: "/dashboard/treasury", tabs: [
    { href: "/dashboard/treasury", label: "Solvabilité" },
    { href: "/dashboard/custody", label: "Réserve de retrait" },
    { href: "/dashboard/pnl", label: "Résultat" },
    { href: "/dashboard/pnl/depots", label: "Dépôts" },
    { href: "/dashboard/liquidity", label: "Liquidité (swap)" },
    { href: "/dashboard/sweep", label: "Balayage" },
    { href: "/dashboard/fees", label: "Frais" }
  ] },
  { key: "users", label: "Utilisateurs", icon: "users", href: "/dashboard/users", tabs: [
    { href: "/dashboard/users", label: "Liste" },
    { href: "/dashboard/transactions", label: "Transactions" },
    { href: "/dashboard/pnl/utilisateurs", label: "Rentabilité" },
    { href: "/dashboard/pnl/acquisition", label: "Acquisition" },
    { href: "/dashboard/analytics/cohortes", label: "Cohortes & LTV" },
    { href: "/dashboard/analytics", label: "Analytics" }
  ] },
  { key: "products", label: "Produits", icon: "percent", href: "/dashboard/credit", tabs: [
    { href: "/dashboard/credit", label: "Prêts" },
    { href: "/dashboard/wakati/staking", label: "Staking" },
    { href: "/dashboard/games", label: "Jeux" },
    { href: "/dashboard/pnl/roue", label: "Roue" },
    { href: "/dashboard/markets", label: "Marchés" }
  ] },
  { key: "wakati", label: "WAKATI", icon: "coin", href: "/dashboard/wakati", tabs: [
    { href: "/dashboard/wakati", label: "Tokenomics" },
    { href: "/dashboard/wakati/prix", label: "Prix & réserve" },
    { href: "/dashboard/wakati/offre", label: "Offre" },
    { href: "/dashboard/wakati/ventes", label: "Ventes & caisse" },
    { href: "/dashboard/wakati/burns", label: "Burns" },
    { href: "/dashboard/wakati/detenteurs", label: "Détenteurs" }
  ] },
  { key: "system", label: "Système", icon: "gear", href: "/dashboard/controls", tabs: [
    { href: "/dashboard/controls", label: "Contrôles" },
    { href: "/dashboard/tasks", label: "Tâches" },
    { href: "/dashboard/audit", label: "Journal d'audit" },
    { href: "/dashboard/app", label: "App mobile" },
    { href: "/dashboard/settings", label: "Paramètres" }
  ] }
];

export function matches(pathname: string, href: string, exact = false): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}

/**
 * Entrée et onglet actifs pour une URL : le href le plus long qui correspond gagne, toutes entrées confondues
 * (ex. /dashboard/wakati/staking appartient à « Produits », pas à « WAKATI » ; /dashboard/pnl/acquisition à « Utilisateurs »).
 */
export function resolveNav(pathname: string): { entry: NavEntry | null; tab: string | null } {
  if (pathname === "/dashboard" || pathname === "/dashboard/activity") return { entry: NAV[0], tab: null };
  let best: { entry: NavEntry; href: string } | null = null;
  for (const entry of NAV) {
    if (entry.key === "today") continue;
    for (const t of entry.tabs ?? [{ href: entry.href, label: entry.label }]) {
      if (matches(pathname, t.href) && (!best || t.href.length > best.href.length)) best = { entry, href: t.href };
    }
  }
  return best ? { entry: best.entry, tab: best.href } : { entry: null, tab: null };
}

export function isEntryActive(pathname: string, entry: NavEntry): boolean {
  return resolveNav(pathname).entry?.key === entry.key;
}

/** Pour les onglets d'une entrée, le plus long href correspondant gagne. */
export function activeTab(pathname: string, tabs: Tab[]): string | null {
  const hit = tabs.filter((t) => matches(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return hit ? hit.href : null;
}
