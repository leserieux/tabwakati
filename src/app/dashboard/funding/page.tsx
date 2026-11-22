import { loadPrices } from "@/core/db/data";
import { loadSolvencyLines } from "@/modules/treasury/solvency";
import { loadFunding, actionText, URGENCY_LABEL, URGENCY_TONE, type FundingLine } from "@/modules/treasury/funding";
import { STATS_DAYS } from "@/modules/treasury/custody-policy";
import { formatNumber, formatUsd, formatDateTime } from "@/core/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote } from "@/components/ui";
import { RunwayCell, StressPill } from "@/components/funding-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * À approvisionner : la page de décision de la trésorerie.
 * Pour chaque actif : combien de jours le portefeuille de retrait tient, ce qui se passerait si les plus gros utilisateurs retiraient
 * en même temps, et l'action chiffrée (combien, d'où, avant quand). Les cibles viennent des réglages de la Réserve de retrait.
 */
export default async function FundingPage() {
  const prices = await loadPrices();
  const sol = await loadSolvencyLines(prices);
  const { lines, warning } = await loadFunding(sol);

  const act = lines.filter((f) => f.urgency === "now" || f.urgency === "soon");
  const watch = lines.filter((f) => f.urgency === "watch");
  const unknown = lines.filter((f) => f.urgency === "unknown");
  const needUsd = act.reduce((s, f) => s + (f.action.kind === "fund" ? f.action.usd ?? 0 : 0), 0);
  const externalUsd = act.reduce((s, f) => s + (f.action.kind === "fund" && f.plan.priceUsd ? f.action.external * f.plan.priceUsd : 0), 0);
  const tone = act.some((f) => f.urgency === "now") || unknown.length > 0 ? "bad" : act.length > 0 ? "warn" : "ok";
  const title =
    lines.length === 0 ? "Rien à calculer"
    : act.some((f) => f.urgency === "now") ? `${act.filter((f) => f.urgency === "now").length} actif(s) à approvisionner maintenant`
    : act.length > 0 ? `${act.length} actif(s) à approvisionner bientôt`
    : unknown.length > 0 ? "Certains actifs n'ont pas pu être lus"
    : watch.length > 0 ? "Rien d'urgent, mais un scénario de ruée serait tendu"
    : "Les retraits sont couverts partout";
  const text =
    act.length > 0
      ? `Il faut ajouter environ ${formatUsd(needUsd)} au total${externalUsd > 0.5 ? `, dont ${formatUsd(externalUsd)} à apporter de l'extérieur (le reste vient du coffre ou de la collecte)` : ", à prendre dans le coffre ou par la collecte des dépôts"}.`
      : "Ce qui est prêt à partir peut payer les retraits observés, et le test de stress passe sur les actifs lus.";

  return (
    <div className="wk-exchange-dashboard">
      <PageHeader title="À approvisionner" subtitle="Combien de temps l'argent prêt à partir tient, ce qui se passerait si les plus gros utilisateurs retiraient ensemble, et quoi faire." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={sol.error ? `Les soldes réels n'ont pas pu être lus : ${sol.error}` : null} />
      <ErrorNote text={warning ? `Données incomplètes : ${warning}` : null} />

      <div className={`wk-exchange-status wk-exchange-status-${tone}`}>
        <div className="wk-exchange-status-copy">
          <span className="wk-exchange-status-indicator" />
          <div>
            <span className="wk-exchange-eyebrow">PLAN D'APPROVISIONNEMENT</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </div>
        </div>
        <span className="wk-exchange-status-meta">retraits observés sur {STATS_DAYS} jours</span>
      </div>

      <div className="wk-exchange-lower" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="wk-exchange-panel">
          <div className="wk-exchange-panel-head">
            <h2>Quoi faire</h2>
            <span className={`wk-exchange-count ${act.some((f) => f.urgency === "now") ? "wk-exchange-count-bad" : act.length > 0 ? "wk-exchange-count-warn" : ""}`}>{act.length + watch.length}</span>
          </div>
          {act.length + watch.length === 0 ? (
            <div className="wk-exchange-empty"><span>✓</span><div><strong>Rien à faire</strong><p>Aucun actif ne demande d'approvisionnement.</p></div></div>
          ) : (
            <ul className="wk-exchange-todo">
              {[...act, ...watch].map((f) => (
                <li key={f.plan.label} className={`wk-exchange-todo-item wk-exchange-todo-${f.urgency === "now" ? "bad" : f.urgency === "soon" ? "warn" : "info"}`}>
                  <span className="wk-exchange-todo-marker" />
                  <span className="wk-exchange-todo-text">
                    <strong>{URGENCY_LABEL[f.urgency]} · </strong>{actionText(f)}
                    {f.why.length > 0 && <span style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{f.why.join(" ")}</span>}
                  </span>
                  <a href={`/dashboard/assets/${encodeURIComponent(f.plan.asset)}`}>Fiche →</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Section title="Détail par actif" hint="Les actifs les plus urgents sont en haut. Le test de stress suppose que les utilisateurs retirent tout leur solde disponible en même temps.">
        {lines.length === 0 ? <Empty text="Aucun actif à afficher." /> : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th><Th>Urgence</Th><Th right>Prêt à partir</Th><Th hideSm>Autonomie (pire jour)</Th><Th hideSm>Autonomie (rythme moyen)</Th>
                <Th>Le plus gros solde</Th><Th hideSm>Les 5 plus gros</Th><Th hideSm>Les 10 plus gros</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((f: FundingLine) => {
                const get = (key: string) => f.stress.find((c) => c.key === key);
                return (
                  <tr key={f.plan.label}>
                    <Td label="Actif"><a className="wk-link" href={`/dashboard/assets/${encodeURIComponent(f.plan.asset)}`}>{f.plan.asset}</a><div className="wk-asset-sub">{f.plan.label}</div></Td>
                    <Td label="Urgence"><Pill tone={URGENCY_TONE[f.urgency]}>{URGENCY_LABEL[f.urgency]}</Pill></Td>
                    <Td right label="Prêt à partir">{f.plan.withdrawable === null ? "illisible" : formatNumber(f.plan.withdrawable)}<div className="wk-asset-sub">dû : {formatNumber(f.plan.owe)}</div></Td>
                    <Td hideSm label="Autonomie (pire jour)"><RunwayCell days={f.runwayPeak} empty="aucun retrait observé" /></Td>
                    <Td hideSm label="Autonomie (rythme moyen)"><RunwayCell days={f.runwayAvg} empty="aucun retrait observé" /></Td>
                    <Td label="Le plus gros solde"><StressPill c={get("top1")} asset={f.plan.asset} /></Td>
                    <Td hideSm label="Les 5 plus gros"><StressPill c={get("top5")} asset={f.plan.asset} /></Td>
                    <Td hideSm label="Les 10 plus gros"><StressPill c={get("top10")} asset={f.plan.asset} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Comment lire cette page">
        <div className="wk-panel">
          <p className="wk-panel-hint" style={{ marginBottom: 8 }}><strong>Prêt à partir</strong> = le portefeuille de retrait, moins la part réservée aux swaps. C'est ce qui paie un retrait tout de suite.</p>
          <p className="wk-panel-hint" style={{ marginBottom: 8 }}><strong>Autonomie</strong> = prêt à partir ÷ retraits par jour. « Pire jour » prend la plus grosse journée de retraits observée ; « rythme moyen » divise le total des retraits par {STATS_DAYS} jours. Si la plateforme a moins de {STATS_DAYS} jours d'historique, le rythme moyen est sous-estimé : fie-toi au pire jour.</p>
          <p className="wk-panel-hint" style={{ marginBottom: 8 }}><strong>Test de stress</strong> : on additionne le solde disponible des 1, 5 ou 10 plus gros utilisateurs. « Payable » = le portefeuille de retrait suffit. « Après déplacement » = il faudrait d'abord ramener de l'argent du coffre ou lancer la collecte. « Insuffisant » = même ainsi, ça ne suffit pas.</p>
          <p className="wk-panel-hint" style={{ marginBottom: 0 }}><strong>Limites</strong> : seuls les soldes disponibles sont pris en compte (pas le staking, sauf l'information « arrive à échéance dans 7 jours »). Pour un actif présent sur plusieurs réseaux, les soldes sont lus sous le nom unifié de l'actif. Les cibles et seuils viennent des réglages de la <a className="wk-link" href="/dashboard/custody">Réserve de retrait</a> ; rien n'est déplacé automatiquement.</p>
        </div>
      </Section>
    </div>
  );
}
