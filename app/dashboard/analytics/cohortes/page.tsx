import { loadCohorts, type Granularity } from "@/lib/cohorts";
import { feeLabel } from "@/lib/fees";
import { formatNumber, formatPct, formatUsd, formatDateTime } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function cohortLabel(iso: string, g: Granularity): string {
  const [y, m, d] = iso.split("-").map(Number);
  return g === "month" ? `${MONTHS[m - 1]} ${y}` : `Sem. du ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function currentPeriodStart(g: Granularity): string {
  const now = new Date();
  if (g === "month") return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const day = (now.getUTCDay() + 6) % 7; // lundi = début de semaine (comme date_trunc)
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Dégradé de la teinte du dashboard : plus la valeur est haute, plus la case est foncée. */
function heat(pct: number): React.CSSProperties {
  const a = Math.min(Math.max(pct, 0), 100) / 100;
  return { background: `rgba(11, 85, 99, ${(a * 0.85).toFixed(3)})`, color: a > 0.45 ? "#fff" : "var(--fg)", textAlign: "center", fontVariantNumeric: "tabular-nums" };
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

function Choice({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <a className="wk-btn" href={href} style={active ? { fontWeight: 700, outline: "2px solid var(--line)" } : { opacity: 0.75 }}>{children}</a>;
}

export default async function CohortsPage({ searchParams }: { searchParams: { g?: string; d?: string } }) {
  const g: Granularity = searchParams.g === "week" ? "week" : "month";
  const d = [30, 60, 90].includes(Number(searchParams.d)) ? Number(searchParams.d) : 30;
  const r = await loadCohorts(g, d);
  const unit = g === "month" ? "M" : "S";
  const unitWord = g === "month" ? "mois" : "semaine";
  const maxPeriod = Math.max(0, ...r.retention.flatMap((row) => row.cells.map((c) => c.period)));
  const headers = Array.from({ length: maxPeriod + 1 }, (_, i) => i);
  const cur = currentPeriodStart(g);
  const curMonth = currentPeriodStart("month");

  const retRows = [...r.retention].reverse(); // plus récente en haut
  const ltvRows = [...r.ltv].reverse();
  const ltvMax = Math.max(0, ...r.ltv.flatMap((row) => row.cells.map((c) => c.cumulativePerUser)));
  const c = r.churn;
  const mo = r.monetization;

  // Rétention moyenne (pondérée par la taille des cohortes) aux périodes 1, 2 et 3, hors période en cours.
  const avgAt = (k: number) => {
    let act = 0, size = 0;
    for (const row of r.retention) {
      if (row.cohort === cur) continue;
      const cell = row.cells.find((x) => x.period === k);
      if (cell) { act += cell.active; size += row.size; }
    }
    return size > 0 ? (act / size) * 100 : null;
  };

  return (
    <div>
      <PageHeader title="Cohortes, churn et valeur vie" subtitle="Les utilisateurs que vous gagnez restent-ils, et rapportent-ils ? Un utilisateur est « actif » s'il a fait au moins une opération terminée de son initiative (dépôt, retrait, swap, jeu, staking, prêt, achat WAKATI). Récompenses, bonus et gains ne comptent pas." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.errors.length ? `Certaines données sont indisponibles : ${r.errors.join(" · ")}` : null} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 18px", alignItems: "center" }}>
        <span className="wk-hint">Cohortes par</span>
        <Choice href={`?g=month&d=${d}`} active={g === "month"}>Mois</Choice>
        <Choice href={`?g=week&d=${d}`} active={g === "week"}>Semaine</Choice>
        <span className="wk-hint" style={{ marginLeft: 12 }}>Inactif après</span>
        {[30, 60, 90].map((x) => <Choice key={x} href={`?g=${g}&d=${x}`} active={d === x}>{x} jours</Choice>)}
      </div>

      {c && (
        <div className="wk-strip">
          <Metric label="Taux d'activation" value={c.activationRatePct === null ? "—" : formatPct(c.activationRatePct)} sub={`${c.activated} sur ${c.totalUsers} inscrits ont déjà opéré`} tone={c.activationRatePct !== null && c.activationRatePct < 50 ? "warn" : "ok"} />
          <Metric label={`Actifs (${c.inactiveDays} j)`} value={formatNumber(c.active, 0)} sub={`dont ${c.atRisk} bientôt inactifs`} />
          <Metric label="Churn cumulé" value={c.churnRatePct === null ? "—" : formatPct(c.churnRatePct)} sub={`${c.churned} partis sur ${c.activated} activés`} tone={c.churnRatePct !== null && c.churnRatePct > 50 ? "warn" : "ok"} />
          <Metric label="Jamais activés" value={formatNumber(c.neverActivated, 0)} sub="inscrits sans aucune opération" tone={c.neverActivated > 0 ? "warn" : "ok"} />
        </div>
      )}

      <Section title="Rétention par cohorte" hint={`Part des inscrits d'une ${unitWord} qui ont été actifs ${g === "month" ? "chaque mois" : "chaque semaine"} suivant. ${unit}0 = la ${unitWord} d'inscription. Plus la case est foncée, mieux c'est.`}>
        {retRows.length === 0 ? <Empty text="Aucune cohorte à afficher." /> : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Cohorte</Th>
                  <Th right>Inscrits</Th>
                  {headers.map((h) => <Th key={h} right>{unit}{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {retRows.map((row) => (
                  <tr key={row.cohort}>
                    <Td label="Cohorte">{cohortLabel(row.cohort, g)}{row.cohort === cur ? " (en cours)" : ""}</Td>
                    <Td right label="Inscrits">{row.size}{row.size < 5 ? "*" : ""}</Td>
                    {headers.map((h) => {
                      const cell = row.cells.find((x) => x.period === h);
                      return cell ? <td key={h} style={heat(cell.pct)} title={`${cell.active} actif(s) sur ${row.size}`}>{formatNumber(cell.pct, 0)} %</td> : <td key={h} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="wk-hint" style={{ marginTop: 8 }}>
              * Moins de 5 inscrits : les pourcentages bougent beaucoup avec 1 seul utilisateur, à lire avec prudence.
              {avgAt(1) !== null && <> Rétention moyenne (cohortes terminées) : {formatPct(avgAt(1) as number, 0)} à {unit}1{avgAt(2) !== null ? `, ${formatPct(avgAt(2) as number, 0)} à ${unit}2` : ""}{avgAt(3) !== null ? `, ${formatPct(avgAt(3) as number, 0)} à ${unit}3` : ""}.</>}
            </div>
          </>
        )}
      </Section>

      <Section title="Churn mensuel" hint="Parmi les actifs du mois précédent, combien ne sont plus actifs ce mois-ci. « Réactivés » = revenus après une pause.">
        {r.churnMonths.length === 0 ? <Empty text="Pas assez de données." /> : (
          <TableWrap>
            <thead>
              <tr><Th>Mois</Th><Th right>Actifs</Th><Th right>Nouveaux</Th><Th right>Restés</Th><Th right>Réactivés</Th><Th right>Partis</Th><Th right>Churn</Th></tr>
            </thead>
            <tbody>
              {[...r.churnMonths].reverse().map((m) => (
                <tr key={m.month}>
                  <Td label="Mois">{cohortLabel(m.month, "month")}{m.month === curMonth ? " (en cours)" : ""}</Td>
                  <Td right label="Actifs">{m.active}</Td>
                  <Td right label="Nouveaux">{m.newUsers}</Td>
                  <Td right label="Restés">{m.retained}</Td>
                  <Td right label="Réactivés">{m.reactivated}</Td>
                  <Td right label="Partis">{m.churned}</Td>
                  <Td right label="Churn">{m.churnRatePct === null ? "—" : formatPct(m.churnRatePct)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-hint" style={{ marginTop: 8 }}>Le mois en cours n'est pas terminé : son churn paraît élevé parce que certains utilisateurs n'ont pas encore eu le temps de revenir.</div>
      </Section>

      <Section title="Valeur vie par cohorte (LTV)" hint={`Frais cumulés rapportés à chaque inscrit de la cohorte, ${unitWord} après ${unitWord} depuis l'inscription. Frais réels uniquement (hors tests, hors mises des jeux), valorisés au cours actuel. À ne pas confondre avec le LTV (loan-to-value) de la page Crédit.`}>
        {r.feesSince && (
          <div className="wk-alert-warn" style={{ marginBottom: 12 }}>
            Les frais ne sont enregistrés en base qu'à partir du {r.feesSince}. Pour les cohortes plus anciennes, la valeur affichée est partielle : le revenu d'avant cette date n'existe pas.
          </div>
        )}
        {ltvRows.length === 0 ? <Empty text="Aucune cohorte à afficher." /> : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Cohorte</Th>
                <Th right>Inscrits</Th>
                {headers.map((h) => <Th key={h} right>{unit}{h}</Th>)}
                <Th right>Total</Th>
              </tr>
            </thead>
            <tbody>
              {ltvRows.map((row) => (
                <tr key={row.cohort}>
                  <Td label="Cohorte">{cohortLabel(row.cohort, g)}{row.cohort === cur ? " (en cours)" : ""}</Td>
                  <Td right label="Inscrits">{row.size}{row.size < 5 ? "*" : ""}</Td>
                  {headers.map((h) => {
                    const cell = row.cells.find((x) => x.period === h);
                    if (!cell) return <td key={h} />;
                    const pct = ltvMax > 0 ? (cell.cumulativePerUser / ltvMax) * 100 : 0;
                    return <td key={h} style={heat(pct)} title={`${cell.payers} payant(s) à cette période · ${formatUsd(cell.revenueUsd)} ce ${unitWord}-là`}>{cell.cumulativePerUser === 0 ? "—" : formatUsd(cell.cumulativePerUser)}</td>;
                  })}
                  <Td right label="Total">{formatUsd(row.totalUsd)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-hint" style={{ marginTop: 8 }}>Chaque case = frais cumulés par inscrit jusqu'à cette période (une valeur qui monte = la cohorte continue de rapporter). La colonne « Total » est le revenu total de la cohorte.</div>
      </Section>

      <Section title="Monétisation" hint="D'où vient le revenu, et sur combien d'utilisateurs il repose (tout l'historique disponible).">
        {!mo ? <Empty text="Données indisponibles." /> : (
          <>
            <div className="wk-strip">
              <Metric label="Revenu (frais réels)" value={formatUsd(mo.revenueUsd)} sub={r.feesSince ? `depuis le ${r.feesSince}` : "tout l'historique"} />
              <Metric label="Utilisateurs payants" value={`${mo.payers} / ${mo.totalUsers}`} sub={mo.payerRatePct === null ? "—" : `${formatPct(mo.payerRatePct)} des inscrits`} tone={mo.payerRatePct !== null && mo.payerRatePct < 25 ? "warn" : "ok"} />
              <Metric label="Revenu moyen / inscrit" value={mo.arpuUsd === null ? "—" : formatUsd(mo.arpuUsd)} sub="ARPU" />
              <Metric label="Revenu moyen / payant" value={mo.arppuUsd === null ? "—" : formatUsd(mo.arppuUsd)} sub="ARPPU" />
            </div>
            <div style={{ marginTop: 14 }}>
              {mo.top1SharePct !== null && mo.top1SharePct > 50 && (
                <div className="wk-alert-warn" style={{ marginBottom: 12 }}>
                  Concentration forte : le premier utilisateur fournit {formatPct(mo.top1SharePct, 0)} du revenu, les 5 premiers {mo.top5SharePct === null ? "—" : formatPct(mo.top5SharePct, 0)}. Perdre un seul gros payant ferait chuter vos frais.
                </div>
              )}
              {mo.byType.length === 0 ? <Empty text="Aucun frais réel enregistré." /> : (
                <TableWrap>
                  <thead><tr><Th>Type de frais</Th><Th right>Revenu</Th><Th right>Part</Th><Th right>Payants</Th><Th right hideSm>Opérations</Th></tr></thead>
                  <tbody>
                    {mo.byType.map((t) => (
                      <tr key={t.feeType}>
                        <Td label="Type">{feeLabel(t.feeType)}</Td>
                        <Td right label="Revenu">{formatUsd(t.revenueUsd)}</Td>
                        <Td right label="Part">{mo.revenueUsd > 0 ? formatPct((t.revenueUsd / mo.revenueUsd) * 100) : "—"}</Td>
                        <Td right label="Payants">{t.payers}</Td>
                        <Td right hideSm label="Opérations">{t.ops}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              {mo.unpricedAssets.length > 0 && <div className="wk-hint" style={{ marginTop: 8 }}>Sans prix valide, donc exclus du revenu : {mo.unpricedAssets.join(", ")}.</div>}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
