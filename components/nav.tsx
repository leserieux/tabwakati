"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";

const ITEMS = [
  { href: "/dashboard/treasury", label: "Solvabilité", icon: "shield" as const },
  { href: "/dashboard/activity", label: "Activité", icon: "activity" as const }
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="wk-nav" aria-label="Navigation principale">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <a key={item.href} href={item.href} className={active ? "wk-navlink wk-navlink-active" : "wk-navlink"} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon} size={17} />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
