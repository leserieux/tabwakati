import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { formatNumber, formatUsd, formatDate, shortId } from "@/lib/format";
import { PageTitle, SectionTitle, TableShell, Th, Td, Badge, EmptyState, ErrorBox } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EPS = 0.00000001;

export default async function RisksPage() {
  const db = getSupabaseAdmin();

  const [recon, loans, health, staking, prices] = await Promise.all([
    db.rpc("get_admin_reconciliation"),
    q<any>(db.from("admin_loans_dashboard").select("*")),
    q<any>(db.from("v_active_loans_health").select("loan_id, user_id, collateral_asset, borrow_asset, debt_value_usd, collateral_value_usd, current_ltv_pct, liquidation_ltv_snapshot, marge_avant_liquidation_pct, opened_at").order("marge_avant_liquidation_pct", { ascending: true }).limit(20)),
    q<any>(db.from("admin_staking_overview").select("pool_name, asset_symbol, apr, total_staked, total_staked_usd, active_stakers, total_pending_rewards, is_active").order("total_staked_usd", { ascending: false })),
    loadPrices()
  ]);

  const reconRows: any[] = (recon.data as any[]) || [];

  return (
    <div>
      <PageTitle title="Risques & cohérence" subtitle="Réconciliation des soldes, prêts et staking. Tout écart non nul est à investiguer." />

      <SectionTitle hint="user_balances vs get_asset_liabilities vs stakes actifs">Réconciliation des soldes</SectionTitle>
      <ErrorBox text={recon.error?.message} />
      {reconRows.length === 0 ? (
        <EmptyState text="Aucune donnée." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Actif</Th><Th align="right">Disponible</Th><Th align="right">Staking</Th><Th align="right">En attente</Th>
              <Th align="right">Passif (fonction)</Th><Th align="right">Écart passif</Th>
              <Th align="right">Stakes actifs</Th><Th align="right">Staking sans stake</Th><Th align="right">Soldes négatifs</Th><Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {reconRows.map((r) => {
              const diff = Math.abs(Number(r.liability_diff)) > EPS;
              const orphan = Math.abs(Number(r.staking_orphan)) > EPS;
              const neg = Number(r.negative_rows) > 0;
              const price = prices.get(r.asset_symbol);
              return (
                <tr key={r.asset_symbol} style={{ borderTop: "1px solid #334155" }}>
                  <Td><strong style={{ color: "#f8fafc" }}>{r.asset_symbol}</strong></Td>
                  <Td align="right">{formatNumber(Number(r.available_total))}</Td>
                  <Td align="right">{formatNumber(Number(r.staking_balance_total))}</Td>
                  <Td align="right">{formatNumber(Number(r.pending_total))}</Td>
                  <Td align="right">{formatNumber(Number(r.liability_fn))}</Td>
                  <Td align="right"><span style={{ color: diff ? "#f87171" : undefined }}>{formatNumber(Number(r.liability_diff))}</span></Td>
                  <Td align="right">{formatNumber(Number(r.active_stakes_total))}</Td>
                  <Td align="right">
                    <span style={{ color: orphan ? "#fbbf24" : undefined }}>{formatNumber(Number(r.staking_orphan))}</span>
                    {orphan && price !== undefined && <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{formatUsd(Number(r.staking_orphan) * price)}</div>}
                  </Td>
                  <Td align="right">{r.negative_rows}</Td>
                  <Td>{diff || neg ? <Badge tone="bad">À corriger</Badge> : orphan ? <Badge tone="warn">À vérifier</Badge> : <Badge tone="ok">OK</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <SectionTitle hint="Vue admin_loans_dashboard">Prêts avec collatéral</SectionTitle>
      <ErrorBox text={loans.error} />
      {loans.rows.length === 0 ? (
        <EmptyState text="Aucun prêt." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Collatéral</Th><Th>Emprunt</Th><Th align="right">Actifs</Th><Th align="right">Remboursés</Th><Th align="right">Liquidés</Th>
              <Th align="right">Emprunté (actif)</Th><Th align="right">Collatéral verrouillé</Th><Th align="right">À risque</Th>
            </tr>
          </thead>
          <tbody>
            {loans.rows.map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid #334155" }}>
                <Td>{l.collateral_asset}</Td><Td>{l.borrow_asset}</Td>
                <Td align="right">{l.prets_actifs}</Td><Td align="right">{l.prets_rembourses}</Td><Td align="right">{l.prets_liquides}</Td>
                <Td align="right">{formatNumber(Number(l.total_emprunte_actif || 0))}</Td>
                <Td align="right">{formatNumber(Number(l.total_collateral_verrouille || 0))}</Td>
                <Td align="right"><span style={{ color: Number(l.prets_a_risque) > 0 ? "#f87171" : undefined }}>{l.prets_a_risque}</span></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <SectionTitle hint="20 prêts actifs les plus proches de la liquidation">Santé des prêts actifs</SectionTitle>
      <ErrorBox text={health.error} />
      {health.rows.length === 0 ? (
        <EmptyState text="Aucun prêt actif." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Prêt</Th><Th>Paire</Th><Th align="right">Dette (USD)</Th><Th align="right">Collatéral (USD)</Th>
              <Th align="right">LTV</Th><Th align="right">Seuil liquidation</Th><Th align="right">Marge</Th><Th>Ouvert</Th>
            </tr>
          </thead>
          <tbody>
            {health.rows.map((l) => {
              const margin = Number(l.marge_avant_liquidation_pct);
              return (
                <tr key={l.loan_id} style={{ borderTop: "1px solid #334155" }}>
                  <Td mono>{shortId(l.loan_id)}</Td>
                  <Td>{l.collateral_asset} → {l.borrow_asset}</Td>
                  <Td align="right">{formatUsd(Number(l.debt_value_usd))}</Td>
                  <Td align="right">{formatUsd(Number(l.collateral_value_usd))}</Td>
                  <Td align="right">{formatNumber(Number(l.current_ltv_pct), 2)} %</Td>
                  <Td align="right">{formatNumber(Number(l.liquidation_ltv_snapshot), 2)} %</Td>
                  <Td align="right"><Badge tone={margin < 5 ? "bad" : margin < 15 ? "warn" : "ok"}>{formatNumber(margin, 2)} %</Badge></Td>
                  <Td>{formatDate(l.opened_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <SectionTitle hint="Vue admin_staking_overview">Pools de staking</SectionTitle>
      <ErrorBox text={staking.error} />
      {staking.rows.length === 0 ? (
        <EmptyState text="Aucun pool." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Pool</Th><Th>Actif</Th><Th align="right">APR</Th><Th align="right">Staké</Th><Th align="right">Staké (USD)</Th>
              <Th align="right">Stakers</Th><Th align="right">Récompenses en attente</Th><Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {staking.rows.map((s, i) => (
              <tr key={i} style={{ borderTop: "1px solid #334155" }}>
                <Td><strong style={{ color: "#f8fafc" }}>{s.pool_name}</strong></Td>
                <Td>{s.asset_symbol}</Td>
                <Td align="right">{formatNumber(Number(s.apr), 2)} %</Td>
                <Td align="right">{formatNumber(Number(s.total_staked))}</Td>
                <Td align="right">{formatUsd(Number(s.total_staked_usd || 0))}</Td>
                <Td align="right">{s.active_stakers}</Td>
                <Td align="right">{formatNumber(Number(s.total_pending_rewards || 0))}</Td>
                <Td><Badge tone={s.is_active ? "ok" : "info"}>{s.is_active ? "actif" : "inactif"}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
