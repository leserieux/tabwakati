import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { formatNumber, formatUsd } from "@/lib/format";
import { PageTitle, SectionTitle, Kpi, KpiGrid, Alert, TableShell, Th, Td, EmptyState, ErrorBox } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

export default async function OverviewPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const since24h = new Date(now - DAY).toISOString();
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const [prices, users, txs, staking, loans, recon, fees, paused, stuck, sweepIssues, failed24h] = await Promise.all([
    loadPrices(),
    q<any>(db.from("admin_users_overview").select("id, is_verified, portfolio_value_usd, total_staked_usd, last_activity_at, created_at")),
    q<any>(db.from("admin_transactions_overview").select("day, type, transaction_count, total_amount_usd, completed_count, pending_count, failed_count").gte("day", since7d.slice(0, 10))),
    q<any>(db.from("admin_staking_overview").select("total_staked_usd, active_stakers, is_active")),
    q<any>(db.from("admin_loans_dashboard").select("prets_actifs, prets_a_risque, total_emprunte_actif")),
    db.rpc("get_admin_reconciliation"),
    db.rpc("get_platform_fees_totals"),
    q<any>(db.from("supported_assets").select("symbol, network").eq("can_be_deposited", false)),
    q<any>(db.from("transactions").select("id").in("status", ["pending", "processing"]).lt("created_at", stuckBefore)),
    q<any>(db.from("sweep_log").select("id").neq("status", "swept").eq("dry_run", false).gte("created_at", since7d)),
    q<any>(db.from("transactions").select("id").eq("status", "failed").gte("created_at", since24h))
  ]);

  const userRows = users.rows;
  const totalUsers = userRows.length;
  const verified = userRows.filter((u) => u.is_verified).length;
  const newUsers7d = userRows.filter((u) => u.created_at >= since7d).length;
  const active7d = userRows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const portfolioUsd = userRows.reduce((n, u) => n + Number(u.portfolio_value_usd || 0), 0);

  const txRows = txs.rows;
  const tx7d = txRows.reduce((n, t) => n + Number(t.transaction_count || 0), 0);
  const failed7d = txRows.reduce((n, t) => n + Number(t.failed_count || 0), 0);
  const volume7dUsd = txRows.reduce((n, t) => n + Number(t.total_amount_usd || 0), 0);

  const byType = new Map<string, { n: number; usd: number; failed: number; pending: number }>();
  for (const t of txRows) {
    const e = byType.get(t.type) || { n: 0, usd: 0, failed: 0, pending: 0 };
    e.n += Number(t.transaction_count || 0);
    e.usd += Number(t.total_amount_usd || 0);
    e.failed += Number(t.failed_count || 0);
    e.pending += Number(t.pending_count || 0);
    byType.set(t.type, e);
  }
  const typeRows = [...byType.entries()].sort((a, b) => b[1].usd - a[1].usd);

  const stakedUsd = staking.rows.reduce((n, s) => n + Number(s.total_staked_usd || 0), 0);
  const stakers = staking.rows.reduce((n, s) => n + Number(s.active_stakers || 0), 0);
  const loansActive = loans.rows.reduce((n, l) => n + Number(l.prets_actifs || 0), 0);
  const loansRisk = loans.rows.reduce((n, l) => n + Number(l.prets_a_risque || 0), 0);

  const reconRows = ((recon.data as any[]) || []);
  const liabilityUsd = reconRows.reduce((n, r) => n + Number(r.liability_fn || 0) * (prices.get(r.asset_symbol) ?? 0), 0);
  const orphans = reconRows.filter((r) => Math.abs(Number(r.staking_orphan)) > 0.00000001);
  const negatives = reconRows.filter((r) => Number(r.negative_rows) > 0);
  const diffs = reconRows.filter((r) => Math.abs(Number(r.liability_diff)) > 0.00000001);

  const feesUsd = ((fees.data as any[]) || []).reduce((n, f) => n + Number(f.total_fees || 0) * (prices.get(f.asset_symbol) ?? 0), 0);

  const alerts: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  if (diffs.length) alerts.push({ tone: "bad", text: `Incohérence entre user_balances et get_asset_liabilities : ${diffs.map((d) => d.asset_symbol).join(", ")}.` });
  if (negatives.length) alerts.push({ tone: "bad", text: `Soldes négatifs détectés : ${negatives.map((d) => d.asset_symbol).join(", ")}.` });
  for (const o of orphans) alerts.push({ tone: "warn", text: `${formatNumber(Number(o.staking_orphan))} ${o.asset_symbol} en staking_balance sans stake actif correspondant.` });
  if (loansRisk > 0) alerts.push({ tone: "bad", text: `${loansRisk} prêt(s) à risque de liquidation.` });
  if (stuck.rows.length) alerts.push({ tone: "warn", text: `${stuck.rows.length} transaction(s) en attente depuis plus d'1 h.` });
  if (sweepIssues.rows.length) alerts.push({ tone: "warn", text: `${sweepIssues.rows.length} balayage(s) en échec sur 7 jours.` });
  if (paused.rows.length) alerts.push({ tone: "info", text: `Dépôts suspendus : ${paused.rows.map((p) => `${p.symbol} (${p.network})`).join(", ")}.` });

  const errors = [users.error, txs.error, staking.error, loans.error, recon.error?.message, fees.error?.message].filter(Boolean) as string[];

  return (
    <div>
      <PageTitle title="Vue d'ensemble" subtitle="Indicateurs clés et alertes, calculés depuis la base. Données rafraîchies à chaque chargement." />
      {errors.map((e, i) => <ErrorBox key={i} text={e} />)}

      <SectionTitle>Alertes</SectionTitle>
      {alerts.length === 0 ? <Alert tone="info">Aucune alerte.</Alert> : alerts.map((a, i) => <Alert key={i} tone={a.tone}>{a.text}</Alert>)}

      <SectionTitle>Utilisateurs</SectionTitle>
      <KpiGrid>
        <Kpi label="Utilisateurs" value={String(totalUsers)} sub={`${newUsers7d} nouveaux (7 j)`} />
        <Kpi label="Actifs (7 j)" value={String(active7d)} sub={totalUsers ? `${Math.round((active7d / totalUsers) * 100)} % des utilisateurs` : undefined} />
        <Kpi label="Vérifiés" value={String(verified)} sub={totalUsers ? `${Math.round((verified / totalUsers) * 100)} %` : undefined} />
        <Kpi label="Valeur des portefeuilles" value={formatUsd(portfolioUsd)} />
      </KpiGrid>

      <SectionTitle>Argent et activité</SectionTitle>
      <KpiGrid>
        <Kpi label="Dû aux utilisateurs" value={formatUsd(liabilityUsd)} sub="tous actifs, en USD" />
        <Kpi label="Frais collectés" value={formatUsd(feesUsd)} sub="depuis le début" />
        <Kpi label="Volume (7 j)" value={formatUsd(volume7dUsd)} sub={`${tx7d} transactions`} />
        <Kpi label="Échecs (7 j)" value={String(failed7d)} sub={`${failed24h.rows.length} sur 24 h`} tone={failed7d > 0 ? "warn" : "ok"} />
        <Kpi label="Staké" value={formatUsd(stakedUsd)} sub={`${stakers} staker(s)`} />
        <Kpi label="Prêts actifs" value={String(loansActive)} sub={`${loansRisk} à risque`} tone={loansRisk > 0 ? "bad" : undefined} />
      </KpiGrid>

      <SectionTitle hint="7 derniers jours, par type de transaction">Transactions</SectionTitle>
      {typeRows.length === 0 ? (
        <EmptyState text="Aucune transaction sur 7 jours." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Type</Th>
              <Th align="right">Nombre</Th>
              <Th align="right">Volume (USD)</Th>
              <Th align="right">En attente</Th>
              <Th align="right">Échecs</Th>
            </tr>
          </thead>
          <tbody>
            {typeRows.map(([type, e]) => (
              <tr key={type} style={{ borderTop: "1px solid #334155" }}>
                <Td><strong style={{ color: "#f8fafc" }}>{type}</strong></Td>
                <Td align="right">{e.n}</Td>
                <Td align="right">{formatUsd(e.usd)}</Td>
                <Td align="right">{e.pending}</Td>
                <Td align="right"><span style={{ color: e.failed > 0 ? "#fbbf24" : undefined }}>{e.failed}</span></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
