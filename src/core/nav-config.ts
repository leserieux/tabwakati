import type { ComponentProps } from "react";
import type { Icon } from "@/components/ui";
import { canAccess } from "@/core/auth/page-access";

type IconName = ComponentProps<typeof Icon>["name"];
export interface Tab { href: string; label: string }
export interface NavEntry { key: string; label: string; icon: IconName; href: string; tabs?: Tab[] }

/**
 * Navigation par tâche de l'admin (restructuration du 2026-11-20, voir docs/ROADMAP_RESTRUCTURATION.md) : 8 entrées.
 *  - Accueil     : ce qui demande une action maintenant.
 *  - Trésorerie  : tout ce qui concerne l'argent détenu, actif par actif (vue par actif, couverture, retraits, collecte, liquidité, staking).
 *  - Opérations  : la file d'attente (transactions bloquées/échouées, prêts à surveiller…), les transactions et les tâches.
 *  - Utilisateurs, Revenus, Produits, WAKATI, Système.
 * Les URLs existantes n'ont pas changé : seul leur rattachement à une entrée a changé. Un seul mot par concept (voir le glossaire de la roadmap).
 */
export const NAV: NavEntry[] = [
  { key: "today", label: "Accueil", icon: "grid", href: "/dashboard" },
  { key: "money", label: "Trésorerie", icon: "shield", href: "/dashboard/assets", tabs: [
    { href: "/dashboard/assets", label: "Actifs" },
    { href: "/dashboard/funding", label: "À approvisionner" },
    { href: "/dashboard/treasury", label: "Couverture" },
    { href: "/dashboard/custody", label: "Réserve de retrait" },
    { href: "/dashboard/sweep", label: "Collecte des dépôts" },
    { href: "/dashboard/liquidity", label: "Liquidité des échanges" },
    { href: "/dashboard/staking-plan", label: "Plan staking" }
  ] },
  { key: "ops", label: "Opérations", icon: "clock", href: "/dashboard/operations", tabs: [
    { href: "/dashboard/operations", label: "File d'attente" },
    { href: "/dashboard/transactions", label: "Transactions" },
    { href: "/dashboard/tasks", label: "Tâches" }
  ] },
  { key: "users", label: "Utilisateurs", icon: "users", href: "/dashboard/users", tabs: [
    { href: "/dashboard/users", label: "Liste" },
    { href: "/dashboard/analytics", label: "Croissance" },
    { href: "/dashboard/analytics/cohortes", label: "Rétention & valeur" },
    { href: "/dashboard/pnl/acquisition", label: "Acquisition" },
    { href: "/dashboard/pnl/utilisateurs", label: "Rentabilité" }
  ] },
  { key: "revenue", label: "Revenus", icon: "price", href: "/dashboard/pnl", tabs: [
    { href: "/dashboard/pnl", label: "Résultat" },
    { href: "/dashboard/fees", label: "Frais" },
    { href: "/dashboard/pnl/depots", label: "Dépôts" }
  ] },
  { key: "products", label: "Produits", icon: "layers", href: "/dashboard/credit", tabs: [
    { href: "/dashboard/credit", label: "Prêts" },
    { href: "/dashboard/wakati/staking", label: "Staking" },
    { href: "/dashboard/futures", label: "Futures" },
    { href: "/dashboard/games", label: "Jeux" },
    { href: "/dashboard/pnl/roue", label: "Roue" },
    { href: "/dashboard/p2p", label: "P2P" },
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
    { href: "/dashboard/alerts", label: "Alertes" },
    { href: "/dashboard/audit", label: "Journal d'audit" },
    { href: "/dashboard/admins", label: "Administrateurs" },
    { href: "/dashboard/approvals", label: "Validations" },
    { href: "/dashboard/notifications", label: "Notifications" },
    { href: "/dashboard/telegram", label: "Bot Telegram" },
    { href: "/dashboard/app", label: "App mobile" },
    { href: "/dashboard/settings", label: "Paramètres" }
  ] }
];

/**
 * Menu visible pour un rôle : les onglets non permis disparaissent ; une entrée sans aucun onglet permis disparaît ;
 * l'entrée pointe vers son premier onglet permis. (L'accès réel est refusé par le middleware, ceci n'est que l'affichage.)
 */
export function filterNav(role: string | null | undefined): NavEntry[] {
  return NAV.flatMap((entry) => {
    if (!entry.tabs) return canAccess(role, entry.href) ? [entry] : [];
    const tabs = entry.tabs.filter((t) => canAccess(role, t.href));
    return tabs.length > 0 ? [{ ...entry, href: tabs[0].href, tabs }] : [];
  });
}

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
