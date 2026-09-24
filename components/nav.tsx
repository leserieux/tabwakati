import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const GROUPS = [
  {
    label: "Console",
    items: [
      { href: "/dashboard", label: "Vue d'ensemble", icon: "grid" as const },
      { href: "/dashboard/treasury", label: "Solvabilité", icon: "shield" as const },
      { href: "/dashboard/activity", label: "Activité", icon: "activity" as const },
      { href: "/dashboard/transactions", label: "Transactions", icon: "grid" as const },
      { href: "/dashboard/liquidity", label: "Liquidité (swap)", icon: "droplet" as const },
      { href: "/dashboard/settings", label: "Paramètres", icon: "gear" as const },
      { href: "/dashboard/audit", label: "Journal d'audit", icon: "log" as const }
    ]
  },
  {
    label: "WAKATI",
    items: [
      { href: "/dashboard/wakati", label: "Tokenomics", icon: "coin" as const },
      { href: "/dashboard/wakati/prix", label: "Prix et réserve", icon: "price" as const },
      { href: "/dashboard/wakati/staking", label: "Staking", icon: "layers" as const },
      { href: "/dashboard/wakati/detenteurs", label: "Détenteurs", icon: "users" as const }
    ]
  }
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="wk-nav" aria-label="Navigation principale">
      {GROUPS.map((group) => (
        <div key={group.label} className="wk-navgroup">
          <div className="wk-navgroup-label">{group.label}</div>
          {group.items.map((item) => {
            const active = pathname === item.href;
            return (
              <a key={item.href} href={item.href} className={active ? "wk-navlink wk-navlink-active" : "wk-navlink"} aria-current={active ? "page" : undefined}>
                <Icon name={item.icon} size={17} />
                {item.label}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
