import type { ComponentProps } from "react";
import type { Icon } from "@/components/ui";

type IconName = ComponentProps<typeof Icon>["name"];
export interface Tab { href: string; label: string }
export interface NavEntry { key: string; label: string; icon: IconName; href: string; tabs?: Tab[] }

/** Navigation unique : 8 entrées. Les sous-pages d'un même sujet sont des onglets (SectionTabs). */
export const NAV: NavEntry[] = [
  { key: "overview", label: "Vue d'ensemble", icon: "grid", href: "/dashboard" },
  { key: "pnl", label: "Résultat & pertes", icon: "activity", href: "/dashboard/pnl", tabs: [
    { href: "/dashboard/pnl", label: "Résultat" },
    { href: "/dashboard/pnl/depots", label: "Dépôts" },
    { href: "/dashboard/pnl/roue", label: "Roue" },
    { href: "/dashboard/pnl/utilisateurs", label: "Rentabilité" }
  ] },
  { key: "users", label: "Utilisateurs", icon: "users", href: "/dashboard/users" },
  { key: "transactions", label: "Transactions", icon: "log", href: "/dashboard/transactions" },
  { key: "treasury", label: "Trésorerie", icon: "shield", href: "/dashboard/treasury", tabs: [
    { href: "/dashboard/treasury", label: "Solvabilité" },
    { href: "/dashboard/liquidity", label: "Liquidité (swap)" },
    { href: "/dashboard/sweep", label: "Balayage" },
    { href: "/dashboard/fees", label: "Frais" }
  ] },
  { key: "markets", label: "Marchés & analytics", icon: "price", href: "/dashboard/markets", tabs: [
    { href: "/dashboard/markets", label: "Marchés" },
    { href: "/dashboard/analytics", label: "Analytics plateforme" }
  ] },
  { key: "products", label: "Produits", icon: "percent", href: "/dashboard/credit", tabs: [
    { href: "/dashboard/credit", label: "Crédit" },
    { href: "/dashboard/games", label: "Jeux" }
  ] },
  { key: "wakati", label: "WAKATI", icon: "coin", href: "/dashboard/wakati", tabs: [
    { href: "/dashboard/wakati", label: "Tokenomics" },
    { href: "/dashboard/wakati/prix", label: "Prix & réserve" },
    { href: "/dashboard/wakati/staking", label: "Staking" },
    { href: "/dashboard/wakati/detenteurs", label: "Détenteurs" }
  ] },
  { key: "admin", label: "Administration", icon: "gear", href: "/dashboard/controls", tabs: [
    { href: "/dashboard/controls", label: "Contrôles" },
    { href: "/dashboard/tasks", label: "Tâches" },
    { href: "/dashboard/audit", label: "Journal d'audit" },
    { href: "/dashboard/settings", label: "Paramètres" }
  ] }
];

export function matches(pathname: string, href: string, exact = false): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}

/** Une entrée est active si l'un de ses onglets (ou elle-même) correspond ; /dashboard n'est actif qu'en exact. */
export function isEntryActive(pathname: string, entry: NavEntry): boolean {
  if (entry.key === "overview") return pathname === "/dashboard" || pathname === "/dashboard/activity";
  const hrefs = entry.tabs ? entry.tabs.map((t) => t.href) : [entry.href];
  return hrefs.some((h) => matches(pathname, h));
}

/** Pour les onglets, le plus long href correspondant gagne (ex. /dashboard/wakati vs /dashboard/wakati/prix). */
export function activeTab(pathname: string, tabs: Tab[]): string | null {
  const hit = tabs.filter((t) => matches(pathname, t.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return hit ? hit.href : null;
}
