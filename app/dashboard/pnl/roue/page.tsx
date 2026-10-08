import { loadWheelAudit } from "@/lib/wheel-audit";
import { formatNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { Signals, PeriodTabs, parsePeriod } from "@/components/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = [{ value: 30, label: "30 jours" }, { value: 90, label: "90 jours" }, { value: 0, label: "Depuis le début" }];
const signed = (n: number) => `${n > 0.00005 ? "+" : ""}${formatUsd(n)}`;
const tone = (n: number) => (n > 0.00005 ? "wk-ok" : n < -0.00005 ? "wk-bad" : "");
const pct = (n: number | null) => (n === null ? "—" : formatPct(n, 0));

export default async function WheelAuditPage({ searchParams }: { searchParams: { p?: string } }) {
  const period = parsePeriod(searchParams.p, [30, 90, 0], 30);
  const r = await loadWheelAudit(period);
  const t = r.theory, o = r.observed, cfg = r.config;
  const periodLabel = PERIODS.find((x) => x.value === period)!.label.toLowerCase();

  return (
    <div>
      <PageHeader title="Roue : ce qui devrait arriver contre ce qui arrive" subtitle="Rendement théorique de la roue configurée, comparé aux tours réellement joués, avec un test d'équité statistique." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      <PeriodTabs base="/dashboard/pnl/roue" periods={PERIODS} current={period} />

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Rendement théorique joueur</div><div className="wk-strip-value">{pct(t?.rtpPct ?? null)}</div><div className="wk-strip-sub">{t?.houseEdgePct != null ? `Marge théorique ${formatPct(t.houseEdgePct, 0)}` : "Non calculable"}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Seuil de rentabilité</div><div className="wk-strip-value">{t?.breakEvenPrice ? `${t.breakEvenPrice.toFixed(5)} $` : "—"}</div><div className="wk-strip-sub">Prix du {t?.singleAsset ?? "jeton"} (actuel : {t?.wakatiPrice ? `${t.wakatiPrice.toFixed(5)} $` : "—"})</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Tours ({periodLabel})</div><div className="wk-strip-value">{formatNumber(o.spins, 0)}</div><div className="wk-strip-sub">{o.paid} payants · {o.free} gratuits</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Résultat des jeux</div><div className={`wk-strip-value ${tone(o.netUsd)}`}>{signed(o.netUsd)}</div><div className="wk-strip-sub">{o.rtpAllPct === null ? "Aucune mise" : `Joueurs : ${formatPct(o.rtpAllPct, 0)} des mises (gratuits inclus)`}</div></div>
      </div>

      <Signals items={r.signals} />

      {cfg && t && (
        <Section title="La roue telle qu'elle est configurée" hint="Paramètres actuels et valeur d'un tour au cours du jour.">
          <div className="wk-panel" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
            Un tour payant coûte <strong>{formatNumber(cfg.costAmount, 2)} {cfg.costAsset}</strong>{t.costUsd !== null ? ` (${formatUsd(t.costUsd)})` : ""}.
            Il verse en moyenne <strong>{formatNumber(t.evNative, 2)} {t.singleAsset ?? ""}</strong>{t.evUsd !== null ? ` (${formatUsd(t.evUsd)})` : ""}.
            {" "}{formatNumber(cfg.jackpotPct, 1)} % de chaque mise alimente la cagnotte jackpot (actuellement {formatNumber(cfg.jackpotAmount, 2)} {cfg.jackpotAsset}).
          </div>
        </Section>
      )}

      <Section title="Répartition des tirages" hint="Attendu = nombre de tours × probabilité du segment. Un écart statistique au-delà de 3 est suspect.">
        <TableWrap>
          <thead><tr><Th>Segment</Th><Th right>Probabilité</Th><Th right>Attendus</Th><Th right>Observés</Th><Th right hideSm>Écart statistique</Th><Th>Verdict</Th></tr></thead>
          <tbody>
            {r.segments.length === 0 ? <tr><Td colSpan={6}>Aucun segment actif.</Td></tr> : r.segments.map((s) => {
              const az = s.z === null ? null : Math.abs(s.z);
              return (
                <tr key={s.label}>
                  <Td label="Segment">{s.label}</Td>
                  <Td right label="Probabilité">{formatPct(s.probability, 0)}</Td>
                  <Td right label="Attendus">{formatNumber(s.expected, 1)}</Td>
                  <Td right label="Observés">{s.observed}</Td>
                  <Td right hideSm label="Écart">{s.z === null ? "—" : s.z.toFixed(1)}</Td>
                  <Td label="Verdict">{az === null ? <Pill tone="info">Trop peu de tours</Pill> : <Pill tone={az > 3 ? "bad" : az > 2 ? "warn" : "ok"}>{az > 3 ? "Anormal" : az > 2 ? "À surveiller" : "Normal"}</Pill>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par monnaie de mise" hint="Ce que rapportent et coûtent les tours selon la monnaie utilisée pour miser (tours payants uniquement).">
        <TableWrap>
          <thead><tr><Th>Monnaie</Th><Th right>Tours</Th><Th right>Mises</Th><Th right>Mises (USD)</Th><Th right>Gains (USD)</Th><Th right>Rendement joueur</Th></tr></thead>
          <tbody>
            {r.byBetAsset.length === 0 ? <tr><Td colSpan={6}>Aucun tour payant sur la période.</Td></tr> : r.byBetAsset.map((b) => (
              <tr key={b.asset}>
                <Td label="Monnaie">{b.asset}</Td>
                <Td right label="Tours">{b.spins}</Td>
                <Td right label="Mises">{formatNumber(b.bets, 2)} {b.asset}</Td>
                <Td right label="Mises (USD)">{formatUsd(b.betsUsd)}</Td>
                <Td right label="Gains (USD)">{formatUsd(b.payoutUsd)}</Td>
                <Td right label="Rendement"><strong>{pct(b.rtp)}</strong></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <p className="wk-hint">Valorisation : prix du jour pour le WAKATI quand il est connu (environ 31 jours), sinon cours actuel. Si la roue a été reconfigurée dans la période, la comparaison avec les probabilités actuelles est approximative.</p>
    </div>
  );
}
