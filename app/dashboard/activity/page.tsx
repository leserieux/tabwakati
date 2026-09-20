import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { formatNumber, formatUsd, formatDate } from "@/lib/format";
import { Kpi, KpiGrid, TableShell, Th, Td, Badge, EmptyState } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

export default async function ActivityPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const since24h = new Date(now - DAY).toISOString();
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const [prices, users, txs, loans, recon, fees, paused, stuck, failed24h, sweepFails, toCheck] = await Promise.all([
    loadPrices(),
    q<any>(db.from("admin_users_overview").select("last_activity_at, created_at")),
    q<any>(db.from("admin_transactions_overview").select("transaction_count, total_amount_usd").gte("day", since7d.slice(0, 10))),
    q<any>(db.from("admin_loans_dashboard").select("prets_a_risque")),
    db.rpc("get_admin_reconciliation"),
    db.rpc("get_platform_fees_totals"),
    q<any>(db.from("supported_assets").select("symbol").eq("can_be_deposited", false)),
    q<any>(db.from("transactions").select("id").in("status", ["pending", "processing"]).lt("created_at", stuckBefore)),
    q<any>(db.from("transactions").select("id").eq("status", "failed").gte("created_at", since24h)),
    q<any>(db.from("sweep_log").select("id").neq("status", "swept").eq("dry_run", false).gte("created_at", since7d)),
    q<any>(
      db
        .from("transactions")
        .select("id, type, status, asset_symbol, amount, created_at")
        .or(`status.in.(pending,processing),and(status.eq.failed,created_at.gte.${since7d})`)
        .order("created_at", { ascending: false })
        .limit(15)
    )
  ]);

  const totalUsers = users.rows.length;
  const newUsers = users.rows.filter((u) => u.created_at >= since7d).length;
  const active = users.rows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const txCount = txs.rows.reduce((n, t) => n + Number(t.transaction_count || 0), 0);
  const volume = txs.rows.reduce((n, t) => n + Number(t.total_amount_usd || 0), 0);

  const feeRows: any[] = ((fees.data as any[]) || []).map((f) => ({ ...f, usd: Number(f.total_fees || 0) * (prices.get(f.asset_symbol) ?? 0) }));
  feeRows.sort((a, b) => b.usd - a.usd);
  const feesUsd = feeRows.reduce((n, f) => n + f.usd, 0);

  // À surveiller : uniquement ce qui demande de l'attention
  const watch: { bad: boolean; text: string }[] = [];
  const reconRows: any[] = (recon.data as any[]) || [];
  for (const r of reconRows) {
    if (Math.abs(Number(r.liability_diff)) > 0.00000001) watch.push({ bad: true, text: `${r.asset_symbol} : les soldes des utilisateurs ne correspondent pas au total dû (écart ${formatNumber(Number(r.liability_diff))}).` });
    if (Number(r.negative_rows) > 0) watch.push({ bad: true, text: `${r.asset_symbol} : ${r.negative_rows} solde(s) négatif(s).` });
    if (Math.abs(Number(r.staking_orphan)) > 0.00000001) watch.push({ bad: false, text: `${r.asset_symbol} : ${formatNumber(Number(r.staking_orphan))} en staking sans stake correspondant.` });
  }
  const atRisk = loans.rows.reduce((n, l) => n + Number(l.prets_a_risque || 0), 0);
  if (atRisk > 0) watch.push({ bad: true, text: `${atRisk} prêt(s) proche(s) de la liquidation.` });
  if (stuck.rows.length) watch.push({ bad: false, text: `${stuck.rows.length} transaction(s) en attente depuis plus d'1 heure.` });
  if (failed24h.rows.length) watch.push({ bad: false, text: `${failed24h.rows.length} transaction(s) en échec ces dernières 24 h.` });
  if (sweepFails.rows.length) watch.push({ bad: false, text: `${sweepFails.rows.length} balayage(s) en échec cette semaine.` });
  if (paused.rows.length) watch.push({ bad: false, text: `Dépôts suspendus : ${paused.rows.map((p) => p.symbol).join(", ")}.` });

  const queryErrors = [users.error, txs.error, loans.error, recon.error?.message, fees.error?.message].filter(Boolean);

  return (
    <div>
      <h1 style={{ color: "#f8fafc", marginBottom: "0.25rem" }}>Activité</h1>
      <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: "1.5rem", fontSize: "0.9rem" }}>Ce qui se passe sur la plateforme, en bref.</p>

      {queryErrors.length > 0 && (
        <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "0.75rem 1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85rem" }}>
          Certaines données n'ont pas pu être lues : {queryErrors.join(" · ")}
        </div>
      )}

      <KpiGrid>
        <Kpi label="Utilisateurs" value={String(totalUsers)} sub={`${newUsers} nouveau(x) cette semaine`} />
        <Kpi label="Actifs cette semaine" value={String(active)} />
        <Kpi label="Volume (7 jours)" value={formatUsd(volume)} sub={`${txCount} transactions`} />
        <Kpi label="Frais gagnés (total)" value={formatUsd(feesUsd)} />
      </KpiGrid>

      <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: "2rem 0 0.75rem" }}>À surveiller</h2>
      {watch.length === 0 ? (
        <div style={{ background: "#14532d", color: "#bbf7d0", padding: "0.75rem 1rem", borderRadius: "8px", fontSize: "0.9rem" }}>Rien à signaler.</div>
      ) : (
        watch.map((w, i) => (
          <div key={i} style={{ background: w.bad ? "#7f1d1d" : "#78350f", color: w.bad ? "#fecaca" : "#fde68a", padding: "0.75rem 1rem", borderRadius: "8px", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
            {w.text}
          </div>
        ))
      )}

      <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: "2rem 0 0.75rem" }}>Frais gagnés par actif</h2>
      {feeRows.length === 0 ? (
        <EmptyState text="Aucun frais collecté." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Actif</Th>
              <Th align="right">Montant</Th>
              <Th align="right">Valeur (USD)</Th>
            </tr>
          </thead>
          <tbody>
            {feeRows.map((f) => (
              <tr key={f.asset_symbol} style={{ borderTop: "1px solid #334155" }}>
                <Td><strong style={{ color: "#f8fafc" }}>{f.asset_symbol}</strong></Td>
                <Td align="right">{formatNumber(Number(f.total_fees))}</Td>
                <Td align="right">{prices.has(f.asset_symbol) ? formatUsd(f.usd) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: "2rem 0 0.25rem" }}>Transactions à vérifier</h2>
      <p style={{ color: "#64748b", fontSize: "0.8rem", margin: "0 0 0.75rem" }}>En attente, ou en échec cette semaine (les 15 plus récentes).</p>
      {toCheck.rows.length === 0 ? (
        <EmptyState text="Aucune transaction à vérifier." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Actif</Th>
              <Th align="right">Montant</Th>
              <Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {toCheck.rows.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #334155" }}>
                <Td>{formatDate(t.created_at)}</Td>
                <Td>{t.type}</Td>
                <Td>{t.asset_symbol}</Td>
                <Td align="right">{formatNumber(Number(t.amount))}</Td>
                <Td><Badge tone={t.status === "failed" ? "bad" : "warn"}>{t.status === "failed" ? "échec" : "en attente"}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
