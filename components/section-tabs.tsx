"use client";

import { usePathname } from "next/navigation";
import { resolveNav } from "@/lib/nav-config";

/**
 * Onglets de la section courante, déduits de l'URL (lib/nav-config.ts).
 * La prop `group` est conservée pour compatibilité avec les layouts existants mais n'est plus utilisée :
 * une page déplacée d'une section à l'autre affiche ainsi toujours les bons onglets.
 */
export default function SectionTabs(_props: { group?: string }) {
  const pathname = usePathname();
  const { entry, tab } = resolveNav(pathname);
  if (!entry?.tabs) return null;
  return (
    <div className="wk-tabs" role="tablist" aria-label={entry.label}>
      {entry.tabs.map((t) => (
        <a key={t.href} href={t.href} role="tab" aria-selected={tab === t.href} className={`wk-tab ${tab === t.href ? "active" : ""}`}>{t.label}</a>
      ))}
    </div>
  );
}
