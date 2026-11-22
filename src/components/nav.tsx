"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui";
import { NAV, isEntryActive } from "@/core/nav-config";

export default function Nav({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  return <nav className="wk-nav" aria-label="Navigation principale">
    <div className="wk-navgroup">
      <div className="wk-navgroup-items">{NAV.map((item) => {
        const active = isEntryActive(pathname, item);
        return <Link key={item.key} href={item.href} className={`wk-navitem ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}>
          <span className="wk-navicon"><Icon name={item.icon} size={16} /></span><span>{item.label}</span>
        </Link>;
      })}</div>
    </div>
  </nav>;
}
