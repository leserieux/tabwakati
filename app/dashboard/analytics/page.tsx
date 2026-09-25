import { getSupabaseAdmin, q } from "@/lib/data";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatPct, formatUsd } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Summary = {
  user_id: string;
  username: string;
  current_value_usd: number | null;
  deposited_value_usd: number | null;
  withdrawn_value_usd: number | null;
  fees_value_usd: number | null;
  rewards_value_usd: number | null;
  transaction_count: number | null;
  last_transaction_at: string | null;
};

type AssetMetric = {
  asset_symbol: string;
  total_user_balance: number | null;
  total_deposited: number | null;
  total_withdrawn: number | null;
  total_staked: number | null;
  total_fees_collected: number | null;
  net_position: number | null;
};

type Risk = { user_id: string; score: number | null; level: string | null };

export default async function AnalyticsPage() {
  const db = getSupabaseAdmin();
  const [summaries, metrics, risks] = await Promise.all([
    q<Summary>(db.from("admin_user_financial_summary").select("user_id, username, current_value_usd, deposited_value_usd, withdrawn_value_usd, fees_value_usd, rewards_value_usd, transaction_count, last_transaction_at")),
    q<AssetMetric>(db.from("supported_assets_metrics").select("asset_symbol, total_user_balance, total_deposited, total_withdrawn, total_staked, total_fees_collected, net_position").order("asset_symbol")),
    q<Risk>(db.from("user_risk_scores_current").select("user_id, score, level")),
  ]);

  const rows = summaries.rows;
  const totalValue = rows.reduce((sum, row) => sum + Number(row.current_value_usd || 0), 0);
  const totalDeposits = rows.reduce((sum, row) => sum + Number(row.deposited_value_usd || 0), 0);
  const totalWithdrawals = rows.reduce((sum, row) => sum + Number(row.withdrawn_value_usd || 0), 0);
  const totalFees = rows.reduce((sum, row) => sum + Number(row.fees_value_usd || 0), 0);
  const activeUsers = rows.filter((row) => row.last_transaction_at && Date.now() - new Date(row.last_transaction_at).getTime() <= 30 * 24 * 3600 * 1000).length;
  const riskyUsers = risks.rows.filter((row) => Number(row.score || 0) >= 50 || ["high", "critical"].includes(String(row.level || "").toLowerCase())).length;
  const coverage = totalDeposits > 0 ? (totalWithdrawals / totalDeposits) * 100 : 0;
  const errors = [summaries.error, metrics.error, risks.error].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader title="Analytics plateforme" subtitle="Performance financière, activité utilisateur et risque agrégés." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données sont indisponibles : ${errors}` : null} />

      <div className="wk-strip">
        <Metric label="Valeur utilisateurs" value={formatCompactUsd(totalValue)} sub="Portefeuilles valorisés USD" />
        <Metric label="Dépôts" value={formatCompactUsd(totalDeposits)} sub="Valeur cumulée" />
        <Metric label="Retraits" value={formatCompactUsd(totalWithdrawals)} sub={`${formatPct(coverage)} des dépôts`} />
        <Metric label="Frais plateforme" value={formatCompactUsd(totalFees)} sub="Revenus identifiés" />
        <Metric label="Utilisateurs actifs" value={formatCompactNumber(activeUsers)} sub="Activité sur 30 jours" />
        <Metric label="Comptes à risque" value={formatCompactNumber(riskyUsers)} sub="Score ≥ 50 ou niveau élevé" tone={riskyUsers > 0 ? "warn" : "ok"} />
      </div>

      <Section title="Décision plateforme" hint="Les montants multi-actifs sont exclusivement agrégés en USD.">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <h3 style={{ marginTop: 0 }}>Flux et valeur</h3>
            <p><strong>Cashflow net estimé :</strong> {formatUsd(totalDeposits - totalWithdrawals)}</p>
            <p><strong>Valeur actuelle des comptes :</strong> {formatUsd(totalValue)}</p>
            <p><strong>Revenu fees identifié :</strong> {formatUsd(totalFees)}</p>
            <p><strong>Comptes analysés :</strong> {formatCompactNumber(rows.length)}</p>
          </div>
          <div className="wk-panel">
            <h3 style={{ marginTop: 0 }}>Priorités opérationnelles</h3>
            <p><Pill tone={riskyUsers > 0 ? "warn" : "ok"}>{riskyUsers > 0 ? `${riskyUsers} compte(s) à examiner` : "Aucun compte à risque élevé"}</Pill></p>
            <p><Pill tone={coverage >= 80 ? "warn" : "info"}>Ratio retraits/dépôts : {formatPct(coverage)}</Pill></p>
            <p><Pill tone="info">Performance comptable, pas un P&L réel</Pill></p>
          </div>
        </div>
      </Section>

      <Section title="Performance par actif" hint="Les quantités restent séparées par symbole.">
        {metrics.rows.length === 0 ? <div className="wk-panel">Aucune métrique d'actif disponible.</div> : (
          <TableWrap>
            <thead><tr><Th>Actif</Th><Th right>Solde utilisateurs</Th><Th right>Dépôts</Th><Th right>Retraits</Th><Th right>Staking</Th><Th right>Frais</Th><Th right>Position nette</Th></tr></thead>
            <tbody>{metrics.rows.map((row) => <tr key={row.asset_symbol}>
              <Td><strong>{row.asset_symbol}</strong></Td>
              <Td right>{formatCompactNumber(Number(row.total_user_balance || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.total_deposited || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.total_withdrawn || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.total_staked || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.total_fees_collected || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.net_position || 0))}</Td>
            </tr>)}</tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Utilisateurs à forte valeur" hint="Classement par valeur actuelle du portefeuille.">
        {rows.length === 0 ? <div className="wk-panel">Aucune donnée utilisateur disponible.</div> : (
          <TableWrap>
            <thead><tr><Th>Utilisateur</Th><Th right>Valeur USD</Th><Th right>Dépôts USD</Th><Th right>Retraits USD</Th><Th right>Frais USD</Th><Th right>Transactions</Th><Th>Dernière activité</Th></tr></thead>
            <tbody>{[...rows].sort((a, b) => Number(b.current_value_usd || 0) - Number(a.current_value_usd || 0)).slice(0, 25).map((row) => <tr key={row.user_id}>
              <Td><a className="wk-link" href={`/dashboard/users/${row.user_id}`}>{row.username || row.user_id.slice(0, 8)}</a></Td>
              <Td right>{formatUsd(Number(row.current_value_usd || 0))}</Td>
              <Td right>{formatUsd(Number(row.deposited_value_usd || 0))}</Td>
              <Td right>{formatUsd(Number(row.withdrawn_value_usd || 0))}</Td>
              <Td right>{formatUsd(Number(row.fees_value_usd || 0))}</Td>
              <Td right>{formatCompactNumber(Number(row.transaction_count || 0))}</Td>
              <Td>{row.last_transaction_at ? formatDateTime(new Date(row.last_transaction_at)) : "—"}</Td>
            </tr>)}</tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function Metric({ label, value, sub, tone = "ok" }: { label: string; value: string; sub: string; tone?: "ok" | "warn" }) {
  return <div className="wk-strip-item"><div className="wk-strip-label">{label}</div><div className="wk-strip-value" style={{ color: tone === "warn" ? "var(--warn)" : "var(--fg)" }}>{value}</div><div className="wk-strip-sub">{sub}</div></div>;
}
