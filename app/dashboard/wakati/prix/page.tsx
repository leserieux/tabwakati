import { loadWakati } from "@/lib/wakati";
import { formatPrice, formatUsd, formatToken, formatDay } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PricePage() {
  const w = await loadWakati();
  const { state, history } = w;
  const atFloor = state ? w.price <= state.floorUsd * 1.0001 : false;
  const rawNow = state && w.inApp.available > 0 ? state.reserveUsd / w.inApp.available : 0;
  const recent = history.slice(0, 14);

  return (
    <div>
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}

      {!state ? (
        <Empty text="Le système de prix WAKATI n'est pas configuré." />
      ) : (
        <>
          <div className="wk-strip">
            <div className="wk-strip-item">
              <div className="wk-strip-label">Prix actuel</div>
              <div className="wk-strip-value">{formatPrice(w.price)}</div>
              <div className="wk-strip-sub">{atFloor ? "au plancher" : "au-dessus du plancher"}</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Plancher</div>
              <div className="wk-strip-value">{formatPrice(state.floorUsd)}</div>
              <div className="wk-strip-sub">le prix ne descend jamais sous ce seuil</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Réserve</div>
              <div className="wk-strip-value">{formatUsd(state.reserveUsd)}</div>
              <div className="wk-strip-sub">alimentée par les profits</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Dernier calcul</div>
              <div className="wk-strip-value" style={{ fontSize: 20 }}>{state.lastComputedAt ? new Date(state.lastComputedAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).replace(".", "") : "—"}</div>
              <div className="wk-strip-sub">{state.isActive ? "système actif (heure UTC)" : "système désactivé"}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            {!state.isActive ? (
              <div className="wk-callout wk-callout-warn">Le calcul automatique du prix est <strong>désactivé</strong> : le prix ne bouge plus.</div>
            ) : atFloor && rawNow < state.floorUsd ? (
              <div className="wk-callout wk-callout-warn">
                <strong>Le prix est au plancher.</strong> Le prix calculé (réserve ÷ offre disponible) est de {formatPrice(rawNow)}, sous le plancher de {formatPrice(state.floorUsd)}. Le prix montera quand la réserve aura assez grandi. Elle reçoit {state.profitSharePct} % du profit net de chaque jour.
              </div>
            ) : (
              <div className="wk-callout wk-callout-ok">
                <strong>Le prix suit la réserve.</strong> Prix calculé aujourd'hui : {formatPrice(rawNow)}.
              </div>
            )}
          </div>

          <Section title="Comment le prix est calculé" hint="Le calcul tourne chaque nuit.">
            <div className="wk-panel wk-formula">
              <div className="wk-kv">
                <div className="wk-kv-row"><span>Profit net de la veille</span><span>frais gagnés moins récompenses distribuées</span></div>
                <div className="wk-kv-row"><span>Part versée à la réserve</span><span>{state.profitSharePct} % (retirée si la journée est déficitaire)</span></div>
                <div className="wk-kv-row"><span>Prix calculé</span><span>réserve ÷ offre disponible ({formatToken(w.inApp.available)} WAKATI)</span></div>
                <div className="wk-kv-row"><span>Variation maximale</span><span>±{state.maxDailyChangePct} % par jour</span></div>
                <div className="wk-kv-row"><span>Limite basse</span><span>jamais sous {formatPrice(state.floorUsd)}</span></div>
              </div>
            </div>
          </Section>
        </>
      )}

      <Section title="Profit net par jour" hint="Ce qui alimente (ou retire de) la réserve. Les 14 derniers jours calculés.">
        {recent.length === 0 ? <Empty text="Aucun calcul enregistré." /> : <div className="wk-panel"><ProfitChart days={[...recent].reverse()} /></div>}
      </Section>

      <Section title="Historique des calculs">
        {recent.length === 0 ? (
          <Empty text="Aucun calcul enregistré." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Jour</Th>
                <Th right>Profit net</Th>
                <Th right>Versé à la réserve</Th>
                <Th right>Réserve après</Th>
                <Th right>Offre utilisée</Th>
                <Th right>Prix</Th>
                <Th>Plafonné</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((h) => (
                <tr key={h.date}>
                  <Td label="Jour">{formatDay(h.date)}</Td>
                  <Td right label="Profit net"><span className={h.netProfit < 0 ? "wk-neg" : "wk-pos"}>{formatUsd(h.netProfit)}</span></Td>
                  <Td right label="Versé à la réserve">{formatUsd(h.contribution)}</Td>
                  <Td right label="Réserve après">{formatUsd(h.reserveAfter)}</Td>
                  <Td right label="Offre utilisée">{formatToken(h.circulating)}</Td>
                  <Td right label="Prix">{formatPrice(h.finalPrice)}</Td>
                  <Td label="Plafonné">{h.capped ? <Pill tone="warn">Oui</Pill> : <Pill tone="info">Non</Pill>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function ProfitChart({ days }: { days: { date: string; netProfit: number }[] }) {
  const W = 760;
  const H = 220;
  const top = 24;
  const bottom = 30;
  const plotH = H - top - bottom;
  const max = Math.max(...days.map((d) => Math.abs(d.netProfit)), 0.0001);
  const zeroY = top + plotH / 2;
  const slot = W / days.length;
  const barW = Math.min(34, slot * 0.58);
  const half = plotH / 2 - 4;

  return (
    <svg className="wk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit net par jour">
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--line-strong)" strokeWidth={1} />
      {days.map((d, i) => {
        const h = Math.max((Math.abs(d.netProfit) / max) * half, d.netProfit === 0 ? 0 : 2);
        const x = i * slot + (slot - barW) / 2;
        const positive = d.netProfit >= 0;
        const y = positive ? zeroY - h : zeroY;
        return (
          <g key={d.date}>
            <title>{`${formatDay(d.date)} : ${formatUsd(d.netProfit)}`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={positive ? "var(--ok)" : "var(--bad)"} />
            <text className="wk-chart-label" x={x + barW / 2} y={H - 8} textAnchor="middle">{formatDay(d.date)}</text>
          </g>
        );
      })}
    </svg>
  );
}
