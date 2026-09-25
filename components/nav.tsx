"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const GROUPS = [
  { label: "Console", items: [
    { href: "/dashboard", label: "Vue d'ensemble", icon: "grid" as const },
    { href: "/dashboard/treasury", label: "Solvabilité", icon: "shield" as const },
    { href: "/dashboard/activity", label: "Activité", icon: "activity" as const },
    { href: "/dashboard/users", label: "Utilisateurs", icon: "users" as const },
    { href: "/dashboard/transactions", label: "Transactions", icon: "grid" as const },
    { href: "/dashboard/liquidity", label: "Liquidité (swap)", icon: "droplet" as const },
    { href: "/dashboard/settings", label: "Paramètres", icon: "gear" as const },
    { href: "/dashboard/audit", label: "Journal d'audit", icon: "log" as const }
  ] },
  { label: "Actifs spécialisés", items: [
    { href: "/dashboard/wakati", label: "Tokenomics WAKATI", icon: "coin" as const },
    { href: "/dashboard/wakati/prix", label: "Prix et réserve WAKATI", icon: "price" as const },
    { href: "/dashboard/wakati/staking", label: "Staking WAKATI", icon: "layers" as const },
    { href: "/dashboard/wakati/detenteurs", label: "Détenteurs WAKATI", icon: "users" as const }
  ] }
];

export default function Nav() {
  const pathname = usePathname();
  return <nav className="wk-nav" aria-label="Navigation principale">{GROUPS.map((group) => <div key={group.label} className="wk-navgroup"><div className="wk-navgroup-label">{group.label}</div>{group.items.map((item) => <a key={item.href} href={item.href} className={`wk-navitem ${pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)) ? "active" : ""}`}><Icon name={item.icon} size={16} /><span>{item.label}</span></a>)}</div>)}</nav>;
}
