import { loadAnalyticsMetrics } from "@/lib/metrics";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatPct, formatUsd } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const m = await loadAnalyticsMetrics();
  const { cashflow, users, fees, topUsers } = m;
  const withdrawalShare = cashflow.depositsUsd ? (cashflow.withdrawalsUsd / cashflow.depositsUsd) * 100 : 0;

  return (
    <div>
      <PageHeader title="Analytics plateforme" subtitle="Performance financière, activité utilisateur et risque agrégés." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={m.errors ? `Certaines données sont indisponibles : ${m.errors}` : null} />
      {m.truncated && <ErrorNote text="Lecture tronquée : les totaux sont partiels." />}
      {m.unpriced.length > 0 && <div className="wk-alert-warn">Sans prix valide (exclus des montants en dollars) : {m.unpriced.join(", ")}.</div>}

      <div className="wk-strip">
        <Metric label="Valeur utilisateurs" value={formatCompactUsd(users.totalValueUsd)} sub="Soldes valorisés USD" />
        <Metric label="Dépôts" value={formatCompactUsd(cashflow.depositsUsd)} sub="Transactions réussies" />
        <Metric label="Retraits" value={formatCompactUsd(cashflow.withdrawalsUsd)} sub={`${formatPct(withdrawalShare)} des dépôts`} />
        <Metric label="Frais plateforme" value={formatCompactUsd(fees.totalUsd)} sub="platform_fees (hors jeux)" />
        <Metric label="Actifs 30j" value={formatCompactNumber(users.active30d)} sub="Utilisateurs actifs" />
        <Metric label="À risque" value={formatCompactNumber(users.atRisk)} sub="Score ≥ 50" tone={users.atRisk ? "warn" : "ok"} />
      </div>

      <Section title="Décision plateforme" hint="Calculs basés uniquement sur les tables existantes du schéma de production.">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <p><strong>Cashflow net :</strong> {formatUsd(cashflow.netUsd)}</p>
            <p><strong>Transactions réussies :</strong> {formatCompactNumber(cashflow.successfulCount)}</p>
            <p><strong>Utilisateurs analysés :</strong> {formatCompactNumber(users.total)}</p>
          </div>
          <div className="wk-panel">
            <p><Pill tone={users.atRisk ? "warn" : "ok"}>{users.atRisk ? `${users.atRisk} compte(s) à examiner` : "Aucun compte à risque"}</Pill></p>
            <p><Pill tone="info">Performance comptable, pas P&amp;L réel</Pill></p>
          </div>
        </div>
      </Section>

      <Section title="Utilisateurs à forte valeur" hint="Valeur actuelle calculée actif par actif puis agrégée en USD.">
        <TableWrap>
          <thead>
            <tr><Th>Utilisateur</Th><Th right>Valeur USD</Th><Th>Dernière activité</Th><Th>Risque</Th></tr>
          </thead>
          <tbody>
            {topUsers.map((user) => {
              const score = user.riskScore?.score ?? null;
              return (
                <tr key={user.userId}>
                  <Td><a className="wk-link" href={`/dashboard/users/${user.userId}`}>{user.username}</a></Td>
                  <Td right>{formatUsd(user.valueUsd)}</Td>
                  <Td>{user.lastActivity ? formatDateTime(new Date(user.lastActivity)) : "—"}</Td>
                  <Td>{score === null ? "—" : <Pill tone={score >= 75 ? "bad" : score >= 50 ? "warn" : "ok"}>{score}/100</Pill>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Section>
    </div>
  );
}

function Metric({ label, value, sub, tone = "ok" }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className="wk-strip-value" style={{ color: tone === "warn" ? "var(--warn)" : "var(--fg)" }}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
