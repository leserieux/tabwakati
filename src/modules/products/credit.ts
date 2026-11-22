/**
 * Crédit : lecture des vues admin_* et calculs de synthèse (encours, taux de saisie, liste « à surveiller »).
 * Séparé de la page pour pouvoir tester la logique sans interface (voir tests/credit.test.ts).
 */
import { getSupabaseAdmin, q } from "@/core/db/data";
import { formatPct } from "@/core/format";
import type { Tone } from "@/components/ui";

// Seuil d'alerte LTV : aligné sur les vues admin (marge avant liquidation < 10 points).
export const LTV_MARGIN_WARN = 10;

export type Summary = {
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
  // sous-ensemble de loans_* : prêts sur staking
  stake_loans_encours_usd: number;
  stake_loans_actifs: number;
  stake_loans_a_risque: number;
  stake_loans_saisis_total: number;
  stake_loans_total: number;
  stake_collateral_locked: number;
};

export type Source = "wallet" | "stake";

export type LoanRisk = {
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
  collateral_source: Source;
  duration_days: number | null;
  due_at: string | null;
  grace_until: string | null;
  extensions_used: number;
  risk_state: string;
};

export type ScoreLoanRisk = {
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
  closed_at: string | null;
};

export type PairAgg = {
  collateral_asset: string;
  borrow_asset: string;
  collateral_source: Source;
  prets_actifs: number;
  prets_rembourses: number;
  prets_liquides: number;
  total_emprunte_actif: number;
  total_collateral_verrouille: number;
  prets_a_risque: number;
};

export type ClosedLoan = {
  id: string;
  user_id: string;
  collateral_source: Source;
  collateral_asset: string;
  collateral_amount: number;
  borrow_asset: string;
  principal_amount: number;
  accrued_interest: number;
  status: string;
  liquidation_reason: string | null;
  opened_at: string;
  closed_at: string | null;
};

export type StakeConfig = {
  is_active: boolean;
  min_duration_days: number;
  max_duration_days: number;
  default_duration_days: number;
  grace_period_hours: number;
  origination_fee_pct: number;
  extension_fee_pct: number;
  extension_days: number;
  max_extensions_per_loan: number;
  max_user_debt_usd: number;
  allow_wakati_borrow: boolean;
  due_soon_notice_hours: number;
};

export type ScoreConfig = {
  loan_duration_days: number;
  grace_period_hours: number;
  default_fee_multiplier: number;
  first_loan_cap_usd: number;
  max_absolute_cap_usd: number;
};

export function marginTone(margin: number | null): Tone {
  if (margin === null) return "info";
  if (margin < 5) return "bad";
  if (margin < 15) return "warn";
  return "ok";
}

export type Flag = { label: string; tone: Tone; sev: number };
export type Watch = { key: string; product: string; user_id: string; debtUsd: number; flags: Flag[]; due: string | null };

export function guaranteedFlags(row: LoanRisk): Flag[] {
  const flags: Flag[] = [];
  if (row.risk_state === "grace_expiree") flags.push({ label: "Grâce expirée · saisie imminente", tone: "bad", sev: 100 });
  else if (row.risk_state === "en_grace") flags.push({ label: "Échéance dépassée · en grâce", tone: "warn", sev: 60 });
  else if (row.risk_state === "echeance_proche") flags.push({ label: "Échéance proche", tone: "info", sev: 20 });
  const m = row.marge_avant_liquidation_pct;
  if (m !== null && m < LTV_MARGIN_WARN) flags.push({ label: `Marge LTV ${formatPct(m)}`, tone: marginTone(m), sev: 90 - m });
  return flags;
}


/** Charge tout ce dont la page Crédit a besoin. Ne lève jamais : les erreurs de lecture sont dans `errors`. */
export async function loadCredit() {
  const db = getSupabaseAdmin();
  // Réglages (éditables en bas de page)
  const [stakeCfgRes, collRes, borrowRes, scoreCfgRes] = await Promise.all([
    q<any>(db.from("stake_loan_config").select("*").eq("id", 1).limit(1)),
    q<any>(db.from("lending_collateral_config").select("*").eq("asset_symbol", "WAKATI").limit(1)),
    q<any>(db.from("lending_borrow_config").select("*").order("asset_symbol")),
    q<any>(db.from("score_credit_config").select("*").eq("id", 1).limit(1))
  ]);
  const sk = stakeCfgRes.rows[0];
  const coll = collRes.rows[0];
  const sc = scoreCfgRes.rows[0];

  const [summaryRes, activeRes, scoreRes, pairRes, closedRes, scoreConfigRes, stakeConfigRes] = await Promise.all([
    db.from("admin_credit_summary").select("*").maybeSingle(),
    q<LoanRisk>(db.from("admin_active_loans_risk").select("*").order("marge_avant_liquidation_pct", { ascending: true }).limit(200)),
    q<ScoreLoanRisk>(db.from("admin_score_loans_risk").select("*").order("opened_at", { ascending: false }).limit(100)),
    q<PairAgg>(
      db
        .from("admin_loans_dashboard")
        .select("collateral_asset, borrow_asset, collateral_source, prets_actifs, prets_rembourses, prets_liquides, total_emprunte_actif, total_collateral_verrouille, prets_a_risque")
    ),
    q<ClosedLoan>(
      db
        .from("loans")
        .select("id, user_id, collateral_source, collateral_asset, collateral_amount, borrow_asset, principal_amount, accrued_interest, status, liquidation_reason, opened_at, closed_at")
        .neq("status", "active")
        .order("closed_at", { ascending: false })
        .limit(15)
    ),
    db.from("score_credit_config").select("loan_duration_days, grace_period_hours, default_fee_multiplier, first_loan_cap_usd, max_absolute_cap_usd").eq("id", 1).maybeSingle(),
    db
      .from("stake_loan_config")
      .select("is_active, min_duration_days, max_duration_days, default_duration_days, grace_period_hours, origination_fee_pct, extension_fee_pct, extension_days, max_extensions_per_loan, max_user_debt_usd, allow_wakati_borrow, due_soon_notice_hours")
      .eq("id", 1)
      .maybeSingle()
  ]);

  const summary = summaryRes.data as Summary | null;
  const scoreConfig = scoreConfigRes.data as ScoreConfig | null;
  const stakeConfig = stakeConfigRes.data as StakeConfig | null;
  const errors = [summaryRes.error?.message, activeRes.error, scoreRes.error, pairRes.error, closedRes.error, stakeConfigRes.error?.message]
    .filter(Boolean)
    .join(" · ");

  // --- Répartition des prêts garantis actifs par source ---
  const stakeLoans = activeRes.rows.filter((r) => r.collateral_source === "stake");
  const walletLoans = activeRes.rows.filter((r) => r.collateral_source !== "stake");

  // --- Synthèse par produit (wallet = total garanti - staking) ---
  const stakeEncours = summary?.stake_loans_encours_usd || 0;
  const walletEncours = Math.max(0, (summary?.loans_encours_usd || 0) - stakeEncours);
  const scoreEncours = summary?.score_loans_encours_usd || 0;
  const stakeActifs = summary?.stake_loans_actifs || 0;
  const walletActifs = Math.max(0, (summary?.loans_actifs || 0) - stakeActifs);
  const scoreActifs = summary?.score_loans_actifs || 0;
  const encoursTotal = walletEncours + stakeEncours + scoreEncours;
  const actifsTotal = walletActifs + stakeActifs + scoreActifs;
  const aRisqueTotal = (summary?.loans_a_risque || 0) + (summary?.score_loans_a_risque || 0);

  const walletTotal = Math.max(0, (summary?.loans_total || 0) - (summary?.stake_loans_total || 0));
  const walletLiquides = Math.max(0, (summary?.loans_liquides_total || 0) - (summary?.stake_loans_saisis_total || 0));
  const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
  const walletRate = rate(walletLiquides, walletTotal);
  const stakeRate = rate(summary?.stake_loans_saisis_total || 0, summary?.stake_loans_total || 0);
  const scoreRate = rate(summary?.score_loans_defauts_total || 0, summary?.score_loans_total || 0);

  // --- À surveiller : liste unifiée des trois produits ---
  const watch: Watch[] = [];
  for (const row of activeRes.rows) {
    const flags = guaranteedFlags(row);
    if (flags.length === 0) continue;
    watch.push({
      key: row.loan_id,
      product: row.collateral_source === "stake" ? "Staking" : "Wallet",
      user_id: row.user_id,
      debtUsd: row.debt_value_usd,
      flags,
      due: row.due_at
    });
  }
  for (const row of scoreRes.rows) {
    if (row.status !== "active" || (row.risk_state !== "en_grace" && row.risk_state !== "grace_expiree")) continue;
    watch.push({
      key: row.loan_id,
      product: "Score",
      user_id: row.user_id,
      debtUsd: row.debt_value_usd,
      flags:
        row.risk_state === "grace_expiree"
          ? [{ label: "Grâce expirée · défaut imminent", tone: "bad", sev: 100 }]
          : [{ label: "Échéance dépassée · en grâce", tone: "warn", sev: 60 }],
      due: row.due_at
    });
  }
  const sevOf = (w: Watch) => Math.max(...w.flags.map((f) => f.sev));
  watch.sort((a, b) => sevOf(b) - sevOf(a));

  // --- Micro-prêts sur score ---
  const scoreActive = scoreRes.rows.filter((r) => r.status === "active");
  const scoreByState = {
    en_cours: scoreActive.filter((r) => r.risk_state === "en_cours").length,
    en_grace: scoreActive.filter((r) => r.risk_state === "en_grace").length,
    grace_expiree: scoreActive.filter((r) => r.risk_state === "grace_expiree").length
  };
  const scoreHistory = scoreRes.rows.filter((r) => r.status !== "active").slice(0, 15);

  return { watch, stakeCfgRes, collRes, borrowRes, scoreCfgRes, sk, coll, sc, summaryRes, activeRes, scoreRes, pairRes, closedRes, scoreConfigRes, stakeConfigRes, summary, scoreConfig, stakeConfig, errors, stakeLoans, walletLoans, stakeEncours, walletEncours, scoreEncours, stakeActifs, walletActifs, scoreActifs, encoursTotal, actifsTotal, aRisqueTotal, walletTotal, walletLiquides, rate, walletRate, stakeRate, scoreRate, sevOf, scoreActive, scoreByState, scoreHistory };
}
