import Link from "next/link";
import { currentRole } from "@/core/auth/session";
import { filterNav } from "@/core/nav-config";
import { ROLE_LABELS } from "@/core/auth/permissions";
import { PageHeader, Section } from "@/components/ui";

/** Accueil des rôles sans accès aux chiffres financiers (support, risque…) : leurs sections, rien d'autre. */
export default function RestrictedHome() {
  const role = currentRole();
  const entries = filterNav(role).filter((e) => e.key !== "today");
  return (
    <div>
      <PageHeader title="Accueil" subtitle={`Rôle : ${ROLE_LABELS[role ?? ""] ?? role ?? "inconnu"}`} />
      <Section title="Tes sections">
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          {entries.map((e) => (
            <li key={e.key}>
              <Link href={e.href}>{e.label}</Link>
              {e.tabs && <span className="wk-asset-sub"> : {e.tabs.map((t) => t.label).join(", ")}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
