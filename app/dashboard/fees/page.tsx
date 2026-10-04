import { loadFeesReport, feeLabel } from "@/lib/fees";
import { formatNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

const nativeList = (byAsset: Map<string, number>) =>
  [...byAsset.entries()].sort((a, b) => b[1] - a[1]).map(([asset, amount]) => `${formatNumber(amount, 4)} ${asset}`).join(" · ");

export default async function FeesPage() {
  const r = await loadFeesReport();
  const gamesUsd = r.byType.find((t) => t.key === "game_house_edge")?.usd ?? 0;
  const share = (usd: number) => (r.totalUsd > 0 ? (usd / r.totalUsd) * 100 : 0);
  const maxMonth = Math.max(...r.byMonth.map((m) => m.usd), 0);

  return (
    <div>
      <PageHeader title="Frais" subtitle="Revenus réels de la plateforme : hors lignes de test et hors game_net_loss, valorisés au cours actuel." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {r.truncated && <ErrorNote text="Lecture tronquée : plus de 200 000 lignes de frais, les totaux sont partiels." />}
      {r.unpriced.length > 0 && <div className="wk-alert-warn">Sans cours valide, donc exclus des totaux USD : {r.unpriced.join(", ")}.</div>}

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Total réel</div><div className="wk-strip-value">{formatUsd(r.totalUsd)}</div><div className="wk-strip-sub">{formatNumber(r.count, 0)} lignes comptées</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">30 derniers jours</div><div className="wk-strip-value">{formatUsd(r.last30Usd)}</div><div className="wk-strip-sub">{formatPct(share(r.last30Usd))} du total</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">7 derniers jours</div><div className="wk-strip-value">{formatUsd(r.last7Usd)}</div><div className="wk-strip-sub">Aujourd'hui : {formatUsd(r.todayUsd)}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Part des jeux</div><div className="wk-strip-value">{formatPct(share(gamesUsd), 0)}</div><div className="wk-strip-sub">{formatUsd(gamesUsd)} de marge</div></div>
      </div>

      <Section title="Par type de frais" hint="Montants natifs à gauche, valeur en dollars au cours actuel à droite.">
        <TableWrap>
          <thead><tr><Th>Type</Th><Th right>Lignes</Th><Th hideSm>Montants natifs</Th><Th right>Valeur</Th><Th right>Part</Th></tr></thead>
          <tbody>
            {r.byType.length === 0 ? <tr><Td colSpan={5}>Aucun frais enregistré.</Td></tr> : r.byType.map((t) => (
              <tr key={t.key}>
                <Td label="Type">{feeLabel(t.key)}</Td>
                <Td right label="Lignes">{formatNumber(t.count, 0)}</Td>
                <Td hideSm label="Montants natifs">{nativeList(t.byAsset)}</Td>
                <Td right label="Valeur">{formatUsd(t.usd)}</Td>
                <Td right label="Part">{formatPct(share(t.usd))}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par actif" hint="Un grand montant natif ne veut pas dire une grande valeur : tout dépend du cours de l'actif.">
        <TableWrap>
          <thead><tr><Th>Actif</Th><Th right>Lignes</Th><Th right>Montant natif</Th><Th right hideSm>Cours</Th><Th right>Valeur</Th><Th right>Part</Th></tr></thead>
          <tbody>
            {r.byAsset.length === 0 ? <tr><Td colSpan={6}>Aucun frais enregistré.</Td></tr> : r.byAsset.map((a) => (
              <tr key={a.key}>
                <Td label="Actif">{a.key}</Td>
                <Td right label="Lignes">{formatNumber(a.count, 0)}</Td>
                <Td right label="Montant natif">{formatNumber(a.native, 4)}</Td>
                <Td right hideSm label="Cours">{a.price === null ? "Sans cours" : formatUsd(a.price)}</Td>
                <Td right label="Valeur">{formatUsd(a.usd)}</Td>
                <Td right label="Part">{formatPct(share(a.usd))}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par mois" hint="Chaque mois est valorisé au cours actuel, pas au cours du jour de la collecte.">
        <div className="wk-panel"><div className="wk-share">
          {r.byMonth.length === 0 ? <div>Aucun frais enregistré.</div> : r.byMonth.map((m) => (
            <div key={m.key} className="wk-share-row">
              <div className="wk-share-top"><span>{monthLabel(m.key)} <span style={{ color: "var(--muted)" }}>({formatNumber(m.count, 0)} lignes)</span></span><span>{formatUsd(m.usd)}</span></div>
              <div className="wk-share-track"><div className="wk-share-fill" style={{ width: `${maxMonth > 0 ? (m.usd / maxMonth) * 100 : 0}%` }} /></div>
            </div>
          ))}
        </div></div>
      </Section>

      <Section title="Exclus des totaux">
        <div className="wk-panel">
          {r.excluded.count} ligne(s) <code>game_net_loss</code>, soit {formatUsd(r.excluded.usd)} : c'est un signal utilisé par le calcul de capacité d'emprunt des joueurs, pas un revenu.
          {r.excluded.unpricedAssets.length > 0 && ` Sans cours : ${r.excluded.unpricedAssets.join(", ")}.`}
        </div>
      </Section>
    </div>
  );
}
