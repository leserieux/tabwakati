import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatUsd, formatCompactUsd, formatPct, formatDateTime, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Summary = {
  loans_encours_usd: number;
  loans_actifs: number;
  loans_a_risque: number;
  loans_liquides_total: number;
  loans_total: number;
  score_loans_encours_usd: number;
  score_loans_actifs: number;
  score_loans_a_risque: number;
  score_loans_defauts_total: number;
  score_loans_total: number;
};

type LoanRisk = {
  loan_id: string;
  user_id: string;
  collateral_asset: string;
  collateral_amount: number;
  borrow_asset: string;
  principal_amount: number;
  accrued_interest: number;
  total_debt: number;
  debt_value_usd: number;
  collateral_value_usd: number;
  current_ltv_pct: number | null;
  liquidation_ltv_snapshot: number;
  marge_avant_liquidation_pct: number | null;
  apr_rate_snapshot: number;
  opened_at: string;
};

type ScoreLoanRisk = {
  loan_id: string;
  user_id: string;
  asset_symbol: string;
  principal_amount: number;
  accrued_interest: number;
  total_debt: number;
  debt_value_usd: number;
  status: string;
  opened_at: string;
  due_at: string | null;
  grace_until: string | null;
  extensions_used: number;
  risk_state: string;
};

type PairAgg = { collateral_asset: string; borrow_asset: string; prets_actifs: number; prets_rembourses: number; prets_liquides: number; total_emprunte_actif: number; total_collateral_verrouille: number };

const RISK_STATE_LABEL: Record<string, string> = {
  en_cours: "En cours",
  en_grace: "En grâce",
  grace_expiree: "Grâce expirée",
  repaid: "Remboursé",
  defaulted: "Défaut"
};

function riskStateTone(state: string): Tone {
  if (state === "defaulted" || state === "grace_expiree") return "bad";
  if (state === "en_grace") return "warn";
  if (state === "repaid") return "ok";
  return "info";
}

function marginTone(margin: number | null): Tone {
  if (margin === null) return "info";
  if (margin < 5) return "bad";
  if (margin < 15) return "warn";
  return "ok";
}

export default async function CreditPage() {
  const db = getSupabaseAdmin();

  const [summaryRes, loanRiskRes, scoreLoanRiskRes, pairRes, scoreConfigRes] = await Promise.all([
    db.from("admin_credit_summary").select("*").maybeSingle(),
    q<LoanRisk>(db.from("admin_active_loans_risk").select("*").order("marge_avant_liquidation_pct", { ascending: true }).limit(25)),
    q<ScoreLoanRisk>(db.from("admin_score_loans_risk").select("*").order("opened_at", { ascending: false }).limit(50)),
    q<PairAgg>(db.from("admin_loans_dashboard").select("collateral_asset, borrow_asset, prets_actifs, prets_rembourses, prets_liquides, total_emprunte_actif, total_collateral_verrouille")),
    db.from("score_credit_config").select("loan_duration_days, grace_period_hours, default_fee_multiplier, first_loan_cap_usd, max_absolute_cap_usd").eq("id", 1).maybeSingle()
  ]);

  const summary = summaryRes.data as Summary | null;
  const errors = [summaryRes.error?.message, loanRiskRes.error, scoreLoanRiskRes.error, pairRes.error].filter(Boolean).join(" · ");

  // Compteur "à risque" par paire, calculé côté app depuis admin_active_loans_risk
  // (la colonne prets_a_risque de admin_loans_dashboard est cassée : elle dépend
  // de v_active_loans_health qui filtre par auth.uid(), toujours NULL côté admin).
  const riskByPair = new Map<string, number>();
  for (const row of loanRiskRes.rows) {
    const key = `${row.collateral_asset}/${row.borrow_asset}`;
    if (row.marge_avant_liquidation_pct !== null && row.marge_avant_liquidation_pct < 10) {
      riskByPair.set(key, (riskByPair.get(key) || 0) + 1);
    }
  }

  const scoreActive = scoreLoanRiskRes.rows.filter((r) => r.status === "active");
  const scoreByState = {
    en_cours: scoreActive.filter((r) => r.risk_state === "en_cours").length,
    en_grace: scoreActive.filter((r) => r.risk_state === "en_grace").length,
    grace_expiree: scoreActive.filter((r) => r.risk_state === "grace_expiree").length
  };
  const scoreHistory = scoreLoanRiskRes.rows.filter((r) => r.status !== "active").slice(0, 15);
  const scoreConfig = scoreConfigRes.data as { loan_duration_days: number; grace_period_hours: number; default_fee_multiplier: number; first_loan_cap_usd: number; max_absolute_cap_usd: number } | null;

  const loansDefaultRatePct = summary && summary.loans_total > 0 ? (summary.loans_liquides_total / summary.loans_total) * 100 : 0;
  const scoreDefaultRatePct = summary && summary.score_loans_total > 0 ? (summary.score_loans_defauts_total / summary.score_loans_total) * 100 : 0;
  const encoursTotalUsd = (summary?.loans_encours_usd || 0) + (summary?.score_loans_encours_usd || 0);
  const actifsTotal = (summary?.loans_actifs || 0) + (summary?.score_loans_actifs || 0);
  const aRisqueTotal = (summary?.loans_a_risque || 0) + (summary?.score_loans_a_risque || 0);

  return (
    <div>
      <PageHeader title="Crédit" subtitle="Prêts collatéralisés et micro-prêts sur score : encours, risque de liquidation et défauts." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Encours total" value={formatCompactUsd(encoursTotalUsd)} sub="Prêts collatéralisés + score crédit" />
        <StatCard label="Prêts actifs" value={String(actifsTotal)} sub={`${summary?.loans_actifs ?? 0} collatéralisés · ${summary?.score_loans_actifs ?? 0} score`} />
        <StatCard label="Prêts à risque" value={String(aRisqueTotal)} sub="Marge < 10 % ou en grâce" tone={aRisqueTotal > 0 ? "bad" : "ok"} />
        <StatCard label="Taux de liquidation/défaut" value={formatPct(Math.max(loansDefaultRatePct, scoreDefaultRatePct))} sub={`Collatéral : ${formatPct(loansDefaultRatePct)} · Score : ${formatPct(scoreDefaultRatePct)}`} />
      </div>

      <Section title="Prêts collatéralisés — par paire d'actifs" hint="Encours et sinistralité par paire garantie/emprunté.">
        {pairRes.rows.length === 0 ? (
          <Empty text="Aucun prêt collatéralisé pour l'instant." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Garantie</Th>
                <Th>Emprunté</Th>
                <Th right>Actifs</Th>
                <Th right>Remboursés</Th>
                <Th right>Liquidés</Th>
                <Th right>À risque</Th>
                <Th right>Encours emprunté</Th>
                <Th right hideSm>Collatéral verrouillé</Th>
              </tr>
            </thead>
            <tbody>
              {pairRes.rows.map((row) => {
                const key = `${row.collateral_asset}/${row.borrow_asset}`;
                const risk = riskByPair.get(key) || 0;
                return (
                  <tr key={key}>
                    <Td>{row.collateral_asset}</Td>
                    <Td>{row.borrow_asset}</Td>
                    <Td right>{row.prets_actifs}</Td>
                    <Td right>{row.prets_rembourses}</Td>
                    <Td right>{row.prets_liquides}</Td>
                    <Td right>{risk > 0 ? <Pill tone="bad">{risk}</Pill> : "—"}</Td>
                    <Td right>{formatNumber(Number(row.total_emprunte_actif))} <span className="wk-asset-sub">{row.borrow_asset}</span></Td>
                    <Td right hideSm>{formatNumber(Number(row.total_collateral_verrouille))} <span className="wk-asset-sub">{row.collateral_asset}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Prêts collatéralisés — proches de la liquidation" hint="Les 25 prêts actifs classés par marge la plus faible avant liquidation (LTV actuel vs LTV de liquidation).">
        {loanRiskRes.rows.length === 0 ? (
          <Empty text="Aucun prêt collatéralisé actif." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th>Garantie</Th>
                <Th>Dette</Th>
                <Th right>Valeur garantie</Th>
                <Th right>Dette (USD)</Th>
                <Th>LTV actuel vs liquidation</Th>
                <Th right hideSm>Ouvert le</Th>
              </tr>
            </thead>
            <tbody>
              {loanRiskRes.rows.map((row) => (
                <tr key={row.loan_id}>
                  <Td label="Utilisateur">
                    <a className="wk-link" href={`/dashboard/users/${row.user_id}`}>
                      <div className="wk-asset-sub">{shortId(row.user_id)}</div>
                    </a>
                  </Td>
                  <Td label="Garantie">{formatNumber(row.collateral_amount)} <span className="wk-asset-sub">{row.collateral_asset}</span></Td>
                  <Td label="Dette">{formatNumber(row.total_debt)} <span className="wk-asset-sub">{row.borrow_asset}</span></Td>
                  <Td right label="Valeur garantie">{formatUsd(row.collateral_value_usd)}</Td>
                  <Td right label="Dette (USD)">{formatUsd(row.debt_value_usd)}</Td>
                  <Td label="LTV">
                    {row.current_ltv_pct === null ? (
                      "—"
                    ) : (
                      <>
                        <CoverageBar ratio={row.current_ltv_pct / row.liquidation_ltv_snapshot} tone={marginTone(row.marge_avant_liquidation_pct)} />
                        <div className="wk-asset-sub">{formatPct(row.current_ltv_pct)} / {formatPct(row.liquidation_ltv_snapshot)} · marge {row.marge_avant_liquidation_pct !== null ? formatPct(row.marge_avant_liquidation_pct) : "—"}</div>
                      </>
                    )}
                  </Td>
                  <Td right hideSm label="Ouvert le">{formatDateTime(new Date(row.opened_at))}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section
        title="Micro-prêts sur score crédit"
        hint={scoreConfig ? `Config actuelle : durée ${scoreConfig.loan_duration_days} j, grâce ${scoreConfig.grace_period_hours} h, plafond 1er prêt ${formatUsd(scoreConfig.first_loan_cap_usd)}, plafond absolu ${formatUsd(scoreConfig.max_absolute_cap_usd)}. Modifiable dans Paramètres.` : undefined}
      >
        <div className="wk-strip" style={{ marginBottom: 16 }}>
          <StatCard label="En cours" value={String(scoreByState.en_cours)} sub="Dans les délais" />
          <StatCard label="En grâce" value={String(scoreByState.en_grace)} sub="Échéance dépassée, encore dans la grâce" tone={scoreByState.en_grace > 0 ? "warn" : undefined} />
          <StatCard label="Grâce expirée" value={String(scoreByState.grace_expiree)} sub="En attente de passage en défaut" tone={scoreByState.grace_expiree > 0 ? "bad" : undefined} />
          <StatCard label="Défauts (total)" value={String(summary?.score_loans_defauts_total ?? 0)} sub={`Sur ${summary?.score_loans_total ?? 0} prêt(s) au total`} />
        </div>

        {scoreActive.length === 0 ? (
          <Empty text="Aucun micro-prêt actif." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th>Dette</Th>
                <Th right>Dette (USD)</Th>
                <Th>Statut</Th>
                <Th>Échéance</Th>
                <Th right hideSm>Prolongations</Th>
              </tr>
            </thead>
            <tbody>
              {scoreActive.map((row) => (
                <tr key={row.loan_id}>
                  <Td label="Utilisateur">
                    <a className="wk-link" href={`/dashboard/users/${row.user_id}`}>
                      <div className="wk-asset-sub">{shortId(row.user_id)}</div>
                    </a>
                  </Td>
                  <Td label="Dette">{formatNumber(row.total_debt)} <span className="wk-asset-sub">{row.asset_symbol}</span></Td>
                  <Td right label="Dette (USD)">{formatUsd(row.debt_value_usd)}</Td>
                  <Td label="Statut"><Pill tone={riskStateTone(row.risk_state)}>{RISK_STATE_LABEL[row.risk_state] || row.risk_state}</Pill></Td>
                  <Td label="Échéance">
                    <div>{row.due_at ? formatDateTime(new Date(row.due_at)) : "—"}</div>
                    {row.grace_until && <div className="wk-asset-sub">Grâce jusqu'au {formatDateTime(new Date(row.grace_until))}</div>}
                  </Td>
                  <Td right hideSm label="Prolongations">{row.extensions_used}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}

        {scoreHistory.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary className="wk-link" style={{ cursor: "pointer" }}>Voir l'historique récent ({scoreHistory.length} prêt(s) clos)</summary>
            <div style={{ marginTop: 12 }}>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Utilisateur</Th>
                    <Th>Dette</Th>
                    <Th>Statut</Th>
                    <Th>Ouvert le</Th>
                    <Th>Clos le</Th>
                  </tr>
                </thead>
                <tbody>
                  {scoreHistory.map((row) => (
                    <tr key={row.loan_id}>
                      <Td label="Utilisateur"><div className="wk-asset-sub">{shortId(row.user_id)}</div></Td>
                      <Td label="Dette">{formatNumber(row.total_debt)} <span className="wk-asset-sub">{row.asset_symbol}</span></Td>
                      <Td label="Statut"><Pill tone={riskStateTone(row.risk_state)}>{RISK_STATE_LABEL[row.risk_state] || row.risk_state}</Pill></Td>
                      <Td label="Ouvert le">{formatDateTime(new Date(row.opened_at))}</Td>
                      <Td label="Clos le">{"closed_at" in row && (row as any).closed_at ? formatDateTime(new Date((row as any).closed_at)) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className={`wk-strip-value${tone ? ` wk-${tone}` : ""}`}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
