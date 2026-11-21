import { loadPrices } from "@/lib/data";
import { computeCoverage } from "@/lib/valuation";
import { loadSolvencyLines } from "@/lib/solvency";
import { loadStakingPlanData } from "@/lib/staking-plan-data";
import { loadFunding } from "@/lib/funding";
import { RunwayCell } from "@/components/funding-view";
import { statusLabel, statusTone, lineGap, lineRatio, lineUsd } from "@/lib/asset-view";
import { formatNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trésorerie, vue par actif : une ligne par actif (crypto et argent mobile), même calcul que la page Couverture
 * (lib/solvency). Chaque ligne ouvre la fiche de l'actif, qui rassemble tout ce qui le concerne.
 */
export default async function AssetsPage() {
  const prices = await loadPrices();
  const [{ crypto, mobile, error }, staking] = await Promise.all([loadSolvencyLines(prices), loadStakingPlanData()]);
  const lines = [...crypto, ...mobile];
  const fundingBy = new Map((await loadFunding({ crypto, mobile })).lines.map((f) => [f.plan.asset, f]));

  const cov = computeCoverage(lines.filter((l) => l.have !== null).map((l) => ({ asset: l.asset, owed: l.owe, held: l.have as number, price: l.priceUsd })));
  const stakedBy = new Map<string, number>();
  for (const p of staking.data?.pools ?? []) stakedBy.set(p.asset.toUpperCase(), (stakedBy.get(p.asset.toUpperCase()) ?? 0) + p.staked);

  // Les actifs à traiter d'abord : insuffisants, illisibles, à collecter, puis le reste par ordre alphabétique.
  const rank = (s: string) => (s === "short" ? 0 : s === "error" ? 1 : s === "sweep" ? 2 : s === "minor" ? 3 : 4);
  const sorted = [...lines].sort((a, b) => rank(a.status) - rank(b.status) || a.asset.localeCompare(b.asset));
  const nBad = lines.filter((l) => l.status === "short" || l.status === "error").length;

  return (
    <div>
      <PageHeader title="Actifs" subtitle="Pour chaque actif : ce que tu dois aux utilisateurs, ce que tu détiens vraiment, et l'écart. Clique sur un actif pour voir tout ce qui le concerne." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={error ? `Le calcul n'a pas pu être fait : ${error}` : null} />

      <div className="wk-exchange-kpis" style={{ marginBottom: 20 }}>
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Dû aux utilisateurs</span><span className="wk-exchange-kpi-value">{formatUsd(cov.owedUsd)}</span><span className="wk-exchange-kpi-detail">{lines.length} actif(s)</span></div>
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Détenu (total)</span><span className="wk-exchange-kpi-value">{formatUsd(cov.heldUsd)}</span><span className="wk-exchange-kpi-detail">surplus inclus</span></div>
        <div className={`wk-exchange-kpi ${cov.missingUsd > 0.01 ? "wk-exchange-kpi-negative" : "wk-exchange-kpi-positive"}`}><span className="wk-exchange-kpi-label">Manque à combler</span><span className="wk-exchange-kpi-value">{formatUsd(cov.missingUsd)}</span><span className="wk-exchange-kpi-detail">actif par actif, sans compensation</span></div>
        <div className="wk-exchange-kpi"><span className="wk-exchange-kpi-label">Couverture du dû</span><span className="wk-exchange-kpi-value">{Number.isNaN(cov.coveragePct) ? "—" : formatPct(cov.coveragePct)}</span><span className="wk-exchange-kpi-detail">{nBad > 0 ? `${nBad} actif(s) à traiter` : "aucun actif à traiter"}</span></div>
      </div>

      <Section title="Tous les actifs" hint="« Autonomie » = combien de jours le portefeuille de retrait tient au pire jour de retraits observé (détail dans À approvisionner). Les actifs à traiter sont en haut. Un surplus sur un actif ne compense jamais le manque d'un autre. WAKATI, jeton interne, a sa propre section « WAKATI ».">
        {sorted.length === 0 ? <Empty text="Aucun actif à afficher." /> : (
          <TableWrap>
            <thead><tr><Th>Actif</Th><Th right hideSm>Prix</Th><Th right>Dû</Th><Th right>Détenu</Th><Th right>Écart</Th><Th hideSm>Couverture</Th><Th right hideSm>Staké</Th><Th hideSm>Autonomie</Th><Th>Statut</Th></tr></thead>
            <tbody>
              {sorted.map((l) => {
                const gap = lineGap(l);
                const stakedQty = stakedBy.get(l.asset.toUpperCase());
                return (
                  <tr key={l.label}>
                    <Td label="Actif"><a className="wk-link" href={`/dashboard/assets/${encodeURIComponent(l.asset)}`}>{l.asset}</a><div className="wk-asset-sub">{l.label}</div></Td>
                    <Td right hideSm label="Prix">{l.priceUsd === null ? "non valorisé" : formatUsd(l.priceUsd)}</Td>
                    <Td right label="Dû">{formatNumber(l.owe)}{lineUsd(l, l.owe) !== null && <div className="wk-asset-sub">{formatUsd(lineUsd(l, l.owe) as number)}</div>}</Td>
                    <Td right label="Détenu">{l.have === null ? "illisible" : formatNumber(l.have)}{lineUsd(l, l.have) !== null && <div className="wk-asset-sub">{formatUsd(lineUsd(l, l.have) as number)}</div>}</Td>
                    <Td right label="Écart"><span className={gap === null ? "" : gap < -1e-8 ? "wk-bad" : "wk-ok"}>{gap === null ? "—" : `${gap > 0 ? "+" : ""}${formatNumber(gap)}`}</span></Td>
                    <Td hideSm label="Couverture"><CoverageBar ratio={lineRatio(l)} tone={statusTone(l.status)} /></Td>
                    <Td right hideSm label="Staké">{stakedQty === undefined ? "—" : formatNumber(stakedQty)}</Td>
                    <Td hideSm label="Autonomie"><RunwayCell days={fundingBy.get(l.asset)?.runwayPeak ?? null} empty="—" /></Td>
                    <Td label="Statut"><Pill tone={statusTone(l.status)}>{statusLabel(l.status)}</Pill></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        {staking.error && <p className="wk-hint" style={{ marginTop: 10 }}>Le staking n'a pas pu être lu : {staking.error}</p>}
      </Section>
    </div>
  );
}
