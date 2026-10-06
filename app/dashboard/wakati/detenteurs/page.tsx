import { loadWakati } from "@/lib/wakati";
import { getSupabaseAdmin, q } from "@/lib/data";
import { formatToken, formatPct, formatCompactNumber, shortId } from "@/lib/format";
import { Section, TableWrap, Th, Td, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKETS = [
  { label: "Moins de 100", min: 0, max: 100 },
  { label: "100 à 999", min: 100, max: 1000 },
  { label: "1 000 à 9 999", min: 1000, max: 10000 },
  { label: "10 000 et plus", min: 10000, max: Infinity }
];

export default async function HoldersPage() {
  const w = await loadWakati();
  const { holders, inApp } = w;
  const total = inApp.total;

  const sumTop = (n: number) => holders.slice(0, n).reduce((s, h) => s + h.total, 0);
  const top1 = sumTop(1);
  const top5 = sumTop(5);
  const top10 = sumTop(10);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  const top = holders.slice(0, 10);
  const names = await q<any>(getSupabaseAdmin().from("admin_users_overview").select("id, username").in("id", top.map((h) => h.userId)));
  const nameOf = new Map(names.rows.map((u) => [u.id as string, (u.username as string) || ""]));

  const sorted = [...holders].map((h) => h.total).sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;

  const buckets = BUCKETS.map((b) => {
    const members = holders.filter((h) => h.total >= b.min && h.total < b.max);
    return { ...b, count: members.length, sum: members.reduce((s, h) => s + h.total, 0) };
  });

  const concentrated = pct(top1) > 50;

  return (
    <div>
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}

      {holders.length === 0 ? (
        <Empty text="Aucun détenteur de WAKATI." />
      ) : (
        <>
          <div className="wk-strip">
            <div className="wk-strip-item">
              <div className="wk-strip-label">Détenteurs</div>
              <div className="wk-strip-value">{holders.length}</div>
              <div className="wk-strip-sub">{formatCompactNumber(total)} WAKATI en app</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Plus gros détenteur</div>
              <div className="wk-strip-value">{formatPct(pct(top1))}</div>
              <div className="wk-strip-sub">{formatToken(top1)} WAKATI</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Top 10</div>
              <div className="wk-strip-value">{formatPct(pct(top10))}</div>
              <div className="wk-strip-sub">de l'offre en app</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Détenteur médian</div>
              <div className="wk-strip-value">{formatToken(median)}</div>
              <div className="wk-strip-sub">WAKATI</div>
            </div>
          </div>

          {concentrated && (
            <div style={{ marginTop: 16 }}>
              <div className="wk-callout wk-callout-warn">
                <strong>Forte concentration.</strong> Un seul détenteur possède {formatPct(pct(top1))} des WAKATI en app. S'il retire ou vend tout d'un coup, l'impact sur la liquidité et sur le prix sera important.
              </div>
            </div>
          )}

          <Section title="Concentration" hint="Part de l'offre en app détenue par les plus gros portefeuilles.">
            <div className="wk-panel">
              <div className="wk-share">
                {[
                  { label: "Plus gros détenteur", v: top1 },
                  { label: "5 plus gros", v: top5 },
                  { label: "10 plus gros", v: top10 },
                  { label: "Tous les détenteurs", v: total }
                ].map((r) => (
                  <div key={r.label} className="wk-share-row">
                    <div className="wk-share-top">
                      <span className="wk-asset">{r.label}</span>
                      <span>{formatPct(pct(r.v))}</span>
                    </div>
                    <div className="wk-share-track">
                      <div className="wk-share-fill" style={{ width: `${pct(r.v)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Répartition par taille" hint="Combien de détenteurs par tranche de WAKATI.">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Tranche</Th>
                  <Th right>Détenteurs</Th>
                  <Th right>WAKATI détenus</Th>
                  <Th right>Part de l'offre en app</Th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.label}>
                    <Td>{b.label}</Td>
                    <Td right label="Détenteurs">{b.count}</Td>
                    <Td right label="WAKATI">{formatToken(b.sum)}</Td>
                    <Td right label="Part">{formatPct(pct(b.sum))}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>

          <Section title="Les 10 plus gros détenteurs">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Utilisateur</Th>
                  <Th right>Total</Th>
                  <Th right>Part</Th>
                  <Th right>Disponible</Th>
                  <Th right>En staking</Th>
                </tr>
              </thead>
              <tbody>
                {top.map((h) => (
                  <tr key={h.userId}>
                    <Td>
                      <div className="wk-asset">{nameOf.get(h.userId) || "Sans pseudo"}</div>
                      <div className="wk-asset-sub">{shortId(h.userId)}</div>
                    </Td>
                    <Td right label="Total">{formatToken(h.total)}</Td>
                    <Td right label="Part">{formatPct(pct(h.total))}</Td>
                    <Td right label="Disponible">{formatToken(h.available)}</Td>
                    <Td right label="En staking">{formatToken(h.staking)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>
        </>
      )}
    </div>
  );
}
