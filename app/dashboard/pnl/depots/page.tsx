import { loadDeposits } from "@/lib/deposits";
import { formatNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { Signals, PeriodTabs, parsePeriod } from "@/components/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = [{ value: 30, label: "30 jours" }, { value: 90, label: "90 jours" }, { value: 0, label: "Depuis le début" }];
const monthLabel = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }); };
const pct = (n: number | null) => (n === null ? "—" : formatPct(n, 0));

export default async function DepositsPage({ searchParams }: { searchParams: { p?: string } }) {
  const period = parsePeriod(searchParams.p, [30, 90, 0], 90);
  const r = await loadDeposits(period);
  const maxFunnel = Math.max(...r.activation.map((a) => a.count), 1);
  const periodLabel = PERIODS.find((x) => x.value === period)!.label.toLowerCase();

  return (
    <div>
      <PageHeader title="Dépôts : où part l'argent qui ne rentre pas" subtitle="Entonnoir des dépôts mobile money : combien aboutissent, pourquoi les autres échouent, et ce que vous pouvez corriger." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      <PeriodTabs base="/dashboard/pnl/depots" periods={PERIODS} current={period} />

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Tentatives ({periodLabel})</div><div className="wk-strip-value">{formatNumber(r.attempts, 0)}</div><div className="wk-strip-sub">{r.success} réussies · {r.failed} échouées</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Taux de réussite</div><div className={`wk-strip-value ${r.successRate !== null && r.successRate < 50 ? "wk-bad" : ""}`}>{pct(r.successRate)}</div><div className="wk-strip-sub">Dépôt médian : {r.medianOkNative === null ? "—" : `${formatNumber(r.medianOkNative, 0)} FCFA`}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Échecs évitables</div><div className="wk-strip-value">{formatNumber(r.avoidable, 0)}</div><div className="wk-strip-sub">{r.avoidableUsd === null ? "Valeur non estimable" : `≈ ${formatUsd(r.avoidableUsd)} de dépôts manqués`}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Déposé avec succès</div><div className="wk-strip-value">{formatUsd(r.depositedUsd)}</div><div className="wk-strip-sub">{r.blockedUsers.length} utilisateur(s) jamais aboutis</div></div>
      </div>

      <Signals items={r.signals} />

      <Section title="Pourquoi les dépôts échouent" hint="Les causes « évitable » dépendent de vous (configuration, validation) ; les autres du client ou du réseau.">
        <TableWrap>
          <thead><tr><Th>Cause</Th><Th right>Échecs</Th><Th right>Part</Th><Th>Évitable ?</Th><Th hideSm>Que faire</Th></tr></thead>
          <tbody>
            {r.causes.length === 0 ? <tr><Td colSpan={5}>Aucun échec sur la période.</Td></tr> : r.causes.map((c) => (
              <tr key={c.def.key}>
                <Td label="Cause">{c.def.label}</Td>
                <Td right label="Échecs">{formatNumber(c.count, 0)}</Td>
                <Td right label="Part">{formatPct(c.share, 0)}</Td>
                <Td label="Évitable ?"><Pill tone={c.def.fixable ? "bad" : "info"}>{c.def.fixable ? "Oui" : "Non"}</Pill></Td>
                <Td hideSm label="Que faire"><span style={{ color: "var(--muted)", fontSize: 13.5 }}>{c.def.hint}</span></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par prestataire" hint="Même période, mêmes règles : comparez la fiabilité.">
        <TableWrap>
          <thead><tr><Th>Prestataire</Th><Th right>Réussis</Th><Th right>Échoués</Th><Th right>Taux de réussite</Th></tr></thead>
          <tbody>
            {r.providers.length === 0 ? <tr><Td colSpan={4}>Aucune tentative.</Td></tr> : r.providers.map((p) => (
              <tr key={p.name}><Td label="Prestataire">{p.name}</Td><Td right label="Réussis">{p.ok}</Td><Td right label="Échoués">{p.ko}</Td><Td right label="Taux"><strong>{pct(p.rate)}</strong></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par pays" hint="« Non renseigné » regroupe les anciens dépôts sans pays enregistré.">
        <TableWrap>
          <thead><tr><Th>Pays</Th><Th right>Réussis</Th><Th right>Échoués</Th><Th right>Taux de réussite</Th></tr></thead>
          <tbody>
            {r.countries.length === 0 ? <tr><Td colSpan={4}>Aucune tentative.</Td></tr> : r.countries.map((p) => (
              <tr key={p.name}><Td label="Pays">{p.name}</Td><Td right label="Réussis">{p.ok}</Td><Td right label="Échoués">{p.ko}</Td><Td right label="Taux"><strong>{pct(p.rate)}</strong></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Évolution mensuelle">
        <TableWrap>
          <thead><tr><Th>Mois</Th><Th right>Réussis</Th><Th right>Échoués</Th><Th right>Taux de réussite</Th></tr></thead>
          <tbody>
            {r.months.length === 0 ? <tr><Td colSpan={4}>Aucune tentative.</Td></tr> : r.months.map((m) => (
              <tr key={m.key}><Td label="Mois">{monthLabel(m.key)}</Td><Td right label="Réussis">{m.ok}</Td><Td right label="Échoués">{m.ko}</Td><Td right label="Taux"><strong>{pct(m.rate)}</strong></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Utilisateurs bloqués" hint="Ont essayé de déposer, jamais réussi : à relancer ou à aider.">
        <TableWrap>
          <thead><tr><Th>Utilisateur</Th><Th right>Tentatives</Th><Th>Dernière cause</Th><Th hideSm>Dernier essai</Th></tr></thead>
          <tbody>
            {r.blockedUsers.length === 0 ? <tr><Td colSpan={4}>Aucun utilisateur bloqué.</Td></tr> : r.blockedUsers.map((u) => (
              <tr key={u.userId}><Td label="Utilisateur"><a href={`/dashboard/users/${u.userId}`}>{u.username}</a></Td><Td right label="Tentatives">{u.attempts}</Td><Td label="Dernière cause">{u.lastReason}</Td><Td hideSm label="Dernier essai">{formatDateTime(new Date(u.lastAt))}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      {r.outliers.length > 0 && (
        <Section title="Montants aberrants" hint={`Au-dessus du double du plafond configuré (${formatNumber(r.maxDeposit ?? 0, 0)} FCFA). Ils ne devraient jamais atteindre le prestataire.`}>
          <TableWrap>
            <thead><tr><Th>Utilisateur</Th><Th right>Montant (FCFA)</Th><Th>Issue</Th><Th hideSm>Date</Th></tr></thead>
            <tbody>
              {r.outliers.map((o, i) => (
                <tr key={i}><Td label="Utilisateur">{o.username}</Td><Td right label="Montant">{formatNumber(o.amount, 0)}</Td><Td label="Issue">{o.reason}</Td><Td hideSm label="Date">{formatDateTime(new Date(o.at))}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}

      <Section title="Du compte créé au premier gain" hint="Où les utilisateurs s'arrêtent dans leur parcours (toute la période, tous les utilisateurs).">
        <div className="wk-panel"><div className="wk-share">
          {r.activation.map((a, i) => (
            <div key={a.label} className="wk-share-row">
              <div className="wk-share-top"><span>{a.label}</span><span>{formatNumber(a.count, 0)}{i > 0 && r.activation[0].count > 0 ? ` · ${formatPct((a.count / r.activation[0].count) * 100, 0)} des comptes` : ""}</span></div>
              <div className="wk-share-track"><div className="wk-share-fill" style={{ width: `${(a.count / maxFunnel) * 100}%` }} /></div>
            </div>
          ))}
        </div></div>
      </Section>

      <p className="wk-hint">« Évitable » = causes liées à la configuration ou à la validation. La valeur estimée multiplie ces échecs par le dépôt médian réussi : c'est un ordre de grandeur, pas un manque à gagner exact.</p>
    </div>
  );
}
