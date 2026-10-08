import { loadControls, CATEGORY_ORDER, bySeverity, type ControlStatus } from "@/lib/controls";
import { formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL: Record<ControlStatus, string> = { ok: "OK", warn: "À surveiller", bad: "Échec", info: "Info" };

export default async function ControlsPage() {
  const r = await loadControls();
  const categories = [...new Set([...CATEGORY_ORDER, ...r.controls.map((c) => c.category)])].filter((c) => r.controls.some((x) => x.category === c));
  const allGreen = r.controls.length > 0 && r.bad === 0 && r.warn === 0;

  return (
    <div>
      <PageHeader title="Contrôles" subtitle="Tests automatiques exécutés à chaque ouverture de cette page : comptabilité, prix, tâches planifiées, opérations, jeux et sécurité." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Contrôles indisponibles : ${r.error}` : null} />

      {allGreen && <div className="wk-alert-ok">Tous les contrôles sont au vert ({r.ok} sur {r.controls.length}).</div>}
      {r.bad > 0 && <div className="wk-alert-bad">{r.bad} contrôle(s) en échec : à traiter en priorité.</div>}
      {r.bad === 0 && r.warn > 0 && <div className="wk-alert-warn">{r.warn} point(s) à surveiller. Aucun échec critique.</div>}

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">OK</div><div className="wk-strip-value wk-ok">{r.ok}</div><div className="wk-strip-sub">Tests réussis</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">À surveiller</div><div className="wk-strip-value">{r.warn}</div><div className="wk-strip-sub">Anomalies non critiques</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Échecs</div><div className={`wk-strip-value ${r.bad > 0 ? "wk-bad" : ""}`}>{r.bad}</div><div className="wk-strip-sub">À corriger</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Informations</div><div className="wk-strip-value">{r.info}</div><div className="wk-strip-sub">Sans action requise</div></div>
      </div>

      {categories.map((cat) => {
        const rows = r.controls.filter((c) => c.category === cat).sort(bySeverity);
        const issues = rows.filter((c) => c.status === "bad" || c.status === "warn").length;
        return (
          <Section key={cat} title={cat} hint={issues ? `${issues} point(s) à regarder` : "Tout est en ordre"}>
            <TableWrap>
              <thead><tr><Th>Statut</Th><Th>Test</Th><Th hideSm>Résultat</Th><Th>Détail</Th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.check_key}>
                    <Td label="Statut"><Pill tone={c.status}>{LABEL[c.status]}</Pill></Td>
                    <Td label="Test">{c.label}</Td>
                    <Td hideSm label="Résultat">{c.value}</Td>
                    <Td label="Détail"><span style={{ color: "var(--muted)", fontSize: 13.5 }}>{c.detail}</span></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>
        );
      })}
    </div>
  );
}
