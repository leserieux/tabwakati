"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveNav } from "@/core/nav-config";
import { canAccess } from "@/core/auth/page-access";

/**
 * Onglets de la section courante, déduits de l'URL (core/nav-config.ts).
 * Rendus UNE seule fois par app/dashboard/layout.tsx : une page déplacée d'une section à l'autre affiche toujours les bons onglets.
 */
export default function SectionTabs({ role = null }: { role?: string | null }) {
  const pathname = usePathname();
  const { entry, tab } = resolveNav(pathname);
  if (!entry?.tabs) return null;
  const tabs = entry.tabs.filter((t) => canAccess(role, t.href));
  if (tabs.length === 0) return null;
  return (
    <div className="wk-tabs" role="tablist" aria-label={entry.label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={tab === t.href} className={`wk-tab ${tab === t.href ? "active" : ""}`}>{t.label}</Link>
      ))}
    </div>
  );
}
