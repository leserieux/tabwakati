import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { loadUserPerformance } from "@/lib/user-performance";
import { loadUserWindowSummaries } from "@/lib/user-analytics";
import { buildUserDecisionSummary } from "@/lib/user-decision";
import { formatCompactNumber, formatDateTime, formatToken, formatUsd, shortId } from "@/lib/format";
import { txStatusLabel, txStatusTone, txTypeLabel } from "@/lib/transactions";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type User = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  is_verified: boolean;
  email_confirmed: boolean;
  profile_completed: boolean;
  user_level: string | null;
  experience_points: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type Balance = {
  asset_symbol: string;
  available_balance: number;
  staking_balance: number;
  pending_balance: number;
  total_deposited: number;
  total_withdrawn: number;
  total_earned_staking: number;
};

type Tx = {
  id: string;
  type: string;
  asset_symbol: string;
  amount: number;
  fee: number | null;
  status: string | null;
  created_at: string;
  tx_hash: string | null;
};

type Kyc = {
  verification_level: string | null;
  verification_status: string | null;
  verified_at: string | null;
  expiry_date: string | null;
  rejection_reason: string | null;
};

type Limits = {
  daily_withdraw_limit: number | null;
  daily_withdraw_used: number | null;
  daily_deposit_limit: number | null;
  daily_deposit_used: number | null;
  monthly_withdraw_limit: number | null;
  monthly_withdraw_used: number | null;
};

type RiskScoreRow = {
  score: number | null;
  level: string | null;
  reasons: any[] | null;
  calculated_at: string | null;
};

type RiskFlagRow = {
  title: string;
  description: string;
  severity: string | null;
  status: string | null;
  asset_symbol: string | null;
  score_impact: number | null;
  detected_at: string | null;
};

export default async function UserDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { asset?: string } }) {
  const db = getSupabaseAdmin();
  const selectedAsset = (searchParams?.asset || "").trim();

  const [userRes, balances, transactions, prices, kyc, limits, riskScoreRes, riskFlags, performance, windows] = await Promise.all([
    db.from("users").select("id, username, email, phone, country_code, is_verified, email_confirmed, profile_completed, user_level, experience_points, created_at, updated_at").eq("id", params.id).limit(1),
    q<Balance>(db.from("user_balances").select("asset_symbol, available_balance, staking_balance, pending_balance, total_deposited, total_withdrawn, total_earned_staking").eq("user_id", params.id)),
    q<Tx>(db.from("transactions").select("id, type, asset_symbol, amount, fee, status, created_at, tx_hash").eq("user_id", params.id).order("created_at", { ascending: false }).limit(100)),
    loadPrices(),
    q<Kyc>(db.from("user_kyc").select("verification_level, verification_status, verified_at, expiry_date, rejection_reason").eq("user_id", params.id).limit(1)),
    q<Limits>(db.from("user_transaction_limits").select("daily_withdraw_limit, daily_withdraw_used, daily_deposit_limit, daily_deposit_used, monthly_withdraw_limit, monthly_withdraw_used").eq("user_id", params.id).limit(1)),
    q<RiskScoreRow>(db.from("user_risk_scores_current").select("score, level, reasons, calculated_at").eq("user_id", params.id).limit(1)),
    q<RiskFlagRow>(db.from("user_risk_flags").select("title, description, severity, status, asset_symbol, score_impact, detected_at").eq("user_id", params.id).order("detected_at", { ascending: false }).limit(10)),
    loadUserPerformance(params.id),
    loadUserWindowSummaries(params.id),
  ]);

  if (userRes.error || !userRes.data || userRes.data.length === 0) {
    return (
      <div>
        <PageHeader title="Utilisateur introuvable" />
        <ErrorNote text={userRes.error?.message || "Ce compte n'existe pas ou n'est plus disponible."} />
      </div>
    );
  }

  const user = userRes.data[0] as User;
  const byAsset = new Map<string, Balance>();
  for (const row of balances.rows) {
    const asset = String(row.asset_symbol);
    const existing = byAsset.get(asset) || {
      asset_symbol: asset,
      available_balance: 0,
      staking_balance: 0,
      pending_balance: 0,
      total_deposited: 0,
      total_withdrawn: 0,
      total_earned_staking: 0,
    };
    existing.available_balance += Number(row.available_balance || 0);
    existing.staking_balance += Number(row.staking_balance || 0);
    existing.pending_balance += Number(row.pending_balance || 0);
    existing.total_deposited += Number(row.total_deposited || 0);
    existing.total_withdrawn += Number(row.total_withdrawn || 0);
    existing.total_earned_staking += Number(row.total_earned_staking || 0);
    byAsset.set(asset, existing);
  }

  const totalUsd = [...byAsset.values()].reduce((sum, row) => {
    const current = Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0);
    return sum + current * (prices.get(row.asset_symbol) || 0);
  }, 0);

  const riskScore = riskScoreRes.rows[0] || null;
  const riskLevel = (riskScore?.level || "normal").toLowerCase();
  const riskTone = riskLevel === "critical" ? "bad" : riskLevel === "high" ? "warn" : riskLevel === "watch" ? "warn" : "ok";

  const totalDeposits = performance.rows.reduce((sum, row) => sum + Number(row.deposited || 0), 0);
  const totalWithdrawn = performance.rows.reduce((sum, row) => sum + Number(row.withdrawn || 0), 0);
  const totalNetVariation = performance.rows.reduce((sum, row) => sum + Number(row.variation || 0), 0);
  const totalRewards = performance.rows.reduce((sum, row) => sum + Number(row.rewards || 0), 0);
  const totalFees = performance.rows.reduce((sum, row) => sum + Number(row.fees || 0), 0);
  const decision = buildUserDecisionSummary(windows.rows, { score: riskScore?.score ?? null, level: riskScore?.level ?? null }, kyc.rows[0]?.verification_status ?? null);

  const visibleTx = selectedAsset ? transactions.rows.filter((row) => row.asset_symbol === selectedAsset) : transactions.rows;
  const performanceRows = selectedAsset ? performance.rows.filter((row) => row.asset === selectedAsset) : performance.rows;
  const kycRow = kyc.rows[0] || null;
  const limitRow = limits.rows[0] || null;

  const queryErrors = [balances.error, transactions.error, kyc.error, limits.error, riskScoreRes.error, riskFlags.error, performance.error, windows.error].filter(Boolean);

  return (
    <div>
      <PageHeader title={user.username || "Utilisateur"} subtitle={`Compte ${shortId(user.id)} · profil, risque, actifs et performance`} updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={queryErrors.length ? `Certaines données sont indisponibles : ${queryErrors.join(" · ")}` : null} />

      <div className="wk-strip" style={{ marginBottom: 18 }}>
        <StatCard label="Valeur totale" value={formatUsd(totalUsd)} sub="USD" />
        <StatCard label="Dépôts" value={formatToken(totalDeposits)} sub="Total enregistré" />
        <StatCard label="Retraits" value={formatToken(totalWithdrawn)} sub="Total sorti" />
        <StatCard label="Variation nette" value={formatToken(totalNetVariation)} sub="Flux + solde" />
        <StatCard label="Risque" value={riskScore ? `${riskScore.score ?? 0}/100` : "—"} sub={riskScore?.level || "normal"} tone={riskTone} />
      </div>

      <Section title="Décision admin" hint="Résumé lisible des signaux récents et du niveau d’attention recommandé.">
        <div className="wk-panel" style={{ borderLeft: `4px solid ${decision.tone === "bad" ? "var(--bad)" : decision.tone === "warn" ? "var(--warn)" : decision.tone === "info" ? "var(--info)" : "var(--ok)"}` }}>
          <p><strong>{decision.label}</strong></p>
          <p>{decision.narrative}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {decision.signals.map((signal) => (
              <Pill key={signal.code} tone={signal.tone}>{signal.title}</Pill>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Profil utilisateur">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <Pill tone={user.is_verified ? "ok" : "warn"}>{user.is_verified ? "Vérifié" : "Non vérifié"}</Pill>
              <Pill tone={user.email_confirmed ? "ok" : "info"}>{user.email_confirmed ? "Email validé" : "Email non validé"}</Pill>
              <Pill tone={user.profile_completed ? "ok" : "warn"}>{user.profile_completed ? "Profil complet" : "Profil incomplet"}</Pill>
            </div>
            <p><strong>Email :</strong> {user.email || "—"}</p>
            <p><strong>Téléphone :</strong> {user.phone || "—"}</p>
            <p><strong>Pays :</strong> {user.country_code || "—"}</p>
            <p><strong>Niveau :</strong> {user.user_level || "—"}</p>
            <p><strong>Points :</strong> {formatCompactNumber(Number(user.experience_points || 0))}</p>
            <p><strong>Créé le :</strong> {user.created_at ? formatDateTime(new Date(user.created_at)) : "—"}</p>
            <p><strong>Dernière activité :</strong> {user.updated_at ? formatDateTime(new Date(user.updated_at)) : "—"}</p>
          </div>

          <div className="wk-panel">
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>KYC & limites</h3>
            <p><strong>Statut KYC :</strong> {kycRow?.verification_status || "—"}</p>
            <p><strong>Niveau :</strong> {kycRow?.verification_level || "—"}</p>
            <p><strong>Vérifié le :</strong> {kycRow?.verified_at ? formatDateTime(new Date(kycRow.verified_at)) : "—"}</p>
            <p><strong>Expiration :</strong> {kycRow?.expiry_date ? formatDateTime(new Date(kycRow.expiry_date)) : "—"}</p>
            <p><strong>Limite dépôt/jour :</strong> {limitRow?.daily_deposit_limit ?? "—"}</p>
            <p><strong>Limite retrait/jour :</strong> {limitRow?.daily_withdraw_limit ?? "—"}</p>
            <p><strong>Limite retrait/mois :</strong> {limitRow?.monthly_withdraw_limit ?? "—"}</p>
            <p><strong>Raison de rejet :</strong> {kycRow?.rejection_reason || "—"}</p>
          </div>
        </div>
      </Section>

      <Section title="Résumé comportemental" hint="Synthèse de décision sur 7 / 30 / 90 jours.">
        <div className="wk-grid-3">
          {windows.rows.map((window) => (
            <div key={window.window} className="wk-panel">
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>{window.window === "7d" ? "7 jours" : window.window === "30d" ? "30 jours" : "90 jours"}</h3>
              <p><strong>Dépôts :</strong> {formatToken(window.deposits)}</p>
              <p><strong>Retraits :</strong> {formatToken(window.withdrawals)}</p>
              <p><strong>Cashflow net :</strong> {formatToken(window.netCashflow)}</p>
              <p><strong>Ratio dépôt/retrait :</strong> {window.ratio === null ? "—" : window.ratio.toFixed(2)}</p>
              <p><strong>Transactions :</strong> {formatCompactNumber(window.transactionCount)}</p>
              <p><strong>Succès / échec :</strong> {window.successfulCount} / {window.failedCount}</p>
              <p><strong>Rewards :</strong> {formatToken(window.rewards)}</p>
              <p><strong>Frais :</strong> {formatToken(window.fees)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Performance par actif" hint={selectedAsset ? `Filtre actif : ${selectedAsset}` : "Chaque actif est calculé séparément, sans mélange de quantités."}>
        {performanceRows.length === 0 ? (
          <Empty text="Aucun actif pour cet utilisateur." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th right>Dépôts</Th>
                <Th right>Retraits</Th>
                <Th right>Solde</Th>
                <Th right>Variation</Th>
                <Th right>Valeur</Th>
                <Th>Flux</Th>
              </tr>
            </thead>
            <tbody>
              {performanceRows.map((row) => {
                const currentValue = Number(row.current || 0) * (prices.get(row.asset) || 0);
                const assetTone = Number(row.variation || 0) >= 0 ? "ok" : "warn";
                return (
                  <tr key={row.asset}>
                    <Td>
                      <a className="wk-link" href={`/dashboard/users/${params.id}?asset=${encodeURIComponent(row.asset)}`}>
                        {row.asset}
                      </a>
                    </Td>
                    <Td right>{formatToken(Number(row.deposited || 0))}</Td>
                    <Td right>{formatToken(Number(row.withdrawn || 0))}</Td>
                    <Td right>{formatToken(Number(row.current || 0))}</Td>
                    <Td right>
                      <span style={{ color: assetTone === "ok" ? "var(--ok)" : "var(--warn)" }}>
                        {formatToken(Number(row.variation || 0))}
                      </span>
                    </Td>
                    <Td right>{formatUsd(currentValue)}</Td>
                    <Td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <Pill tone={Number(row.netFlow || 0) >= 0 ? "ok" : "warn"}>{formatToken(Number(row.netFlow || 0))}</Pill>
                        {row.rewards !== 0 && <Pill tone="info">Rewards {formatToken(Number(row.rewards || 0))}</Pill>}
                        {row.fees !== 0 && <Pill tone="warn">Fees {formatToken(Number(row.fees || 0))}</Pill>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Synthèse de flux" hint="Agrégat des entrées, sorties, rewards et frais par utilisateur.">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <p><strong>Dépot total :</strong> {formatToken(totalDeposits)}</p>
            <p><strong>Retrait total :</strong> {formatToken(totalWithdrawn)}</p>
            <p><strong>Variation nette :</strong> {formatToken(totalNetVariation)}</p>
            <p><strong>Rewards / cashback / bonus :</strong> {formatToken(totalRewards)}</p>
            <p><strong>Frais :</strong> {formatToken(totalFees)}</p>
            <p><strong>Valeur totale USD :</strong> {formatUsd(totalUsd)}</p>
          </div>
          <div className="wk-panel">
            <p><strong>Transactions :</strong> {formatCompactNumber(transactions.rows.length)}</p>
            <p><strong>Actif filtré :</strong> {selectedAsset || "Tous"}</p>
            <p><strong>Vérification KYC :</strong> {kycRow ? kycRow.verification_status || "—" : "—"}</p>
            <p><strong>Score risque :</strong> {riskScore ? `${riskScore.score ?? 0}/100` : "Non calculé"}</p>
            <p><strong>Niveau :</strong> {riskScore?.level || "normal"}</p>
            <p><strong>Dernière analyse :</strong> {riskScore?.calculated_at ? formatDateTime(new Date(riskScore.calculated_at)) : "—"}</p>
          </div>
        </div>
      </Section>

      <Section title="Transactions récentes" hint={selectedAsset ? `Affichage limité à ${selectedAsset}` : "Dernières transactions de l'utilisateur."}>
        {visibleTx.length === 0 ? (
          <Empty text="Aucune transaction pour ce filtre." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Actif</Th>
                <Th right>Montant</Th>
                <Th>Statut</Th>
                <Th>Date</Th>
                <Th>Tx</Th>
              </tr>
            </thead>
            <tbody>
              {visibleTx.map((tx) => (
                <tr key={tx.id}>
                  <Td>{txTypeLabel(tx.type)}</Td>
                  <Td>{tx.asset_symbol}</Td>
                  <Td right>{formatToken(Number(tx.amount || 0))}</Td>
                  <Td><Pill tone={txStatusTone(tx.status)}>{txStatusLabel(tx.status)}</Pill></Td>
                  <Td>{formatDateTime(new Date(tx.created_at))}</Td>
                  <Td>{tx.tx_hash ? shortId(tx.tx_hash) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Risque & alertes" hint="Signal de risque depuis le score et les flags analytiques.">
        {riskFlags.rows.length === 0 ? (
          <Empty text="Aucune alerte de risque détectée pour ce compte." />
        ) : (
          <div className="wk-grid-2">
            {riskFlags.rows.map((flag, index) => (
              <div key={`${flag.title}-${index}`} className="wk-panel">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <strong>{flag.title}</strong>
                  <Pill tone={flag.severity === "critical" || flag.severity === "high" ? "bad" : flag.severity === "medium" ? "warn" : "info"}>{flag.severity || "info"}</Pill>
                </div>
                <p>{flag.description}</p>
                <p><strong>Actif :</strong> {flag.asset_symbol || "—"}</p>
                <p><strong>Impact score :</strong> {flag.score_impact ?? 0}</p>
                <p><strong>Détecté :</strong> {flag.detected_at ? formatDateTime(new Date(flag.detected_at)) : "—"}</p>
                <p><strong>Statut :</strong> {flag.status || "open"}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub, tone = "ok" }: { label: string; value: string; sub: string; tone?: "ok" | "warn" | "bad" | "info" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className="wk-strip-value" style={{ color: tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--fg)" }}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
