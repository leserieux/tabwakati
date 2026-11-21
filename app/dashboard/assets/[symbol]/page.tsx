import { getSupabaseAdmin, loadPrices, q } from "@/lib/data";
import { loadSolvencyLines } from "@/lib/solvency";
import { loadStakingPlanData } from "@/lib/staking-plan-data";
import { loadFunding, actionText, URGENCY_LABEL, URGENCY_TONE } from "@/lib/funding";
import { RunwayCell, StressRows } from "@/components/funding-view";
import { statusLabel, statusTone, lineGap, lineRatio, lineUsd, isMobileLine } from "@/lib/asset-view";
import { txTypeLabel, txStatusTone, txStatusLabel } from "@/lib/transactions";
import { formatNumber, formatUsd, formatPct, formatDateTime, formatDate, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TxRow = { id: string; user_id: string; type: string; amount: number; status: string | null; created_at: string };

/**
 * Fiche d'un actif : un seul écran pour répondre à « où en est cet actif ? ».
 * Dû / détenu / écart (même calcul que la page Couverture), où se trouve l'argent, plans de staking de l'actif,
 * derniers mouvements. Les pages de détail (Réserve de retrait, Collecte, Plan staking…) restent à un clic.
 */
export default async function AssetPage({ params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol);
  const prices = await loadPrices();
  const [{ crypto, mobile, error }, staking] = await Promise.all([loadSolvencyLines(prices), loadStakingPlanData()]);
  const line = [...crypto, ...mobile].find((l) => l.asset.toUpperCase() === symbol.toUpperCase());

  if (!line) {
    const isWakati = symbol.toUpperCase() === "WAKATI";
    return (
      <div>
        <PageHeader title={symbol} subtitle="Fiche actif" updatedAt={formatDateTime(new Date())} />
        <ErrorNote text={error ? `Le calcul n'a pas pu être fait : ${error}` : null} />
        <Empty text={isWakati ? "WAKATI est un jeton interne : il n'a pas de réserve à couvrir. Ses pages sont dans la section WAKATI." : `Aucun actif « ${symbol} » avec un solde ou un dû. Il n'est peut-être pas encore utilisé.`} />
        <p style={{ marginTop: 14 }}>
          <a className="wk-link" href={isWakati ? "/dashboard/wakati" : "/dashboard/assets"}>{isWakati ? "Ouvrir la section WAKATI →" : "← Tous les actifs"}</a>
        </p>
      </div>
    );
  }

  const funding = (await loadFunding({ crypto, mobile })).lines.find((f) => f.plan.asset === line.asset);
  const db = getSupabaseAdmin();
  const txs = await q<TxRow>(db.from("transactions").select("id, user_id, type, amount, status, created_at").eq("asset_symbol", line.asset).order("created_at", { ascending: false }).limit(15));
  const userIds = [...new Set(txs.rows.map((t) => t.user_id).filter(Boolean))];
  const names = userIds.length ? await q<{ id: string; username: string | null }>(db.from("admin_users_overview").select("id, username").in("id", userIds)) : { rows: [] as { id: string; username: string | null }[] };
  const nameOf = new Map(names.rows.map((u) => [u.id, u.username || ""]));

  const gap = lineGap(line);
  const tone = statusTone(line.status);
  const pools = (staking.data?.pools ?? []).filter((p) => p.asset.toUpperCase() === line.asset.toUpperCase());
  const mobileLine = isMobileLine(line);
  const where: { label: string; value: number }[] = [];
  if (line.hot !== null && line.hot !== undefined) where.push({ label: mobileLine ? "Chez le prestataire de paiement" : "Portefeuille de retrait", value: line.hot });
  if ((line.vault ?? 0) > 0) where.push({ label: "Coffre", value: line.vault as number });
  if ((line.onUsers ?? 0) > 0) where.push({ label: "Pas encore collecté (adresses des utilisateurs)", value: line.onUsers as number });

  return (
    <div>
      <PageHeader title={line.asset} subtitle={`${line.label} · fiche actif`} updatedAt={formatDateTime(new Date())} />
      <p style={{ margin: "-6px 0 16px" }}><a className="wk-link" href="/dashboard/assets">← Tous les actifs</a></p>
      <ErrorNote text={line.error ? `Lecture incomplète : ${line.error}` : null} />

      <div className="wk-exchange-kpis">
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Prix</span><span className="wk-exchange-kpi-value">{line.priceUsd === null ? "non valorisé" : formatUsd(line.priceUsd)}</span><span className="wk-exchange-kpi-detail">{line.priceUsd === null ? "aucun prix valide : totaux en dollars exclus" : "prix du jour"}</span></div>
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Dû aux utilisateurs</span><span className="wk-exchange-kpi-value">{formatNumber(line.owe)}</span><span className="wk-exchange-kpi-detail">{lineUsd(line, line.owe) === null ? "" : formatUsd(lineUsd(line, line.owe) as number)}</span></div>
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Détenu</span><span className="wk-exchange-kpi-value">{line.have === null ? "illisible" : formatNumber(line.have)}</span><span className="wk-exchange-kpi-detail">{lineUsd(line, line.have) === null ? "" : formatUsd(lineUsd(line, line.have) as number)}</span></div>
        <div className={`wk-exchange-kpi ${gap === null ? "" : gap < -1e-8 ? "wk-exchange-kpi-negative" : "wk-exchange-kpi-positive"}`}><span className="wk-exchange-kpi-label">Écart</span><span className="wk-exchange-kpi-value">{gap === null ? "—" : `${gap > 0 ? "+" : ""}${formatNumber(gap)}`}</span><span className="wk-exchange-kpi-detail"><Pill tone={tone}>{statusLabel(line.status)}</Pill></span></div>
      </div>

      {funding && (
        <Section title="Autonomie et test de stress" hint="Combien de temps ce qui est prêt à partir paie les retraits, et ce qui se passerait si les plus gros utilisateurs retiraient ensemble.">
          <div className="wk-panel">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
              <Pill tone={URGENCY_TONE[funding.urgency]}>{URGENCY_LABEL[funding.urgency]}</Pill>
              <span>Au pire jour : <RunwayCell days={funding.runwayPeak} empty="aucun retrait observé" /></span>
              <span>Au rythme moyen : <RunwayCell days={funding.runwayAvg} empty="aucun retrait observé" /></span>
              {funding.unlock7 > 0 && <span>Staking bloqué à échéance sous 7 jours : {formatNumber(funding.unlock7)} {line.asset}</span>}
            </div>
            {funding.action.kind !== "none" && <p style={{ margin: "0 0 14px" }}><strong>À faire : </strong>{actionText(funding)}</p>}
            {funding.stress.length === 0 ? <Empty text="Aucun solde utilisateur à tester." /> : (
              <TableWrap>
                <thead><tr><Th>Cas</Th><Th right>À payer</Th><Th>Résultat</Th></tr></thead>
                <tbody><StressRows f={funding} /></tbody>
              </TableWrap>
            )}
            <p className="wk-panel-hint" style={{ marginTop: 12, marginBottom: 0 }}><a className="wk-link" href="/dashboard/funding">Tous les actifs à approvisionner →</a></p>
          </div>
        </Section>
      )}

      <div className="wk-grid-2" style={{ marginTop: 20 }}>
        <Section title="Où se trouve l'argent" hint={line.note}>
          <div className="wk-panel">
            <div style={{ marginBottom: 14 }}><CoverageBar ratio={lineRatio(line)} tone={tone} /></div>
            {where.length === 0 && !line.details ? <Empty text="Aucune répartition disponible." /> : (
              <div className="wk-kv">
                {where.map((w) => <div className="wk-kv-row" key={w.label}><span>{w.label}</span><span>{formatNumber(w.value)}</span></div>)}
                {line.details?.map((d) => <div className="wk-kv-row" key={`d-${d.label}`}><span>{d.label}</span><span>{formatNumber(d.value)}</span></div>)}
              </div>
            )}
            <p className="wk-panel-hint" style={{ marginTop: 14, marginBottom: 0 }}>
              <a className="wk-link" href="/dashboard/custody">Réserve de retrait →</a>{" · "}
              <a className="wk-link" href="/dashboard/sweep">Collecte des dépôts →</a>{" · "}
              <a className="wk-link" href="/dashboard/treasury">Couverture →</a>
            </p>
          </div>
        </Section>

        <Section title="Staking de cet actif" hint="Plans de staking qui utilisent cet actif.">
          {pools.length === 0 ? <Empty text="Aucun plan de staking pour cet actif." /> : (
            <TableWrap>
              <thead><tr><Th>Plan</Th><Th right>Taux</Th><Th right hideSm>Stakeurs</Th><Th right>Staké</Th><Th right hideSm>Intérêts / jour</Th></tr></thead>
              <tbody>
                {pools.map((p) => (
                  <tr key={p.id}>
                    <Td label="Plan">{p.name}<div className="wk-asset-sub">{p.type === "flexible" ? "flexible" : `bloqué ${p.lockDays} j`}{p.isActive ? "" : " · désactivé"}</div></Td>
                    <Td right label="Taux">{p.baseApy} %</Td>
                    <Td right hideSm label="Stakeurs">{formatNumber(p.stakers, 0)}</Td>
                    <Td right label="Staké">{formatNumber(p.staked)}</Td>
                    <Td right hideSm label="Intérêts / jour">{formatNumber(p.dailyPromised)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <p className="wk-hint" style={{ marginTop: 10 }}><a className="wk-link" href="/dashboard/staking-plan">Plan staking : quoi envoyer on-chain, quoi garder →</a></p>
          {staking.error && <p className="wk-hint">Le staking n'a pas pu être lu : {staking.error}</p>}
        </Section>
      </div>

      <Section title="Derniers mouvements" hint={`Les 15 dernières transactions en ${line.asset}.`}>
        {txs.error ? <ErrorNote text={`Les transactions n'ont pas pu être lues : ${txs.error}`} /> : txs.rows.length === 0 ? <Empty text="Aucune transaction pour cet actif." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Utilisateur</Th><Th>Type</Th><Th right>Montant</Th><Th>Statut</Th></tr></thead>
            <tbody>
              {txs.rows.map((t) => (
                <tr key={t.id}>
                  <Td label="Date">{formatDate(t.created_at)}</Td>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${t.user_id}`}>{nameOf.get(t.user_id) || shortId(t.user_id)}</a></Td>
                  <Td label="Type">{txTypeLabel(t.type)}</Td>
                  <Td right label="Montant">{formatNumber(Number(t.amount))}</Td>
                  <Td label="Statut"><Pill tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Pill></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <p className="wk-hint" style={{ marginTop: 10 }}><a className="wk-link" href={`/dashboard/transactions?asset=${encodeURIComponent(line.asset)}`}>Toutes les transactions en {line.asset} →</a></p>
      </Section>
    </div>
  );
}
