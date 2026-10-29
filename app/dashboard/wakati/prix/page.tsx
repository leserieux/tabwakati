import Link from "next/link";
import { loadWakati } from "@/lib/wakati";
import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { updateWakatiReserveState } from "@/app/dashboard/settings/actions";
import { Field, TextField, AssetSelect, RadioGroup, Toggle, SettingsCard, SettingsMessages } from "@/components/settings-form";

const RETURN = "/dashboard/wakati/prix";
type SettingsParams = { saved?: string; error?: string; msg?: string };

import { formatPrice, formatUsd, formatToken, formatDay } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PricePage({ searchParams }: { searchParams: SettingsParams }) {
  const [w, wakatiState, shortages] = await Promise.all([
    loadWakati(),
    q<any>(getSupabaseAdmin().from("wakati_reserve_state").select("*").eq("id", 1).limit(1)),
    q<any>(getSupabaseAdmin().from("wakati_liquidity_events").select("id, user_id, requested_wakati, requested_usd, reserve_usd, shortfall_usd, created_at").order("created_at", { ascending: false }).limit(10))
  ]);
  const ws = wakatiState.rows[0];
  const shortageRows = shortages.rows;
  const fmtUpdated = (iso?: string) => (iso ? formatDateTime(new Date(iso)) : null);

  const { state, history } = w;
  const atFloor = state ? w.price <= state.floorUsd * 1.0001 : false;
  const rawNow = state && w.inApp.available > 0 ? state.reserveUsd / w.inApp.available : 0;
  const recent = history.slice(0, 14);

  return (
    <div>
      <SettingsMessages searchParams={searchParams} />
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}
      {shortages.error && <div className="wk-alert-bad">Ventes refusées : lecture impossible ({shortages.error}). La migration 20261028_wakati_sale_drains_price_reserve.sql est-elle appliquée ?</div>}
      {ws?.liquidity_shortage && (
        <div className="wk-callout wk-callout-warn" style={{ marginBottom: 16 }}>
          <strong>Manque de liquidité.</strong> La réserve du prix ne couvre plus les ventes de WAKATI
          {ws.liquidity_shortage_since ? <> depuis le {formatDateTime(new Date(ws.liquidity_shortage_since))}</> : null}. Les ventes trop grosses sont refusées et signalées à l'utilisateur. Le signal disparaît dès que la réserve remonte (calcul quotidien).
        </div>
      )}

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
              <div className="wk-strip-sub">alimentée par les profits, vidée par les ventes</div>
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

      <Section title="Ventes refusées pour manque de liquidité" hint="Une vente de WAKATI vide la réserve de sa valeur en USD ; si la réserve ne suffit pas, la vente est refusée. Les 10 derniers refus. Les achats n'alimentent pas la réserve.">
        {shortageRows.length === 0 ? (
          <Empty text="Aucune vente refusée." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Utilisateur</Th>
                <Th right>WAKATI demandés</Th>
                <Th right>Valeur</Th>
                <Th right>Réserve à ce moment</Th>
                <Th right>Manque</Th>
              </tr>
            </thead>
            <tbody>
              {shortageRows.map((e: any) => (
                <tr key={e.id}>
                  <Td label="Date">{formatDateTime(new Date(e.created_at))}</Td>
                  <Td label="Utilisateur"><Link href={`/dashboard/users/${e.user_id}`}>{String(e.user_id).slice(0, 8)}…</Link></Td>
                  <Td right label="WAKATI demandés">{formatToken(Number(e.requested_wakati))}</Td>
                  <Td right label="Valeur">{formatUsd(Number(e.requested_usd))}</Td>
                  <Td right label="Réserve à ce moment">{formatUsd(Number(e.reserve_usd))}</Td>
                  <Td right label="Manque"><span className="wk-neg">{formatUsd(Number(e.shortfall_usd))}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Réglages — calcul du prix" hint="Le prix est recalculé chaque jour à partir du profit net de la plateforme.">
      {ws ? (
        <SettingsCard returnTo={RETURN}
          title="Prix WAKATI"
          hint={`Calcul quotidien du prix à partir du profit net de la plateforme. Réserve actuelle : ${Number(ws.reserve_usd).toLocaleString("fr-FR", { style: "currency", currency: "USD" })} (lecture seule — alimentée par le calcul quotidien, pas éditable ici).`}
          updatedAt={ws.last_computed_at ? fmtUpdated(ws.last_computed_at) : null}
          action={updateWakatiReserveState}
        >
          <Field label="Part versée à la réserve (%)" name="profit_share_pct" defaultValue={ws.profit_share_pct} hint="Sur le profit net du jour. Retirée automatiquement (0 %) si la journée est déficitaire." />
          <Field label="Variation max du prix / jour (%)" name="max_daily_change_pct" defaultValue={ws.max_daily_change_pct} hint="Plafonne la hausse ou la baisse quotidienne du prix calculé." />
          <Field label="Prix plancher (USD)" name="price_floor_usd" defaultValue={ws.price_floor_usd} hint="Le prix calculé ne descend jamais en dessous." />
          <Toggle label="Calcul automatique actif" name="is_active" defaultChecked={ws.is_active} />
        </SettingsCard>
      ) : (
        <div className="wk-alert-bad">Section Prix WAKATI : aucune ligne trouvée dans wakati_reserve_state (id=1).</div>
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
