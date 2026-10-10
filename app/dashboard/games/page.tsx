import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatUsd, formatCompactUsd, formatPct, formatDateTime, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WheelSummary = {
  total_spins: number;
  paid_spins: number;
  free_spins: number;
  winning_spins: number;
  paid_bet_usd: number;
  paid_payout_usd: number;
  rtp_paid_pct: number | null;
  free_spins_cost_usd: number;
  jackpot_hits: number;
  jackpot_paid_usd: number;
};

type WheelSegment = {
  segment_id: number;
  label: string;
  reward_type: string;
  configured_probability_pct: number;
  is_jackpot: boolean;
  is_active: boolean;
  actual_hits: number;
  actual_hit_rate_pct: number | null;
  recent_hits: number;
  recent_total: number;
  recent_hit_rate_pct: number | null;
};

type WheelConfig = {
  jackpot_current_amount: number;
  jackpot_asset_symbol: string;
  paid_spin_cost_amount: number;
  paid_spin_cost_asset: string;
  free_spins_daily: number;
  jackpot_contribution_pct: number;
  is_active: boolean;
};

type PredictionSummary = {
  total_bets: number;
  wins: number;
  losses: number;
  cancelled: number;
  total_wagered_usd: number;
  total_payout_usd: number;
  win_rate_pct: number | null;
};

type PredictionAssetStat = {
  asset_symbol: string;
  total_bets: number;
  wins: number;
  losses: number;
  wagered_usd: number;
  payout_usd: number;
  avg_win_multiplier: number;
  actual_win_rate_pct: number | null;
};

type StreakRow = { user_id: string; best_win_streak: number; total_bets: number; total_wins: number; net_profit: number };
type WheelStreakRow = { user_id: string; longest_streak: number; total_spins: number };

function deviationTone(configured: number, actual: number | null, reliable = true): Tone {
  if (actual === null || !reliable) return "info";
  const gap = Math.abs(actual - configured);
  if (gap >= 10) return "bad";
  if (gap >= 5) return "warn";
  return "ok";
}

function rtpTone(rtp: number | null): Tone {
  if (rtp === null) return "info";
  if (rtp > 110) return "bad";
  if (rtp > 100) return "warn";
  return "ok";
}

export default async function GamesPage() {
  const db = getSupabaseAdmin();

  const [wheelSummaryRes, wheelSegmentsRes, wheelConfigRes, predSummaryRes, predAssetRes, predStreakRes, wheelStreakRes] = await Promise.all([
    db.from("admin_wheel_summary").select("*").maybeSingle(),
    q<WheelSegment>(db.from("admin_wheel_segment_stats").select("*")),
    db.from("wheel_config").select("jackpot_current_amount, jackpot_asset_symbol, paid_spin_cost_amount, paid_spin_cost_asset, free_spins_daily, jackpot_contribution_pct, is_active").eq("id", 1).maybeSingle(),
    db.from("admin_prediction_summary").select("*").maybeSingle(),
    q<PredictionAssetStat>(db.from("admin_prediction_asset_stats").select("*")),
    q<StreakRow>(db.from("prediction_user_stats").select("user_id, best_win_streak, total_bets, total_wins, net_profit").order("best_win_streak", { ascending: false }).limit(10)),
    q<WheelStreakRow>(db.from("user_wheel_stats").select("user_id, longest_streak, total_spins").order("longest_streak", { ascending: false }).limit(10))
  ]);

  // user_wheel_stats.total_spins n'est pas fiable (écart avec wheel_spins) : on recompte à la source pour les lignes affichées.
  const shownStreaks = wheelStreakRes.rows.filter((r) => r.longest_streak > 5).slice(0, 10);
  const realCounts = await Promise.all(shownStreaks.map((r) => db.from("wheel_spins").select("id", { count: "exact", head: true }).eq("user_id", r.user_id)));
  shownStreaks.forEach((r, i) => { r.total_spins = realCounts[i].count ?? r.total_spins; });

  const wheel = wheelSummaryRes.data as WheelSummary | null;
  // Les probabilités ont changé au fil du temps : on juge l'écart sur 30 jours glissants, et seulement si l'échantillon est assez grand.
  const MIN_SAMPLE = 100;
  const recentTotal = Number(wheelSegmentsRes.rows[0]?.recent_total || 0);
  const sampleOk = recentTotal >= MIN_SAMPLE;
  const wheelConfig = wheelConfigRes.data as WheelConfig | null;
  const pred = predSummaryRes.data as PredictionSummary | null;

  const errors = [wheelSummaryRes.error?.message, wheelSegmentsRes.error, wheelConfigRes.error?.message, predSummaryRes.error?.message, predAssetRes.error]
    .filter(Boolean)
    .join(" · ");

  const totalMiseUsd = (wheel?.paid_bet_usd || 0) + (pred?.total_wagered_usd || 0);
  const houseProfitPredUsd = (pred?.total_wagered_usd || 0) - (pred?.total_payout_usd || 0);

  return (
    <div>
      <PageHeader title="Jeux" subtitle="Roue de la fortune et prédictions de prix : volumes, RTP réel et anomalies de distribution." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Volume misé (payant)" value={formatCompactUsd(totalMiseUsd)} sub="Roue + prédictions, hors tours gratuits" />
        <StatCard label="RTP roue (tours payants)" value={wheel?.rtp_paid_pct !== null && wheel?.rtp_paid_pct !== undefined ? formatPct(wheel.rtp_paid_pct) : "—"} sub="Gains reversés / mises, hors tours gratuits" tone={(() => { const t = rtpTone(wheel?.rtp_paid_pct ?? null); return t === "info" ? undefined : t; })()} />
        <StatCard label="Coût tours gratuits" value={formatUsd(wheel?.free_spins_cost_usd || 0)} sub={`${wheel?.free_spins || 0} tour(s) offert(s)`} />
        <StatCard label="Profit prédictions" value={formatUsd(houseProfitPredUsd)} sub={`Taux de victoire réel : ${pred?.win_rate_pct !== null && pred?.win_rate_pct !== undefined ? formatPct(pred.win_rate_pct) : "—"}`} tone={houseProfitPredUsd >= 0 ? "ok" : "bad"} />
      </div>

      <Section
        title="Roue de la fortune"
        hint={wheelConfig ? `Config actuelle : coût du tour payant ${formatNumber(wheelConfig.paid_spin_cost_amount)} ${wheelConfig.paid_spin_cost_asset}, ${wheelConfig.free_spins_daily} tour(s) gratuit(s)/jour, jackpot actuel ${formatNumber(wheelConfig.jackpot_current_amount)} ${wheelConfig.jackpot_asset_symbol} (alimenté à ${wheelConfig.jackpot_contribution_pct}% des mises). Modifiable dans Paramètres.` : undefined}
      >
        <div className="wk-strip" style={{ marginBottom: 16 }}>
          <StatCard label="Tours au total" value={String(wheel?.total_spins ?? 0)} sub={`${wheel?.paid_spins ?? 0} payants · ${wheel?.free_spins ?? 0} gratuits`} />
          <StatCard label="Jackpots remportés" value={String(wheel?.jackpot_hits ?? 0)} sub={formatUsd(wheel?.jackpot_paid_usd || 0)} />
        </div>

        {wheelSegmentsRes.rows.length === 0 ? (
          <Empty text="Aucun segment de roue configuré." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Segment</Th>
                <Th>Type</Th>
                <Th right>Probabilité configurée</Th>
                <Th right>Taux de sortie réel (30 j)</Th>
                <Th right>Occurrences</Th>
                <Th>Statut</Th>
              </tr>
            </thead>
            <tbody>
              {wheelSegmentsRes.rows.map((seg) => (
                <tr key={seg.segment_id}>
                  <Td label="Segment">{seg.label} {seg.is_jackpot && <Pill tone="warn">Jackpot</Pill>}</Td>
                  <Td label="Type">{seg.reward_type}</Td>
                  <Td right label="Probabilité configurée">{formatPct(seg.configured_probability_pct)}</Td>
                  <Td right label="Taux de sortie réel (30 j)">
                    {seg.recent_hit_rate_pct === null ? "—" : (
                      <Pill tone={deviationTone(seg.configured_probability_pct, seg.recent_hit_rate_pct, sampleOk)}>{formatPct(seg.recent_hit_rate_pct)}</Pill>
                    )}
                  </Td>
                  <Td right label="Occurrences">{seg.actual_hits}</Td>
                  <Td label="Statut">{seg.is_active ? <Pill tone="ok">Actif</Pill> : <Pill tone="bad">Inactif</Pill>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          Taux de sortie calculé sur les {recentTotal} tours des 30 derniers jours (les probabilités ayant été modifiées au fil du temps, l'historique complet n'est pas comparable). {sampleOk ? "Un écart de 5 à 10 points est à surveiller, au-delà de 10 points c'est une vraie anomalie à creuser." : `Échantillon trop petit (moins de ${MIN_SAMPLE} tours) : aucune alerte n'est levée.`} Occurrences : depuis le début.
        </div>
      </Section>

      {wheelStreakRes.rows.some((r) => r.longest_streak > 5) && (
        <Section title="Roue — plus longues séries" hint="Nombre de jours consécutifs avec un tour joué. Une série très longue par rapport au nombre total de tours mérite un coup d'œil, sans être en soi une preuve de triche (la roue distribue un gain à chaque tour).">
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th right>Série la plus longue</Th>
                <Th right>Tours au total</Th>
              </tr>
            </thead>
            <tbody>
              {shownStreaks.map((row) => (
                <tr key={row.user_id}>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${row.user_id}`}><div className="wk-asset-sub">{shortId(row.user_id)}</div></a></Td>
                  <Td right label="Série">{row.longest_streak}</Td>
                  <Td right label="Tours au total">{row.total_spins}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}

      <Section title="Prédictions de prix" hint="Le seuil d'équilibre (100 / multiplicateur) est le taux de victoire à partir duquel la plateforme commence à perdre de l'argent sur ce marché.">
        <div className="wk-strip" style={{ marginBottom: 16 }}>
          <StatCard label="Paris au total" value={String(pred?.total_bets ?? 0)} sub={`${pred?.wins ?? 0} gagnés · ${pred?.losses ?? 0} perdus · ${pred?.cancelled ?? 0} annulés`} />
          <StatCard label="Volume misé" value={formatUsd(pred?.total_wagered_usd || 0)} sub="Hors paris annulés" />
        </div>

        {predAssetRes.rows.length === 0 ? (
          <Empty text="Aucun pari sur les prédictions de prix." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif prédit</Th>
                <Th right>Paris</Th>
                <Th right>Misé</Th>
                <Th right>Reversé</Th>
                <Th right>Multiplicateur moyen</Th>
                <Th right>Seuil d'équilibre</Th>
                <Th right>Taux de victoire réel</Th>
              </tr>
            </thead>
            <tbody>
              {predAssetRes.rows.map((row) => {
                const breakeven = row.avg_win_multiplier > 0 ? 100 / row.avg_win_multiplier : null;
                const tone = deviationTone(breakeven ?? 0, row.actual_win_rate_pct);
                return (
                  <tr key={row.asset_symbol}>
                    <Td label="Actif prédit">{row.asset_symbol}</Td>
                    <Td right label="Paris">{row.total_bets} <span className="wk-asset-sub">({row.wins}G / {row.losses}P)</span></Td>
                    <Td right label="Misé">{formatUsd(row.wagered_usd)}</Td>
                    <Td right label="Reversé">{formatUsd(row.payout_usd)}</Td>
                    <Td right label="Multiplicateur moyen">×{formatNumber(row.avg_win_multiplier, 2)}</Td>
                    <Td right label="Seuil d'équilibre">{breakeven !== null ? formatPct(breakeven) : "—"}</Td>
                    <Td right label="Taux de victoire réel">
                      {row.actual_win_rate_pct === null ? "—" : <Pill tone={tone}>{formatPct(row.actual_win_rate_pct)}</Pill>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {predStreakRes.rows.some((r) => r.best_win_streak >= 3) && (
        <Section title="Prédictions — plus longues séries de victoires" hint="Une longue série de bonnes prédictions consécutives est statistiquement improbable au-delà de quelques coups et mérite une vérification manuelle.">
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th right>Meilleure série</Th>
                <Th right>Paris</Th>
                <Th right>Victoires</Th>
                <Th right>Profit net</Th>
              </tr>
            </thead>
            <tbody>
              {predStreakRes.rows.filter((r) => r.best_win_streak >= 3).map((row) => (
                <tr key={row.user_id}>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${row.user_id}`}><div className="wk-asset-sub">{shortId(row.user_id)}</div></a></Td>
                  <Td right label="Meilleure série"><Pill tone={row.best_win_streak >= 6 ? "bad" : "warn"}>{row.best_win_streak}</Pill></Td>
                  <Td right label="Paris">{row.total_bets}</Td>
                  <Td right label="Victoires">{row.total_wins}</Td>
                  <Td right label="Profit net">{formatNumber(row.net_profit)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}
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
