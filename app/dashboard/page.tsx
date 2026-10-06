import { formatCompactNumber, formatCompactUsd, formatDateTime, formatNumber, formatUsd, formatPct, shortId } from "@/lib/format";
import { txStatusLabel, txStatusTone, txTypeLabel } from "@/lib/transactions";
import { PageHeader, Section, TableWrap, Th, Td, Pill, ErrorNote } from "@/components/ui";
import { loadOverviewMetrics } from "@/lib/metrics";
import type { RecentTransaction, UserAssetMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const EPS = 0.00000001;

type Day = { key: string; label: string; volume: number; count: number };
type Alert = { tone: "bad" | "warn" | "info"; text: string };

function makeDays(now: number): Day[] {
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(now - (6 - index) * DAY);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" }), volume: 0, count: 0 };
  });
}

export default async function DashboardOverviewPage() {
  const metrics = await loadOverviewMetrics();

  const days = makeDays(Date.now());
  const volumeDays = metrics.volume.byDay.length ? metrics.volume.byDay : days.map((d) => ({ key: d.key, volume: 0, count: 0 }));
  const volume24h = metrics.volume.volume24h;
  const volume7d = metrics.volume.volume7d;
  const count7d = metrics.volume.transactionCount7d;

  const totalUsers = metrics.users.totalUsers;
  const active7d = metrics.users.activeUsers7d;
  const new7d = metrics.users.newUsers7d;

  const heldUsd = metrics.liquidity.heldUsd;
  const owedUsd = metrics.liquidity.owedUsd;
  const coveragePct = metrics.liquidity.coveragePct;
  const missingUsd = metrics.liquidity.missingUsd;
  const feesUsd = metrics.fees.totalUsd;
  const feesUnpriced = metrics.fees.unpriced;

  const pendingCount = metrics.risk.pendingTransactions;
  const failedCount = metrics.risk.failedTransactions24h;
  const atRisk = metrics.risk.loansAtRisk;
  const alerts: Alert[] = [];

  if (missingUsd > 0.01) alerts.push({ tone: "bad", text: `Il manque environ ${formatUsd(missingUsd)} pour couvrir les passifs valorisés.` });
  if (metrics.liquidity.unpriced.length > 0) alerts.push({ tone: "warn", text: `Sans prix valide (exclus de la valorisation) : ${metrics.liquidity.unpriced.join(", ")}.` });
  if (pendingCount > 0) alerts.push({ tone: "warn", text: `${pendingCount} transaction(s) sont en attente.` });
  if (failedCount > 0) alerts.push({ tone: "warn", text: `${failedCount} transaction(s) ont échoué pendant les dernières 24 heures.` });
  if (atRisk > 0) alerts.push({ tone: "bad", text: `${atRisk} prêt(s) sont proches de la liquidation.` });
  if (metrics.risk.reconciliationIssues.length > 0) {
    alerts.push({ tone: "bad", text: `${metrics.risk.reconciliationIssues.length} issue(s) de rapprochement détectées.` });
  }
  if (alerts.length === 0) alerts.push({ tone: "info", text: "Aucune alerte critique détectée par les contrôles disponibles." });

  const queryErrors = metrics.errors ?? null;

  return <div>
    <PageHeader title="Vue d'ensemble" subtitle="État opérationnel et financier de la plateforme, actif par actif." updatedAt={formatDateTime(new Date())} />
    <ErrorNote text={queryErrors ? `Certaines données sont indisponibles : ${queryErrors}` : null} />
    <div className="wk-strip"><Metric label="Actifs valorisés" value={formatCompactUsd(heldUsd)} sub="Réserves connues" /><Metric label="Passifs valorisés" value={formatCompactUsd(owedUsd)} sub="Dû aux utilisateurs" /><Metric label="Couverture" value={coveragePct === null ? "—" : formatPct(coveragePct)} sub={missingUsd > 0 ? `Manque : ${formatCompactUsd(missingUsd)}` : metrics.liquidity.unpriced.length ? `${metrics.liquidity.unpriced.length} actif(s) non valorisé(s)` : "Actifs couverts"} tone={coveragePct === null ? undefined : coveragePct >= 100 ? "ok" : "bad"} /><Metric label="Frais cumulés" value={formatCompactUsd(feesUsd)} sub={feesUnpriced.length ? `hors ${feesUnpriced.join(", ")} (sans prix)` : "depuis le début"} /></div>
    <div className="wk-strip" style={{ marginTop: 12 }}><Metric label="Utilisateurs" value={formatCompactNumber(totalUsers)} sub={`${active7d} actifs sur 7 jours`} /><Metric label="Nouveaux utilisateurs" value={formatCompactNumber(new7d)} sub="Sur les 7 derniers jours" /><Metric label="Volume du jour" value={formatCompactUsd(volume24h)} sub="Jour UTC en cours" /><Metric label="Volume 7 jours" value={formatCompactUsd(volume7d)} sub={`${formatCompactNumber(count7d)} transaction(s)`} /></div>
    <div className="wk-grid-2" style={{ marginTop: 18 }}><Section title="Alertes opérationnelles"><div className="wk-panel">{alerts.map((alert, index) => <div key={`${alert.text}-${index}`} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: index < alerts.length - 1 ? "1px solid var(--line)" : undefined }}><span className={`wk-dot wk-dot-${alert.tone}`} style={{ marginTop: 6 }} /><span>{alert.text}</span></div>)}</div></Section><Section title="File de traitement"><div className="wk-panel"><QueueRow label="Transactions en attente" value={pendingCount} href="/dashboard/transactions?status=pending" tone={pendingCount ? "warn" : "ok"} /><QueueRow label="Échecs sur 24 heures" value={failedCount} href="/dashboard/transactions?status=failed" tone={failedCount ? "bad" : "ok"} /><QueueRow label="Prêts à risque" value={atRisk} href="/dashboard/credit" tone={atRisk ? "bad" : "ok"} /><QueueRow label="Actifs suivis" value={metrics.activeAssetCount} href="/dashboard/treasury" tone="info" /></div></Section></div>
    <Section title="Actifs des utilisateurs" hint="Chaque actif actif est agrégé séparément. Aucune devise n'est mélangée dans les quantités."><AssetTable rows={metrics.assets} /></Section>
    <Section title="Flux réels" hint={`Dépôts, retraits, swaps et transferts réussis des 7 derniers jours, valorisés au cours actuel. Mises de jeux : ${formatUsd(metrics.volume.gamesWagered7d)} (non incluses).`}><VolumeChart days={volumeDays as Day[]} /></Section>
    <Section title="Frais par actif" hint="Part de chaque actif dans les frais gagnés (valorisés en USD quand le prix est valide).">{metrics.fees.byAsset.length === 0 ? <div className="wk-panel">Aucun frais collecté.</div> : <div className="wk-panel"><div className="wk-share">{metrics.fees.byAsset.map((f) => <div key={f.asset} className="wk-share-row"><div className="wk-share-top"><span className="wk-asset">{f.asset}</span><span>{f.usd === null ? `${formatNumber(f.total)} (sans prix)` : formatUsd(f.usd)}</span></div><div className="wk-share-track"><div className="wk-share-fill" style={{ width: `${feesUsd > 0 && f.usd !== null ? (f.usd / feesUsd) * 100 : 0}%` }} /></div></div>)}</div></div>}</Section>
    <Section title="Dernières transactions" hint="Les huit opérations les plus récentes."><RecentTable rows={metrics.recentTransactions} /></Section>
  </div>;
}

function AssetTable({ rows }: { rows: UserAssetMetrics[] }) { return <TableWrap><thead><tr><Th>Actif</Th><Th right>Utilisateurs</Th><Th right>Total</Th><Th right>Disponible</Th><Th right>Bloqué</Th><Th right>Valeur USD</Th></tr></thead><tbody>{rows.length === 0 ? <tr><Td colSpan={6}>Aucun solde utilisateur.</Td></tr> : rows.map((row) => <tr key={row.asset}><Td><span className="wk-asset">{row.asset}</span></Td><Td right label="Utilisateurs">{formatCompactNumber(row.users)}</Td><Td right label="Total">{formatNumber(row.totalNative)}</Td><Td right label="Disponible">{formatNumber(row.availableNative)}</Td><Td right label="Bloqué">{formatNumber(row.stakingNative + row.pendingNative)}</Td><Td right label="Valeur USD">{row.valueUsd === null ? "Sans prix" : formatUsd(row.valueUsd)}</Td></tr>)}</tbody></TableWrap>; }
function RecentTable({ rows }: { rows: RecentTransaction[] }) { if (rows.length === 0) return <div className="wk-panel">Aucune transaction récente.</div>; return <TableWrap><thead><tr><Th>Date</Th><Th>Utilisateur</Th><Th>Type</Th><Th right>Montant</Th><Th>Statut</Th></tr></thead><tbody>{rows.map((t) => <tr key={t.id}><Td label="Date">{formatDateTime(new Date(t.createdAt))}</Td><Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${t.userId}`}>{shortId(t.userId)}</a></Td><Td label="Type">{txTypeLabel(t.type)}</Td><Td right label="Montant">{formatNumber(t.amount)} <span className="wk-asset-sub">{t.asset}</span></Td><Td label="Statut"><Pill tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Pill></Td></tr>)}</tbody></TableWrap>; }
function Metric({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone?: "ok" | "bad" }) { return <div className="wk-strip-item"><div className="wk-strip-label">{label}</div><div className={`wk-strip-value${tone ? ` wk-${tone}` : ""}`}>{value}</div><div className="wk-strip-sub">{sub}</div></div>; }
function QueueRow({ label, value, href, tone }: { label: string; value: number; href: string; tone: "ok" | "warn" | "bad" | "info" }) { return <a href={href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line)", color: "inherit", textDecoration: "none" }}><span>{label}</span><Pill tone={tone}>{value}</Pill></a>; }
function VolumeChart({ days }: { days: Day[] }) { const max = Math.max(...days.map((day) => day.volume), 1); return <div className="wk-panel" style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 220, padding: "24px 18px 16px" }}>{days.map((day) => <div key={day.key} title={`${day.label} : ${formatUsd(day.volume)}`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 8 }}><div style={{ width: "100%", maxWidth: 54, height: `${Math.max((day.volume / max) * 100, day.volume > 0 ? 4 : 1)}%`, minHeight: 3, background: "var(--accent)", borderRadius: "5px 5px 2px 2px" }} /><span className="wk-asset-sub">{day.label}</span></div>)}</div>; }
