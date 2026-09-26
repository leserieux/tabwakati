import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { loadUserAssetSummaries } from "@/lib/assets";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatNumber, formatUsd, formatPct, shortId } from "@/lib/format";
import { txStatusLabel, txStatusTone, txTypeLabel } from "@/lib/transactions";
import { PageHeader, Section, TableWrap, Th, Td, Pill, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const EPS = 0.00000001;
type Day = { key: string; label: string; volume: number; count: number };
type RecentTx = { id: string; user_id: string; type: string; asset_symbol: string; amount: number; status: string | null; created_at: string };
type Alert = { tone: "bad" | "warn" | "info"; text: string };

function makeDays(now: number): Day[] {
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(now - (6 - index) * DAY);
    return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" }), volume: 0, count: 0 };
  });
}

export default async function DashboardOverviewPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since24h = new Date(now - DAY).toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const days = makeDays(now);
  const [users, volume, loans, recent, wallets, liabilities, assets, recon, fees, pending, failed] = await Promise.all([
    q<any>(db.from("admin_users_overview").select("id, username, created_at, last_activity_at")),
    q<any>(db.from("admin_transactions_overview").select("day, transaction_count, total_amount_usd").gte("day", days[0].key)),
    q<{ loans_a_risque: number; score_loans_a_risque: number }>(db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque")),
    q<RecentTx>(db.from("transactions").select("id, user_id, type, asset_symbol, amount, status, created_at").order("created_at", { ascending: false }).limit(8)),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance")),
    q<any>(db.rpc("get_asset_liabilities")),
    loadUserAssetSummaries(),
    db.rpc("get_admin_reconciliation"),
    db.rpc("get_platform_fees_totals"),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h)
  ]);

  for (const row of volume.rows) {
    const day = days.find((item) => item.key === String(row.day).slice(0, 10));
    if (day) { day.volume = Number(row.total_amount_usd || 0); day.count = Number(row.transaction_count || 0); }
  }
  const totalUsers = users.rows.length;
  const active7d = users.rows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const new7d = users.rows.filter((u) => u.created_at && u.created_at >= since7d).length;
  const volume24h = days[days.length - 1].volume;
  const volume7d = days.reduce((sum, d) => sum + d.volume, 0);
  const count7d = days.reduce((sum, d) => sum + d.count, 0);
  const creditSummary = loans.rows[0];
  const atRisk = Number(creditSummary?.loans_a_risque || 0) + Number(creditSummary?.score_loans_a_risque || 0);
  const pendingCount = pending.count || 0;
  const failedCount = failed.count || 0;
  const priceOf = (asset: string) => assets.rows.find((row) => row.asset === asset)?.priceUsd ?? null;

  const walletByAsset = new Map(wallets.rows.map((row) => [String(row.asset_symbol), Number(row.balance || 0)]));
  let heldUsd = 0, owedUsd = 0, coveredUsd = 0;
  for (const row of wallets.rows) { const price = priceOf(String(row.asset_symbol)); if (price !== null) heldUsd += Number(row.balance || 0) * price; }
  for (const row of liabilities.rows) {
    const asset = String(row.asset_symbol); const price = priceOf(asset); if (price === null) continue;
    const owe = Number(row.total_liability || 0) * price; const held = (walletByAsset.get(asset) || 0) * price;
    owedUsd += owe; coveredUsd += Math.min(held, owe);
  }
  const coveragePct = owedUsd > 0 ? (coveredUsd / owedUsd) * 100 : 100;
  const missingUsd = Math.max(owedUsd - coveredUsd, 0);
  const feesUsd = ((fees.data as any[]) || []).reduce((sum, row) => sum + Number(row.total_fees || 0) * (priceOf(String(row.asset_symbol)) || 0), 0);
  const alerts: Alert[] = [];
  if (missingUsd > 0.01) alerts.push({ tone: "bad", text: `Il manque environ ${formatUsd(missingUsd)} pour couvrir les passifs valorisés.` });
  if (pendingCount > 0) alerts.push({ tone: "warn", text: `${pendingCount} transaction(s) sont en attente.` });
  if (failedCount > 0) alerts.push({ tone: "warn", text: `${failedCount} transaction(s) ont échoué pendant les dernières 24 heures.` });
  if (atRisk > 0) alerts.push({ tone: "bad", text: `${atRisk} prêt(s) sont proches de la liquidation.` });
  for (const row of ((recon.data as any[]) || [])) if (Math.abs(Number(row.liability_diff || 0)) > EPS) alerts.push({ tone: "bad", text: `${row.asset_symbol} présente un écart de rapprochement.` });
  if (alerts.length === 0) alerts.push({ tone: "info", text: "Aucune alerte critique détectée par les contrôles disponibles." });

  const userIds = [...new Set(recent.rows.map((row) => row.user_id).filter(Boolean))];
  const names = userIds.length ? await q<any>(db.from("admin_users_overview").select("id, username").in("id", userIds)) : { rows: [] as any[] };
  const nameOf = new Map(names.rows.map((row) => [row.id, row.username || "Sans pseudo"]));
  const queryErrors = [users.error, volume.error, loans.error, recent.error, wallets.error, liabilities.error, assets.error, recon.error?.message, fees.error?.message].filter(Boolean).join(" · ");

  return <div>
    <PageHeader title="Vue d'ensemble" subtitle="État opérationnel et financier de la plateforme, actif par actif." updatedAt={formatDateTime(new Date())} />
    <ErrorNote text={queryErrors ? `Certaines données sont indisponibles : ${queryErrors}` : null} />
    <div className="wk-strip"><Metric label="Actifs valorisés" value={formatCompactUsd(heldUsd)} sub="Réserves connues" /><Metric label="Passifs valorisés" value={formatCompactUsd(owedUsd)} sub="Dû aux utilisateurs" /><Metric label="Couverture" value={formatPct(coveragePct)} sub={missingUsd > 0 ? `Manque : ${formatCompactUsd(missingUsd)}` : "Actifs couverts"} tone={coveragePct >= 100 ? "ok" : "bad"} /><Metric label="Frais cumulés" value={formatCompactUsd(feesUsd)} sub="Selon les données disponibles" /></div>
    <div className="wk-strip" style={{ marginTop: 12 }}><Metric label="Utilisateurs" value={formatCompactNumber(totalUsers)} sub={`${active7d} actifs sur 7 jours`} /><Metric label="Nouveaux utilisateurs" value={formatCompactNumber(new7d)} sub="Sur les 7 derniers jours" /><Metric label="Volume 24 h" value={formatCompactUsd(volume24h)} sub="Dernier jour" /><Metric label="Volume 7 jours" value={formatCompactUsd(volume7d)} sub={`${formatCompactNumber(count7d)} transaction(s)`} /></div>
    <div className="wk-grid-2" style={{ marginTop: 18 }}><Section title="Alertes opérationnelles"><div className="wk-panel">{alerts.map((alert, index) => <div key={`${alert.text}-${index}`} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: index < alerts.length - 1 ? "1px solid var(--line)" : undefined }}><span className={`wk-dot wk-dot-${alert.tone}`} style={{ marginTop: 6 }} /><span>{alert.text}</span></div>)}</div></Section><Section title="File de traitement"><div className="wk-panel"><QueueRow label="Transactions en attente" value={pendingCount} href="/dashboard/transactions?status=pending" tone={pendingCount ? "warn" : "ok"} /><QueueRow label="Échecs sur 24 heures" value={failedCount} href="/dashboard/transactions?status=failed" tone={failedCount ? "bad" : "ok"} /><QueueRow label="Prêts à risque" value={atRisk} href="/dashboard/credit" tone={atRisk ? "bad" : "ok"} /><QueueRow label="Actifs suivis" value={assets.rows.length} href="/dashboard/treasury" tone="info" /></div></Section></div>
    <Section title="Actifs des utilisateurs" hint="Chaque actif actif est agrégé séparément. Aucune devise n'est mélangée dans les quantités."><AssetTable rows={assets.rows} /></Section>
    <Section title="Volume des transactions" hint="Volume valorisé en dollars sur les 7 derniers jours."><VolumeChart days={days} /></Section>
    <Section title="Dernières transactions" hint="Les huit opérations les plus récentes.">{recent.rows.length === 0 ? <div className="wk-panel">Aucune transaction récente.</div> : <TableWrap><thead><tr><Th>Date</Th><Th>Utilisateur</Th><Th>Type</Th><Th right>Montant</Th><Th>Statut</Th></tr></thead><tbody>{recent.rows.map((row) => <tr key={row.id}><Td label="Date">{formatDateTime(new Date(row.created_at))}</Td><Td label="Utilisateur"><div className="wk-asset">{nameOf.get(row.user_id) || "Sans pseudo"}</div><div className="wk-asset-sub">{shortId(row.user_id)}</div></Td><Td label="Type">{txTypeLabel(row.type)}</Td><Td right label="Montant">{formatNumber(Number(row.amount))} <span className="wk-asset-sub">{row.asset_symbol}</span></Td><Td label="Statut"><Pill tone={txStatusTone(row.status)}>{txStatusLabel(row.status)}</Pill></Td></tr>)}</tbody></TableWrap>}</Section>
  </div>;
}

function AssetTable({ rows }: { rows: Awaited<ReturnType<typeof loadUserAssetSummaries>>["rows"] }) { return <TableWrap><thead><tr><Th>Actif</Th><Th right>Utilisateurs</Th><Th right>Total</Th><Th right>Disponible</Th><Th right>Bloqué</Th><Th right>Valeur USD</Th></tr></thead><tbody>{rows.length === 0 ? <tr><Td colSpan={6 as any}>Aucun solde utilisateur.</Td></tr> : rows.map((row) => <tr key={row.asset}><Td><span className="wk-asset">{row.asset}</span></Td><Td right label="Utilisateurs">{formatCompactNumber(row.users)}</Td><Td right label="Total">{formatNumber(row.total)}</Td><Td right label="Disponible">{formatNumber(row.available)}</Td><Td right label="Bloqué">{formatNumber(row.staking + row.pending)}</Td><Td right label="Valeur USD">{row.valueUsd === null ? "—" : formatUsd(row.valueUsd)}</Td></tr>)}</tbody></TableWrap>; }
function Metric({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone?: "ok" | "bad" }) { return <div className="wk-strip-item"><div className="wk-strip-label">{label}</div><div className={`wk-strip-value${tone ? ` wk-${tone}` : ""}`}>{value}</div><div className="wk-strip-sub">{sub}</div></div>; }
function QueueRow({ label, value, href, tone }: { label: string; value: number; href: string; tone: "ok" | "warn" | "bad" | "info" }) { return <a href={href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--line)", color: "inherit", textDecoration: "none" }}><span>{label}</span><Pill tone={tone}>{value}</Pill></a>; }
function VolumeChart({ days }: { days: Day[] }) { const max = Math.max(...days.map((day) => day.volume), 1); return <div className="wk-panel" style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 220, padding: "24px 18px 16px" }}>{days.map((day) => <div key={day.key} title={`${day.label} : ${formatUsd(day.volume)}`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 8 }}><div style={{ width: "100%", maxWidth: 54, height: `${Math.max((day.volume / max) * 100, day.volume > 0 ? 4 : 1)}%`, minHeight: 3, background: "var(--accent)", borderRadius: "5px 5px 2px 2px" }} /><span className="wk-asset-sub">{day.label}</span></div>)}</div>; }
