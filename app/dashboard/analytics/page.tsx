import { getSupabaseAdmin, q } from "@/lib/data";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatPct, formatUsd } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type User = { id: string; username: string; created_at: string | null; updated_at: string | null };
type Balance = { user_id: string; asset_symbol: string; available_balance: number | null; staking_balance: number | null; pending_balance: number | null };
type Tx = { user_id: string; asset_symbol: string; type: string; amount: number | null; fee: number | null; status: string | null; created_at: string | null };
type Price = { asset_symbol: string; price_usd: number | null };
type Fee = { asset_symbol: string; amount: number | null; fee_type: string; collected_at: string | null };
type Risk = { user_id: string; score: number | null; level: string | null; calculated_at: string | null };

const SUCCESS = ["completed", "succeeded", "success", "successful"];

export default async function AnalyticsPage() {
  const db = getSupabaseAdmin();
  const [users, balances, transactions, prices, fees, risks] = await Promise.all([
    q<User>(db.from("users").select("id, username, created_at, updated_at")),
    q<Balance>(db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance")),
    q<Tx>(db.from("transactions").select("user_id, asset_symbol, type, amount, fee, status, created_at")),
    q<Price>(db.from("asset_prices").select("asset_symbol, price_usd")),
    q<Fee>(db.from("platform_fees").select("asset_symbol, amount, fee_type, collected_at")),
    q<Risk>(db.from("user_risk_score_history").select("user_id, score, level, calculated_at").order("calculated_at", { ascending: false })),
  ]);

  const price = new Map(prices.rows.map((row) => [row.asset_symbol, Number(row.price_usd || 0)]));
  const latestRisk = new Map<string, Risk>();
  for (const row of risks.rows) if (!latestRisk.has(row.user_id)) latestRisk.set(row.user_id, row);

  const currentByUser = new Map<string, number>();
  for (const row of balances.rows) {
    const current = Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0);
    currentByUser.set(row.user_id, (currentByUser.get(row.user_id) || 0) + current * (price.get(row.asset_symbol) || 0));
  }

  const successful = transactions.rows.filter((row) => SUCCESS.includes(String(row.status)));
  const deposits = successful.filter((row) => row.type === "deposit").reduce((sum, row) => sum + Number(row.amount || 0) * (price.get(row.asset_symbol) || 0), 0);
  const withdrawals = successful.filter((row) => row.type === "withdrawal").reduce((sum, row) => sum + Number(row.amount || 0) * (price.get(row.asset_symbol) || 0), 0);
  const feesTotal = fees.rows.reduce((sum, row) => sum + Number(row.amount || 0) * (price.get(row.asset_symbol) || 0), 0);
  const active = new Set(successful.filter((row) => row.created_at && Date.now() - new Date(row.created_at).getTime() <= 30 * 86400000).map((row) => row.user_id));
  const risky = [...latestRisk.values()].filter((row) => Number(row.score || 0) >= 50 || ["high", "critical"].includes(String(row.level || "").toLowerCase())).length;
  const errors = [users.error, balances.error, transactions.error, prices.error, fees.error, risks.error].filter(Boolean).join(" · ");
  const topUsers = users.rows.map((user) => ({ user, value: currentByUser.get(user.id) || 0 })).sort((a, b) => b.value - a.value).slice(0, 25);

  return (
    <div>
      <PageHeader title="Analytics plateforme" subtitle="Performance financière, activité utilisateur et risque agrégés." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données sont indisponibles : ${errors}` : null} />

      <div className="wk-strip">
        <Metric label="Valeur utilisateurs" value={formatCompactUsd([...currentByUser.values()].reduce((a, b) => a + b, 0))} sub="Soldes valorisés USD" />
        <Metric label="Dépôts" value={formatCompactUsd(deposits)} sub="Transactions réussies" />
        <Metric label="Retraits" value={formatCompactUsd(withdrawals)} sub={`${formatPct(deposits ? withdrawals / deposits * 100 : 0)} des dépôts`} />
        <Metric label="Frais plateforme" value={formatCompactUsd(feesTotal)} sub="platform_fees" />
        <Metric label="Actifs 30j" value={formatCompactNumber(active.size)} sub="Utilisateurs actifs" />
        <Metric label="À risque" value={formatCompactNumber(risky)} sub="Score ≥ 50" tone={risky ? "warn" : "ok"} />
      </div>

      <Section title="Décision plateforme" hint="Calculs basés uniquement sur les tables existantes du schéma de production.">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <p><strong>Cashflow net :</strong> {formatUsd(deposits - withdrawals)}</p>
            <p><strong>Transactions réussies :</strong> {formatCompactNumber(successful.length)}</p>
            <p><strong>Utilisateurs analysés :</strong> {formatCompactNumber(users.rows.length)}</p>
          </div>
          <div className="wk-panel">
            <p><Pill tone={risky ? "warn" : "ok"}>{risky ? `${risky} compte(s) à examiner` : "Aucun compte à risque"}</Pill></p>
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
            {topUsers.map(({ user, value }) => {
              const risk = latestRisk.get(user.id);
              return (
                <tr key={user.id}>
                  <Td><a className="wk-link" href={`/dashboard/users/${user.id}`}>{user.username}</a></Td>
                  <Td right>{formatUsd(value)}</Td>
                  <Td>{user.updated_at ? formatDateTime(new Date(user.updated_at)) : "—"}</Td>
                  <Td>{risk ? <Pill tone={Number(risk.score || 0) >= 75 ? "bad" : Number(risk.score || 0) >= 50 ? "warn" : "ok"}>{risk.score ?? 0}/100</Pill> : "—"}</Td>
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
