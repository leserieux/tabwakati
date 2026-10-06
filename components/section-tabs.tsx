"use client";

import { usePathname } from "next/navigation";
import { NAV, activeTab } from "@/lib/nav-config";

export default function SectionTabs({ group }: { group: string }) {
  const pathname = usePathname();
  const entry = NAV.find((e) => e.key === group);
  if (!entry?.tabs) return null;
  const current = activeTab(pathname, entry.tabs);
  return (
    <div className="wk-tabs" role="tablist" aria-label={entry.label}>
      {entry.tabs.map((t) => (
        <a key={t.href} href={t.href} role="tab" aria-selected={current === t.href} className={`wk-tab ${current === t.href ? "active" : ""}`}>{t.label}</a>
      ))}
    </div>
  );
}
