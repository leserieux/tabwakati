import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatUsd, formatCompactUsd, formatPct, formatDateTime, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, ErrorNote, type Tone } from "@/components/ui";

import { updateStakeLoanConfig, updateLendingCollateralConfig, updateLendingBorrowConfig, updateScoreCreditConfig } from "@/app/dashboard/settings/actions";
import { Field, Toggle, SettingsCard, SettingsMessages } from "@/components/settings-form";

const RETURN = "/dashboard/credit";
type SettingsParams = { saved?: string; error?: string; msg?: string };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seuil d'alerte LTV : aligné sur les vues admin (marge avant liquidation < 10 points).
const LTV_MARGIN_WARN = 10;

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
  // sous-ensemble de loans_* : prêts sur staking
  stake_loans_encours_usd: number;
  stake_loans_actifs: number;
  stake_loans_a_risque: number;
  stake_loans_saisis_total: number;
  stake_loans_total: number;
  stake_collateral_locked: number;
};

type Source = "wallet" | "stake";

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
  collateral_source: Source;
  duration_days: number | null;
  due_at: string | null;
  grace_until: string | null;
  extensions_used: number;
  risk_state: string;
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
  closed_at: string | null;
};

type PairAgg = {
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

type ClosedLoan = {
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

type StakeConfig = {
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

type ScoreConfig = {
  loan_duration_days: number;
  grace_period_hours: number;
  default_fee_multiplier: number;
  first_loan_cap_usd: number;
  max_absolute_cap_usd: number;
};

const STATE_LABEL: Record<string, string> = {
  en_cours: "En cours",
  echeance_proche: "Échéance proche",
  en_grace: "En grâce",
  grace_expiree: "Grâce expirée",
  repaid: "Remboursé",
  defaulted: "Défaut",
  liquidated: "Saisi / liquidé"
};

function stateTone(state: string): Tone {
  if (state === "defaulted" || state === "grace_expiree" || state === "liquidated") return "bad";
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

function reasonLabel(row: ClosedLoan): string {
  if (row.status === "repaid") return "Remboursé";
  if (row.liquidation_reason === "overdue") return "Échéance dépassée";
  if (row.liquidation_reason === "ltv") return "LTV de liquidation atteint";
  // Anciens prêts wallet (sans échéance) : la seule cause possible est le LTV.
  return row.collateral_source === "wallet" ? "LTV de liquidation atteint" : "—";
}

/** « dans 3 j 4 h » / « dépassée de 5 h » */
function relDelta(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const d = Math.floor(h / 24);
  const txt = d >= 1 ? `${d} j ${h % 24} h` : h >= 1 ? `${h} h` : `${Math.max(1, Math.floor(abs / 60_000))} min`;
  return ms >= 0 ? `dans ${txt}` : `dépassée de ${txt}`;
}

type Flag = { label: string; tone: Tone; sev: number };
type Watch = { key: string; product: string; user_id: string; debtUsd: number; flags: Flag[]; due: string | null };

function guaranteedFlags(row: LoanRisk): Flag[] {
  const flags: Flag[] = [];
  if (row.risk_state === "grace_expiree") flags.push({ label: "Grâce expirée · saisie imminente", tone: "bad", sev: 100 });
  else if (row.risk_state === "en_grace") flags.push({ label: "Échéance dépassée · en grâce", tone: "warn", sev: 60 });
  else if (row.risk_state === "echeance_proche") flags.push({ label: "Échéance proche", tone: "info", sev: 20 });
  const m = row.marge_avant_liquidation_pct;
  if (m !== null && m < LTV_MARGIN_WARN) flags.push({ label: `Marge LTV ${formatPct(m)}`, tone: marginTone(m), sev: 90 - m });
  return flags;
}

export default async function CreditPage({ searchParams }: { searchParams: SettingsParams }) {
  const db = getSupabaseAdmin();
  const fmtUpdated = (iso?: string) => (iso ? formatDateTime(new Date(iso)) : null);
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

  const stakeHint = stakeConfig
    ? `${stakeConfig.is_active ? "" : "PRODUIT DÉSACTIVÉ · "}Garantie : stake WAKATI bloqué. Durée ${stakeConfig.min_duration_days}–${stakeConfig.max_duration_days} j (défaut ${stakeConfig.default_duration_days}), grâce ${stakeConfig.grace_period_hours} h, frais d'ouverture ${formatPct(stakeConfig.origination_fee_pct)}, prolongation ${formatPct(stakeConfig.extension_fee_pct)} / ${stakeConfig.extension_days} j (max ${stakeConfig.max_extensions_per_loan}), plafond de dette ${formatUsd(stakeConfig.max_user_debt_usd)} par utilisateur, emprunt de WAKATI ${stakeConfig.allow_wakati_borrow ? "autorisé" : "interdit"}. Après la grâce ou si le LTV de liquidation est atteint, le stake est saisi.`
    : "Configuration des prêts sur staking introuvable (table stake_loan_config).";

  return (
    <div>
      <PageHeader
        title="Crédit"
        subtitle="Trois produits : prêts sur staking WAKATI, prêts sur garantie wallet, micro-prêts sur score. Encours, échéances, risque de saisie et défauts."
        updatedAt={formatDateTime(new Date())}
      />
      <SettingsMessages searchParams={searchParams} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard
          label="Encours total"
          value={formatCompactUsd(encoursTotal)}
          sub={`Staking ${formatCompactUsd(stakeEncours)} · Wallet ${formatCompactUsd(walletEncours)} · Score ${formatCompactUsd(scoreEncours)}`}
        />
        <StatCard label="Prêts actifs" value={String(actifsTotal)} sub={`${stakeActifs} staking · ${walletActifs} wallet · ${scoreActifs} score`} />
        <StatCard
          label="À surveiller"
          value={String(aRisqueTotal)}
          sub="Marge LTV < 10 % ou échéance dépassée"
          tone={aRisqueTotal > 0 ? "bad" : "ok"}
        />
        <StatCard
          label="Taux de saisie / défaut"
          value={formatPct(Math.max(stakeRate, walletRate, scoreRate))}
          sub={`Staking ${formatPct(stakeRate)} · Wallet ${formatPct(walletRate)} · Score ${formatPct(scoreRate)}`}
        />
      </div>

      <Section title="À surveiller" hint="Tous produits confondus, du plus urgent au moins urgent : grâce expirée, marge LTV faible, échéance dépassée ou proche.">
        {watch.length === 0 ? (
          <Empty text="Rien à surveiller : aucun prêt proche de la saisie ou en retard." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Produit</Th>
                <Th>Utilisateur</Th>
                <Th right>Dette (USD)</Th>
                <Th>Signaux</Th>
                <Th right hideSm>Échéance</Th>
              </tr>
            </thead>
            <tbody>
              {watch.map((w) => (
                <tr key={w.key}>
                  <Td label="Produit"><Pill tone="info">{w.product}</Pill></Td>
                  <Td label="Utilisateur">
                    <a className="wk-link" href={`/dashboard/users/${w.user_id}`}>
                      <div className="wk-asset-sub">{shortId(w.user_id)}</div>
                    </a>
                  </Td>
                  <Td right label="Dette (USD)">{formatUsd(w.debtUsd)}</Td>
                  <Td label="Signaux">
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {w.flags.map((f) => <Pill key={f.label} tone={f.tone}>{f.label}</Pill>)}
                    </div>
                  </Td>
                  <Td right hideSm label="Échéance">
                    {w.due ? (
                      <>
                        <div>{formatDateTime(new Date(w.due))}</div>
                        <div className="wk-asset-sub">{relDelta(w.due)}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Prêts sur staking WAKATI" hint={stakeHint}>
        <div className="wk-strip" style={{ marginBottom: 16 }}>
          <StatCard label="Actifs" value={String(stakeActifs)} sub={`${summary?.stake_loans_total ?? 0} prêt(s) au total`} />
          <StatCard label="Encours" value={formatCompactUsd(stakeEncours)} sub="Dette en USD (principal + intérêts)" />
          <StatCard label="WAKATI bloqué" value={formatNumber(summary?.stake_collateral_locked ?? 0)} sub="Garantie verrouillée dans les stakes" />
          <StatCard
            label="Saisies (total)"
            value={String(summary?.stake_loans_saisis_total ?? 0)}
            sub={`${summary?.stake_loans_a_risque ?? 0} actif(s) à surveiller`}
            tone={(summary?.stake_loans_a_risque ?? 0) > 0 ? "warn" : undefined}
          />
        </div>
        {stakeLoans.length === 0 ? <Empty text="Aucun prêt sur staking actif." /> : <GuaranteedTable rows={stakeLoans} withDue />}
      </Section>

      <Section
        title="Prêts sur garantie wallet"
        hint="Garantie prélevée sur le solde (MATIC, FCFA, BTC…). Pas d'échéance : seul le LTV de liquidation déclenche la saisie."
      >
        {walletLoans.length === 0 ? <Empty text="Aucun prêt sur garantie wallet actif." /> : <GuaranteedTable rows={walletLoans} />}
      </Section>

      <Section title="Prêts garantis — par paire d'actifs" hint="Encours et sinistralité par source de garantie et paire garantie / emprunté (tous statuts).">
        {pairRes.rows.length === 0 ? (
          <Empty text="Aucun prêt garanti pour l'instant." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Source</Th>
                <Th>Garantie</Th>
                <Th>Emprunté</Th>
                <Th right>Actifs</Th>
                <Th right>Remboursés</Th>
                <Th right>Saisis</Th>
                <Th right>À risque</Th>
                <Th right>Encours emprunté</Th>
                <Th right hideSm>Garantie verrouillée</Th>
              </tr>
            </thead>
            <tbody>
              {pairRes.rows.map((row) => {
                const key = `${row.collateral_source}/${row.collateral_asset}/${row.borrow_asset}`;
                const risk = Number(row.prets_a_risque || 0);
                return (
                  <tr key={key}>
                    <Td label="Source">{row.collateral_source === "stake" ? "Staking" : "Wallet"}</Td>
                    <Td label="Garantie">{row.collateral_asset}</Td>
                    <Td label="Emprunté">{row.borrow_asset}</Td>
                    <Td right label="Actifs">{row.prets_actifs}</Td>
                    <Td right label="Remboursés">{row.prets_rembourses}</Td>
                    <Td right label="Saisis">{row.prets_liquides}</Td>
                    <Td right label="À risque">{risk > 0 ? <Pill tone="bad">{risk}</Pill> : "—"}</Td>
                    <Td right label="Encours emprunté">{formatNumber(Number(row.total_emprunte_actif))} <span className="wk-asset-sub">{row.borrow_asset}</span></Td>
                    <Td right hideSm label="Garantie verrouillée">{formatNumber(Number(row.total_collateral_verrouille))} <span className="wk-asset-sub">{row.collateral_asset}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}

        {closedRes.rows.length > 0 && (
          <details style={{ marginTop: 16 }}>
            <summary className="wk-link" style={{ cursor: "pointer" }}>Voir les dernières clôtures ({closedRes.rows.length} prêt(s) garanti(s))</summary>
            <div style={{ marginTop: 12 }}>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th>Utilisateur</Th>
                    <Th>Garantie</Th>
                    <Th>Dette</Th>
                    <Th>Issue</Th>
                    <Th right hideSm>Ouvert le</Th>
                    <Th right hideSm>Clos le</Th>
                  </tr>
                </thead>
                <tbody>
                  {closedRes.rows.map((row) => (
                    <tr key={row.id}>
                      <Td label="Source">{row.collateral_source === "stake" ? "Staking" : "Wallet"}</Td>
                      <Td label="Utilisateur">
                        <a className="wk-link" href={`/dashboard/users/${row.user_id}`}>
                          <div className="wk-asset-sub">{shortId(row.user_id)}</div>
                        </a>
                      </Td>
                      <Td label="Garantie">{formatNumber(row.collateral_amount)} <span className="wk-asset-sub">{row.collateral_asset}</span></Td>
                      <Td label="Dette">{formatNumber(Number(row.principal_amount) + Number(row.accrued_interest))} <span className="wk-asset-sub">{row.borrow_asset}</span></Td>
                      <Td label="Issue">
                        <Pill tone={row.status === "repaid" ? "ok" : "bad"}>{reasonLabel(row)}</Pill>
                      </Td>
                      <Td right hideSm label="Ouvert le">{formatDateTime(new Date(row.opened_at))}</Td>
                      <Td right hideSm label="Clos le">{row.closed_at ? formatDateTime(new Date(row.closed_at)) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </details>
        )}
      </Section>

      <Section
        title="Micro-prêts sur score crédit"
        hint={
          scoreConfig
            ? `Config actuelle : durée ${scoreConfig.loan_duration_days} j, grâce ${scoreConfig.grace_period_hours} h, plafond 1er prêt ${formatUsd(scoreConfig.first_loan_cap_usd)}, plafond absolu ${formatUsd(scoreConfig.max_absolute_cap_usd)}. Modifiable en bas de page, dans « Réglages des prêts ».`
            : undefined
        }
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
                  <Td label="Statut"><Pill tone={stateTone(row.risk_state)}>{STATE_LABEL[row.risk_state] || row.risk_state}</Pill></Td>
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
                      <Td label="Statut"><Pill tone={stateTone(row.risk_state)}>{STATE_LABEL[row.risk_state] || row.risk_state}</Pill></Td>
                      <Td label="Ouvert le">{formatDateTime(new Date(row.opened_at))}</Td>
                      <Td label="Clos le">{row.closed_at ? formatDateTime(new Date(row.closed_at)) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </details>
        )}
      </Section>

      <Section
        title="Réglages des prêts"
        hint="S'appliquent aux nouveaux prêts : un prêt en cours garde le taux et le seuil de saisie de son ouverture. Chaque carte s'enregistre séparément et est tracée dans le journal d'audit."
      >
        {sk ? (
          <SettingsCard
            returnTo={RETURN}
            title="Prêts sur staking — règles"
            hint="Durée, délai de grâce, frais et plafond de dette. Le produit se coupe avec « Produit actif »."
            updatedAt={fmtUpdated(sk.updated_at)}
            action={updateStakeLoanConfig}
          >
            <Field label="Durée minimale (jours)" name="min_duration_days" step="1" defaultValue={sk.min_duration_days} />
            <Field label="Durée maximale (jours)" name="max_duration_days" step="1" defaultValue={sk.max_duration_days} />
            <Field label="Durée proposée par défaut (jours)" name="default_duration_days" step="1" defaultValue={sk.default_duration_days} hint="Doit rester entre la durée minimale et maximale." />
            <Field label="Délai de grâce (heures)" name="grace_period_hours" step="1" defaultValue={sk.grace_period_hours} hint="Après l'échéance, avant la saisie de la garantie." />
            <Field label="Rappel avant échéance (heures)" name="due_soon_notice_hours" step="1" defaultValue={sk.due_soon_notice_hours} />
            <Field label="Frais d'ouverture (%)" name="origination_fee_pct" defaultValue={sk.origination_fee_pct} hint="Retenus sur le montant versé." />
            <Field label="Frais de prolongation (%)" name="extension_fee_pct" defaultValue={sk.extension_fee_pct} />
            <Field label="Durée d'une prolongation (jours)" name="extension_days" step="1" defaultValue={sk.extension_days} />
            <Field label="Prolongations max par prêt" name="max_extensions_per_loan" step="1" defaultValue={sk.max_extensions_per_loan} />
            <Field label="Plafond de dette par utilisateur (USD)" name="max_user_debt_usd" defaultValue={sk.max_user_debt_usd} />
            <Toggle label="Emprunt de WAKATI autorisé" name="allow_wakati_borrow" defaultChecked={sk.allow_wakati_borrow} />
            <Toggle label="Produit actif" name="is_active" defaultChecked={sk.is_active} />
          </SettingsCard>
        ) : (
          <div className="wk-alert-bad">Aucune ligne trouvée dans stake_loan_config (id=1).</div>
        )}

        {coll ? (
          <SettingsCard
            returnTo={RETURN}
            title="Garantie WAKATI"
            hint="Part de la valeur du stake que l'on peut emprunter, seuil de saisie et pénalité."
            updatedAt={fmtUpdated(coll.updated_at)}
            action={updateLendingCollateralConfig}
          >
            <input type="hidden" name="asset_symbol" value="WAKATI" />
            <Field label="LTV maximum à l'ouverture (%)" name="max_ltv_pct" defaultValue={coll.max_ltv_pct} />
            <Field label="LTV de saisie (%)" name="liquidation_ltv_pct" defaultValue={coll.liquidation_ltv_pct} hint="Doit rester au-dessus du LTV maximum." />
            <Field label="Pénalité de saisie (%)" name="liquidation_penalty_pct" defaultValue={coll.liquidation_penalty_pct} hint="Appliquée au surplus de garantie." />
            <Toggle label="WAKATI accepté en garantie" name="is_active" defaultChecked={coll.is_active} />
          </SettingsCard>
        ) : (
          <div className="wk-alert-bad">Aucune ligne WAKATI dans lending_collateral_config.</div>
        )}

        {borrowRes.rows.length > 0 && (
          <details style={{ marginBottom: 16 }}>
            <summary className="wk-link" style={{ cursor: "pointer", marginBottom: 12 }}>Taux et limites par actif emprunté ({borrowRes.rows.length} actifs)</summary>
            {borrowRes.rows.map((b: any) => (
              <SettingsCard
                key={b.asset_symbol}
                returnTo={RETURN}
                title={b.asset_symbol}
                hint="Taux annuel et limites d'emprunt. Ces taux sont aussi ceux des prêts sur garantie wallet encore actifs."
                updatedAt={fmtUpdated(b.updated_at)}
                action={updateLendingBorrowConfig}
              >
                <input type="hidden" name="asset_symbol" value={b.asset_symbol} />
                <Field label="Taux annuel (%)" name="apr_rate_pct" defaultValue={b.apr_rate_pct} />
                <Field label="Emprunt minimum" name="min_borrow_amount" defaultValue={b.min_borrow_amount} />
                <Field label="Emprunt maximum par prêt" name="max_borrow_amount" defaultValue={b.max_borrow_amount ?? ""} hint="Vide = illimité." />
                <Field label="Plafond total de la plateforme" name="max_total_borrowed" defaultValue={b.max_total_borrowed ?? ""} hint="Vide = illimité." />
                <Toggle label="Actif" name="is_active" defaultChecked={b.is_active} />
              </SettingsCard>
            ))}
          </details>
        )}

      {sc ? (
        <SettingsCard returnTo={RETURN} title="Prêts sur score de crédit" hint="Paramètres principaux des micro-prêts accordés selon le score de l'utilisateur." updatedAt={fmtUpdated(sc.updated_at)} action={updateScoreCreditConfig}>
          <Field label="Taux de conversion de base (%)" name="conversion_rate_base_pct" defaultValue={sc.conversion_rate_base_pct} />
          <Field label="Taux de conversion max (%)" name="conversion_rate_max_pct" defaultValue={sc.conversion_rate_max_pct} />
          <Field label="Frais min requis (USD, 90 j)" name="min_fees_required_usd" defaultValue={sc.min_fees_required_usd} />
          <Field label="Âge min du compte (jours)" name="min_account_age_days" step="1" defaultValue={sc.min_account_age_days} />
          <Field label="Plafond 1er prêt (USD)" name="first_loan_cap_usd" defaultValue={sc.first_loan_cap_usd} />
          <Field label="Plafond absolu (USD)" name="max_absolute_cap_usd" defaultValue={sc.max_absolute_cap_usd} />
          <Field label="Durée du prêt (jours)" name="loan_duration_days" step="1" defaultValue={sc.loan_duration_days} />
          <Field label="Délai de grâce (heures)" name="grace_period_hours" step="1" defaultValue={sc.grace_period_hours} />
          <Toggle label="Prêts sur score actifs" name="is_active" defaultChecked={sc.is_active} />
          <div className="wk-hint" style={{ gridColumn: "1/-1" }}>D'autres réglages avancés (extensions, frais cross-asset...) existent dans cette table mais ne sont pas encore éditables ici.</div>
        </SettingsCard>
      ) : (
        <div className="wk-alert-bad">Section Prêts sur score : aucune ligne trouvée dans score_credit_config (id=1).</div>
      )}

      </Section>
    </div>
  );
}

/** Tableau des prêts garantis actifs. `withDue` ajoute échéance, état et prolongations (prêts sur staking). */
function GuaranteedTable({ rows, withDue }: { rows: LoanRisk[]; withDue?: boolean }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Utilisateur</Th>
          <Th>Garantie</Th>
          <Th>Dette</Th>
          <Th right hideSm>Dette (USD)</Th>
          <Th>LTV actuel vs liquidation</Th>
          {withDue ? <Th>État</Th> : null}
          {withDue ? <Th>Échéance</Th> : null}
          {withDue ? <Th right hideSm>Prolong.</Th> : null}
          <Th right hideSm>Ouvert le</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.loan_id}>
            <Td label="Utilisateur">
              <a className="wk-link" href={`/dashboard/users/${row.user_id}`}>
                <div className="wk-asset-sub">{shortId(row.user_id)}</div>
              </a>
            </Td>
            <Td label="Garantie">
              {formatNumber(row.collateral_amount)} <span className="wk-asset-sub">{row.collateral_asset}</span>
              <div className="wk-asset-sub">{formatUsd(row.collateral_value_usd)}</div>
            </Td>
            <Td label="Dette">{formatNumber(row.total_debt)} <span className="wk-asset-sub">{row.borrow_asset}</span></Td>
            <Td right hideSm label="Dette (USD)">{formatUsd(row.debt_value_usd)}</Td>
            <Td label="LTV">
              {row.current_ltv_pct === null ? (
                "—"
              ) : (
                <>
                  <CoverageBar ratio={row.current_ltv_pct / row.liquidation_ltv_snapshot} tone={marginTone(row.marge_avant_liquidation_pct)} />
                  <div className="wk-asset-sub">
                    {formatPct(row.current_ltv_pct)} / {formatPct(row.liquidation_ltv_snapshot)} · marge {row.marge_avant_liquidation_pct !== null ? formatPct(row.marge_avant_liquidation_pct) : "—"}
                  </div>
                </>
              )}
            </Td>
            {withDue ? (
              <Td label="État"><Pill tone={stateTone(row.risk_state)}>{STATE_LABEL[row.risk_state] || row.risk_state}</Pill></Td>
            ) : null}
            {withDue ? (
              <Td label="Échéance">
                <div>{row.due_at ? formatDateTime(new Date(row.due_at)) : "—"}</div>
                <div className="wk-asset-sub">
                  {relDelta(row.due_at)}
                  {row.grace_until ? ` · grâce jusqu'au ${formatDateTime(new Date(row.grace_until))}` : ""}
                </div>
              </Td>
            ) : null}
            {withDue ? <Td right hideSm label="Prolong.">{row.extensions_used}</Td> : null}
            <Td right hideSm label="Ouvert le">{formatDateTime(new Date(row.opened_at))}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
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
