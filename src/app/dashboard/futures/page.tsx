import { loadPrices } from "@/core/db/data";
import { formatNumber, formatPct, formatDateTime, formatDate, formatUsd, shortId } from "@/core/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, SegmentBar, Swatch, type Tone } from "@/components/ui";
import { Field, TextField, Toggle, SettingsCard, SettingsMessages, ReasonField } from "@/components/settings-form";
import { ConfirmDeleteButton } from "@/app/dashboard/settings/ConfirmDeleteButton";
import MoneyHero, { sg } from "./money-hero";
import {
  loadFuturesOverview, loadFuturesHealth, loadFuturesMarkets, loadOpenPositions, loadRecentClosed, loadMoneyDaily, loadFuturesMoney, loadTraders, loadByLeverage, buildAlerts,
  type FuturesPeriod
} from "@/modules/products/futures";
import { updateFuturesConfig, updateFuturesMarket, setFuturesActive, forceClosePosition, forceCloseAll } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURN = "/dashboard/futures";
type SettingsParams = { saved?: string; error?: string; msg?: string; pending?: string };

const REASON: Record<string, { label: string; tone: Tone }> = {
  liquidation: { label: "Liquidée", tone: "bad" },
  tp: { label: "Take Profit", tone: "ok" },
  sl: { label: "Stop Loss", tone: "warn" },
  partial: { label: "Partielle", tone: "info" },
  manual: { label: "Fermée", tone: "info" }
};

const fmt = (v: number, d = 2) => formatNumber(v, d);
/** Prix : 2 décimales au-dessus de 100, plus pour les petits actifs (MATIC, etc.). */
const pxf = (v: number) => (v >= 100 ? formatNumber(v, 2) : v >= 1 ? formatNumber(v, 4) : formatNumber(v, 6));
const signed = (v: number, d = 2) => `${v > 0 ? "+" : ""}${formatNumber(v, d)}`;
const tone = (v: number): "ok" | "bad" | undefined => (v > 0.005 ? "ok" : v < -0.005 ? "bad" : undefined);
const feesOf = (p: FuturesPeriod) => p.fees_open + p.fees_funding + p.fees_close;
const distTone = (d: number | null): Tone => (d === null ? "info" : d < 3 ? "bad" : d < 8 ? "warn" : "ok");

export default async function FuturesPage({ searchParams }: { searchParams: SettingsParams }) {
  const [ovRes, healthRes, marketsRes, openRes, closedRes, dailyRes, tradersRes, levRes, moneyRes, prices] = await Promise.all([
    loadFuturesOverview(), loadFuturesHealth(), loadFuturesMarkets(), loadOpenPositions(), loadRecentClosed(25), loadMoneyDaily(14), loadTraders(15), loadByLeverage(), loadFuturesMoney(), loadPrices()
  ]);

  const ov = ovRes.data;
  const cfg = ov?.config ?? null;
  const cur = cfg?.currency_symbol ?? "WAKATI";
  const usdPrice = prices.get(cur) ?? null;
  const usd = (v: number) => (usdPrice ? `≈ ${formatUsd(v * usdPrice)}` : "");
  const markets = marketsRes.rows;
  const alerts = buildAlerts(ov, healthRes.data, markets);
  const errors = [ovRes.error, healthRes.error, marketsRes.error, openRes.error, closedRes.error, dailyRes.error, tradersRes.error, levRes.error, moneyRes.error].filter(Boolean).join(" · ");

  if (!ov || !cfg) {
    return (
      <div>
        <PageHeader title="Futures" subtitle="Trading à levier (marge isolée)." updatedAt={formatDateTime(new Date())} />
        <SettingsMessages searchParams={searchParams} />
        <div className="wk-alert-bad">Données futures illisibles{errors ? ` : ${errors}` : ""}. Vérifiez que les migrations 20261107_futures_trading_engine et 20261108_futures_admin sont appliquées.</div>
      </div>
    );
  }

  const o = ov.open;
  const gross = o.long_notional + o.short_notional;
  const longShare = gross > 0 ? (o.long_notional / gross) * 100 : 50;
  const net = o.long_notional - o.short_notional;
  const cap = cfg.max_total_notional > 0 ? cfg.max_total_notional : null;

  const periods: { label: string; p: FuturesPeriod }[] = [
    { label: "Aujourd'hui", p: ov.today }, { label: "7 jours", p: ov.d7 }, { label: "30 jours", p: ov.d30 }, { label: "Depuis le début", p: ov.all }
  ];
  const dailyFeePerDay = cfg.fee_interval_seconds > 0 ? (cfg.fee_rate_pct * 86400) / cfg.fee_interval_seconds : 0;

  return (
    <div>
      <PageHeader
        title="Futures"
        subtitle={`Trading à levier (marge isolée, long / short) sur ${markets.length > 0 ? markets.map((m) => m.display_symbol).join(", ") : cfg.asset_name} : exposition, résultat de la plateforme, santé du moteur, contrôle et réglages. Montants en ${cur}.`}
        updatedAt={formatDateTime(new Date())}
      />
      <SettingsMessages searchParams={searchParams} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      {/* ── Résultat de la plateforme : le chiffre qui compte ── */}
      {moneyRes.data && <MoneyHero money={moneyRes.data} currency={cur} usdPrice={usdPrice} />}

      {/* ── Santé du moteur ── */}
      {alerts.length === 0 ? (
        <div className="wk-alert-ok">Moteur en bonne santé : surveillance active ({healthRes.data?.cron_schedule ?? "—"}), prix à jour, ledger rapproché.</div>
      ) : (
        alerts.map((a, i) => (
          <div key={i} className={a.tone === "bad" ? "wk-alert-bad" : a.tone === "warn" ? "wk-alert-warn" : "wk-alert-ok"} style={a.tone === "info" ? { background: "var(--info-bg)", color: "var(--info)" } : undefined}>{a.text}</div>
        ))
      )}

      {/* ── Exposition ouverte ── */}
      <div className="wk-strip">
        <Stat label="Positions ouvertes" value={String(o.positions)} sub={`${o.traders} trader(s) · ${o.long_count} long / ${o.short_count} short`} />
        <Stat label="Marge immobilisée" value={`${fmt(o.margin)} ${cur}`} sub={usd(o.margin) || "Retirée des soldes tant que les positions sont ouvertes"} />
        <Stat label="Taille ouverte" value={`${fmt(o.notional, 0)} ${cur}`} sub={cap ? `${((o.notional / cap) * 100).toFixed(0)} % de la capacité (${fmt(cap, 0)})` : "Sans plafond de capacité"} tone={cap && o.notional / cap >= 0.9 ? "bad" : undefined} />
        <Stat label="PNL latent des traders" value={`${signed(o.unrealized_pnl)} ${cur}`} sub={o.unrealized_pnl > 0 ? "À payer par la plateforme si tout fermait maintenant" : "Gagné par la plateforme si tout fermait maintenant"} tone={o.unrealized_pnl > 0.005 ? "bad" : o.unrealized_pnl < -0.005 ? "ok" : undefined} />
        <Stat label="Proches de la liquidation" value={String(o.near_liq)} sub={o.worst_liq_distance_pct === null ? "Aucune position ouverte" : `Plus proche : ${formatPct(o.worst_liq_distance_pct, 2)} du prix`} tone={o.near_liq > 0 ? "warn" : undefined} />
      </div>

      <Section title="Exposition long / short" hint="La plateforme est la contrepartie des traders. Un déséquilibre marqué signifie qu'elle gagne ou perd selon le sens du prix.">
        {gross === 0 ? <Empty text="Aucune position ouverte." /> : (
          <>
            <SegmentBar label="Répartition long / short" segments={[
              { key: "long", label: "Long", value: o.long_notional, color: "#2f8f83" },
              { key: "short", label: "Short", value: o.short_notional, color: "#c0504d" }
            ]} />
            <div className="wk-asset-sub" style={{ marginTop: 8, display: "flex", gap: 18, flexWrap: "wrap" }}>
              <span><Swatch color="#2f8f83" /> Long : {fmt(o.long_notional, 0)} {cur} ({longShare.toFixed(0)} %)</span>
              <span><Swatch color="#c0504d" /> Short : {fmt(o.short_notional, 0)} {cur} ({(100 - longShare).toFixed(0)} %)</span>
              <span>Net : {signed(net, 0)} {cur} ({net > 0 ? "les traders sont globalement long" : net < 0 ? "les traders sont globalement short" : "équilibré"})</span>
            </div>
          </>
        )}
      </Section>

      {/* ── Marchés (multi-actifs) ── */}
      <Section title="Marchés" hint="Un marché = un actif tradable. Exposition ouverte et activité récente par actif ; le résultat plateforme est positif quand la plateforme gagne.">
        {markets.length === 0 ? <Empty text="Aucun marché configuré (table futures_markets vide ou migration 20261117 non appliquée)." /> : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Marché</Th><Th right>Prix</Th><Th right>Positions</Th><Th right hideSm>Long / Short</Th><Th right hideSm>PNL latent traders</Th>
                <Th right>7 j : clôturées</Th><Th right hideSm>7 j : taille</Th><Th right>7 j : résultat plateforme</Th><Th right hideSm>30 j : clôturées</Th><Th right>30 j : résultat plateforme</Th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const eff = Math.min(cfg.leverage_max, m.leverage_max);
                return (
                  <tr key={m.asset_symbol}>
                    <Td label="Marché">
                      <b>{m.display_symbol}</b> <span className="wk-asset-sub">{m.asset_name}</span>{" "}
                      {m.is_active ? <Pill tone="ok">Actif</Pill> : <Pill tone="warn">Désactivé</Pill>}
                      <div className="wk-asset-sub">Levier max effectif {eff}x · maintenance {formatNumber(m.maintenance_margin_pct, 2)} %</div>
                    </Td>
                    <Td right label="Prix">{m.price === null ? <Pill tone="bad">aucun</Pill> : <>{pxf(m.price)}{m.price_age_s !== null && m.price_age_s > 15 && <div className="wk-asset-sub">{Math.round(m.price_age_s)} s</div>}</>}</Td>
                    <Td right label="Positions">{m.positions}{m.positions > 0 && <div className="wk-asset-sub">{m.traders} trader(s) · marge {fmt(m.margin)}</div>}</Td>
                    <Td right hideSm label="Long / Short">{fmt(m.long_notional, 0)} / {fmt(m.short_notional, 0)}</Td>
                    <Td right hideSm label="PNL latent traders"><span className={tone(m.unrealized_pnl) ? `wk-${tone(-m.unrealized_pnl)}` : ""}>{signed(m.unrealized_pnl)}</span></Td>
                    <Td right label="7 j : clôturées">{m.trades_7d}{m.liquidations_7d > 0 && <div className="wk-asset-sub">{m.liquidations_7d} liquidation(s)</div>}</Td>
                    <Td right hideSm label="7 j : taille">{fmt(m.volume_7d, 0)}</Td>
                    <Td right label="7 j : résultat plateforme"><span className={tone(m.house_7d) ? `wk-${tone(m.house_7d)}` : ""}>{signed(m.house_7d)}</span></Td>
                    <Td right hideSm label="30 j : clôturées">{m.trades_30d}</Td>
                    <Td right label="30 j : résultat plateforme"><span className={tone(m.house_30d) ? `wk-${tone(m.house_30d)}` : ""}>{signed(m.house_30d)}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          « Résultat plateforme » = − PNL réalisé des traders sur les positions clôturées (frais compris), toutes lignes comprises (les tranches de clôture partielle comptent pour leur PNL, pas comme un trade).
        </div>
      </Section>

      {/* ── Positions ouvertes ── */}
      <Section title="Positions ouvertes" hint="Triées de la plus proche à la plus éloignée de la liquidation. « Fermer » clôture au prix du marché, avec les mêmes règles que dans l'app (frais de fermeture inclus).">
        {openRes.rows.length === 0 ? <Empty text="Aucune position ouverte." /> : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th><Th>Sens</Th><Th right>Marge</Th><Th right>Taille</Th><Th right>Entrée</Th><Th right>Marque</Th>
                <Th right>Impact plateforme</Th><Th right>Liquidation</Th><Th right>Distance</Th><Th right hideSm>Frais</Th><Th hideSm>Ouverte</Th><Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {openRes.rows.map((r) => (
                <tr key={r.id}>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${r.user_id}`}>{r.username ?? shortId(r.user_id)}</a></Td>
                  <Td label="Sens"><Pill tone={r.side === "LONG" ? "ok" : "bad"}>{r.asset_symbol} · {r.side === "LONG" ? "Long" : "Short"} {r.leverage}x</Pill></Td>
                  <Td right label="Marge">{fmt(r.margin)}</Td>
                  <Td right label="Taille">{fmt(r.notional, 0)}</Td>
                  <Td right label="Entrée">{pxf(r.entry_price)}</Td>
                  <Td right label="Marque">{r.mark_price === null ? "—" : pxf(r.mark_price)}</Td>
                  <Td right label="Impact plateforme">{r.unrealized_pnl === null ? "—" : <span className={tone(-r.unrealized_pnl) ? `wk-${tone(-r.unrealized_pnl)}` : ""} title={`PNL latent du trader : ${signed(r.unrealized_pnl)}`}>{signed(-r.unrealized_pnl)}</span>}</Td>
                  <Td right label="Liquidation">{pxf(r.liq_price)}</Td>
                  <Td right label="Distance"><Pill tone={distTone(r.liq_distance_pct)}>{r.liq_distance_pct === null ? "—" : formatPct(r.liq_distance_pct, 2)}</Pill></Td>
                  <Td right hideSm label="Frais">{fmt(r.fees_open + r.fees_funding)}</Td>
                  <Td hideSm label="Ouverte">{formatDate(r.opened_at)}</Td>
                  <Td label="Action">
                    <ConfirmDeleteButton
                      action={forceClosePosition}
                      hiddenFields={{ position_id: r.id }}
                      buttonLabel="Fermer"
                      confirmText={`Fermer la position ${r.side} ${r.leverage}x de ${r.username ?? shortId(r.user_id)} au prix du marché ? Le joueur récupère sa marge ± PNL, moins les frais de fermeture.`}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          « Impact plateforme » = ce que la plateforme gagnerait (+) ou paierait (−) si la position était fermée maintenant, hors frais de fermeture. C'est l'inverse du PNL du trader (visible au survol).
        </div>
      </Section>

      {/* ── Activité par période ── */}
      <Section title="Activité par période" hint="Positions clôturées. Une clôture partielle n'est pas un trade : ses tranches sont comptées à part (leur PNL, leurs frais et leur taille restent dans les totaux).">
        <TableWrap>
          <thead>
            <tr><Th>Période</Th><Th right>Clôturées</Th><Th right>Traders</Th><Th right hideSm>Taille traitée</Th><Th right>Liquidations</Th><Th right hideSm>TP / SL / Manuel</Th><Th right hideSm>Traders gagnants</Th></tr>
          </thead>
          <tbody>
            {periods.map(({ label, p }) => (
              <tr key={label}>
                <Td label="Période">{label}</Td>
                <Td right label="Clôturées">{p.trades}{p.partials > 0 && <div className="wk-asset-sub">+ {p.partials} tranche(s) partielle(s)</div>}</Td>
                <Td right label="Traders">{p.traders}</Td>
                <Td right hideSm label="Taille traitée">{fmt(p.volume, 0)}</Td>
                <Td right label="Liquidations">{p.liquidations} <span className="wk-asset-sub">({fmt(p.margin_lost_liq, 0)} perdus)</span></Td>
                <Td right hideSm label="TP / SL / Manuel">{p.tp} / {p.sl} / {p.manual}</Td>
                <Td right hideSm label="Traders gagnants">{p.trades > 0 ? formatPct((p.wins / p.trades) * 100, 0) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par tranche de levier" hint="Positions clôturées. Un levier élevé liquide plus souvent : utile pour calibrer le levier maximal et la marge de maintenance.">
        {levRes.rows.length === 0 ? <Empty text="Aucune position clôturée." /> : (
          <TableWrap>
            <thead><tr><Th>Levier</Th><Th right>Clôturées</Th><Th right>Liquidations</Th><Th right hideSm>Taille traitée</Th><Th right>PNL net des traders</Th><Th right>Impact plateforme</Th></tr></thead>
            <tbody>
              {levRes.rows.map((b) => (
                <tr key={b.bucket}>
                  <Td label="Levier">{b.bucket}</Td>
                  <Td right label="Clôturées">{b.trades}</Td>
                  <Td right label="Liquidations">{b.liquidations} <span className="wk-asset-sub">({b.trades > 0 ? formatPct((b.liquidations / b.trades) * 100, 0) : "—"})</span></Td>
                  <Td right hideSm label="Taille traitée">{fmt(b.volume, 0)}</Td>
                  <Td right label="PNL net des traders">{signed(b.user_net)}</Td>
                  <Td right label="Impact plateforme"><span className={tone(-b.user_net) ? `wk-${tone(-b.user_net)}` : ""}>{signed(-b.user_net)}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Résultat par jour" hint={`14 derniers jours (UTC), en ${cur}. Point de vue de la plateforme : + = elle gagne.`}>
        {dailyRes.rows.length === 0 ? <Empty text="Aucune donnée." /> : (
          <TableWrap>
            <thead><tr><Th>Jour</Th><Th right>Frais encaissés</Th><Th right>PNL de trading</Th><Th right>Résultat net</Th><Th right hideSm>Clôturées</Th><Th right hideSm>Liquidations</Th></tr></thead>
            <tbody>
              {dailyRes.rows.map((d) => {
                const fees = d.fees_open + d.fees_funding + d.fees_close;
                return (
                  <tr key={d.day}>
                    <Td label="Jour">{d.day}</Td>
                    <Td right label="Frais encaissés"><span className={fees > 0.004 ? "wk-money-pos" : ""}>{sg(fees)}</span></Td>
                    <Td right label="PNL de trading"><span className={d.trading_pnl > 0.004 ? "wk-money-pos" : d.trading_pnl < -0.004 ? "wk-money-neg" : ""}>{sg(d.trading_pnl)}</span></Td>
                    <Td right label="Résultat net"><b className={d.net > 0.004 ? "wk-money-pos" : d.net < -0.004 ? "wk-money-neg" : ""}>{sg(d.net)}</b></Td>
                    <Td right hideSm label="Clôturées">{d.trades}</Td>
                    <Td right hideSm label="Liquidations">{d.liquidations}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* ── Traders ── */}
      <Section title="Traders" hint="Triés par taille traitée. « À surveiller » : au moins 5 positions clôturées, plus de 70 % gagnantes et un gain net positif (statistiquement rare : à vérifier à la main, sans présumer de triche).">
        {tradersRes.rows.length === 0 ? <Empty text="Aucun trader pour le moment." /> : (
          <TableWrap>
            <thead><tr><Th>Utilisateur</Th><Th right>Clôturées</Th><Th right hideSm>Ouvertes</Th><Th right>Gagnantes</Th><Th right hideSm>Liquidations</Th><Th right>PNL net</Th><Th right hideSm>Frais payés</Th><Th right hideSm>Taille traitée</Th><Th>Signal</Th></tr></thead>
            <tbody>
              {tradersRes.rows.map((t) => {
                const wr = t.trades > 0 ? (t.wins / t.trades) * 100 : null;
                const watch = t.trades >= 5 && wr !== null && wr >= 70 && t.net_pnl > 0;
                return (
                  <tr key={t.user_id}>
                    <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${t.user_id}`}>{t.username ?? shortId(t.user_id)}</a></Td>
                    <Td right label="Clôturées">{t.trades}</Td>
                    <Td right hideSm label="Ouvertes">{t.open_positions}</Td>
                    <Td right label="Gagnantes">{wr === null ? "—" : formatPct(wr, 0)}</Td>
                    <Td right hideSm label="Liquidations">{t.liquidations}</Td>
                    <Td right label="PNL net"><span className={tone(t.net_pnl) ? `wk-${tone(t.net_pnl)}` : ""}>{signed(t.net_pnl)}</span></Td>
                    <Td right hideSm label="Frais payés">{fmt(t.fees_paid)}</Td>
                    <Td right hideSm label="Taille traitée">{fmt(t.volume_notional, 0)}</Td>
                    <Td label="Signal">{watch ? <Pill tone="warn">À surveiller</Pill> : <span className="wk-asset-sub">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Dernières clôtures" hint="Les 25 dernières positions fermées (manuellement, par TP/SL ou liquidées).">
        {closedRes.rows.length === 0 ? <Empty text="Aucune position clôturée." /> : (
          <TableWrap>
            <thead><tr><Th>Utilisateur</Th><Th>Sens</Th><Th right>Marge</Th><Th right hideSm>Entrée → Sortie</Th><Th>Motif</Th><Th right>Résultat net</Th><Th right hideSm>Frais</Th><Th hideSm>Clôturée</Th></tr></thead>
            <tbody>
              {closedRes.rows.map((r) => {
                const rs = REASON[r.close_reason ?? "manual"] ?? REASON.manual;
                const pnl = r.realized_pnl ?? 0;
                return (
                  <tr key={r.id}>
                    <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${r.user_id}`}>{r.username ?? shortId(r.user_id)}</a></Td>
                    <Td label="Sens"><Pill tone={r.side === "LONG" ? "ok" : "bad"}>{r.asset_symbol} · {r.side === "LONG" ? "Long" : "Short"} {r.leverage}x</Pill></Td>
                    <Td right label="Marge">{fmt(r.margin)}</Td>
                    <Td right hideSm label="Entrée → Sortie">{pxf(r.entry_price)} → {r.exit_price === null ? "—" : pxf(r.exit_price)}</Td>
                    <Td label="Motif"><Pill tone={rs.tone}>{rs.label}</Pill></Td>
                    <Td right label="Résultat net"><span className={tone(pnl) ? `wk-${tone(pnl)}` : ""}>{signed(pnl)}</span></Td>
                    <Td right hideSm label="Frais">{fmt(r.fees_open + r.fees_funding + r.fees_close)}</Td>
                    <Td hideSm label="Clôturée">{r.closed_at ? formatDate(r.closed_at) : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* ── Contrôle d'urgence ── */}
      <Section title="Contrôle" hint="Actions immédiates. Chacune est inscrite dans le journal d'audit.">
        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Interrupteur</h3>
              <p className="wk-settings-hint">{cfg.is_active ? "Le trading est ouvert. Désactiver bloque uniquement les NOUVELLES positions : les positions ouvertes continuent d'être surveillées, liquidées et peuvent être fermées par leurs propriétaires." : "Le trading est fermé aux nouvelles positions. Les positions ouvertes restent surveillées et fermables."}</p>
            </div>
            <form action={setFuturesActive}>
              <input type="hidden" name="active" value={cfg.is_active ? "0" : "1"} />
              <button type="submit" className="wk-submit-sm">{cfg.is_active ? "Désactiver le trading" : "Réactiver le trading"}</button>
            </form>
          </div>
        </div>
        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Fermer toutes les positions</h3>
              <p className="wk-settings-hint">Urgence (panne de prix, faille détectée…). Ferme les {o.positions} position(s) ouverte(s) au prix du marché : chaque joueur récupère sa marge ± PNL moins les frais. Irréversible. Si le prix est périmé (&gt; 15 s), rien n'est fermé.</p>
            </div>
          </div>
          <form action={forceCloseAll} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div>
              <label className="wk-label" htmlFor="confirm">Tapez FERMER pour confirmer</label>
              <input id="confirm" name="confirm" type="text" autoComplete="off" className="wk-input" placeholder="FERMER" />
            </div>
            <div style={{ minWidth: 280 }}><ReasonField id="reason-close-all" /></div>
            <button type="submit" className="wk-submit-sm" style={{ background: "var(--bad)" }} disabled={o.positions === 0}>Fermer {o.positions} position(s)</button>
          </form>
        </div>
      </Section>

      {/* ── Réglages ── */}
      <Section title="Réglages du trading futures" hint="Lus par l'app à chaque ouverture. Les frais, la marge de maintenance et l'intervalle sont figés à l'ouverture de chaque position : un changement ne s'applique qu'aux NOUVELLES positions.">
        <SettingsCard returnTo={RETURN} title="Trading futures" hint={`Réglages communs à tous les marchés (frais, marges, plafonds, positions max). Levier et marge de maintenance se règlent par marché, dans la section suivante. Devise : ${cur}.`} updatedAt={cfg.updated_at ? formatDateTime(new Date(cfg.updated_at)) + (cfg.updated_by ? ` par ${cfg.updated_by}` : "") : null} action={updateFuturesConfig} requireReason>
          <Field label={`Marge par défaut (${cur})`} name="margin_default" defaultValue={cfg.margin_default} />
          <Field label="Marge minimale" name="margin_min" defaultValue={cfg.margin_min} />
          <Field label="Marge maximale" name="margin_max" defaultValue={cfg.margin_max} />
          <Field label="Levier par défaut" name="leverage_default" step="1" defaultValue={cfg.leverage_default} />
          <Field label="Levier minimal" name="leverage_min" step="1" defaultValue={cfg.leverage_min} />
          <Field label="Levier maximal" name="leverage_max" step="1" defaultValue={cfg.leverage_max} hint="Plafond global : le levier effectif d'un marché est le plus petit de ce plafond et du levier max du marché." />
          <TextField label="Raccourcis de levier" name="leverage_presets" defaultValue={cfg.leverage_presets.join(", ")} hint="Séparés par des virgules, dans l'intervalle ci-dessus." />
          <Field label="Frais d'ouverture (% de la taille)" name="open_fee_pct" defaultValue={cfg.open_fee_pct} hint="Taille = marge × levier." />
          <Field label="Frais de fermeture (% de la taille)" name="close_fee_pct" defaultValue={cfg.close_fee_pct} />
          <Field label="Frais périodiques (% de la taille)" name="fee_rate_pct" defaultValue={cfg.fee_rate_pct} hint={`Prélevés sur la marge à chaque intervalle.${dailyFeePerDay > 0 ? ` Actuellement ≈ ${formatNumber(dailyFeePerDay, 3)} % de la taille par jour.` : ""}`} />
          <Field label="Intervalle des frais (secondes)" name="fee_interval_seconds" step="1" defaultValue={cfg.fee_interval_seconds} hint="3600 = 1 h, 28800 = 8 h, 86400 = 24 h. 0 = pas de frais périodiques." />
          <Field label="Marge de maintenance (% de la taille)" name="maintenance_margin_pct" defaultValue={cfg.maintenance_margin_pct} hint="Ce champ n'est plus lu à l'ouverture : chaque marché a sa propre marge de maintenance (section « Réglages des marchés »)." />
          <Field label="Positions ouvertes max / utilisateur" name="max_open_positions" step="1" defaultValue={cfg.max_open_positions} />
          <Field label="Exposition max par joueur" name="max_notional_per_user" defaultValue={cfg.max_notional_per_user} hint={`Somme des tailles (marge × levier) qu'un joueur peut avoir ouvertes, en ${cur}. 0 = illimité.`} />
          <Field label="Capacité totale de la plateforme" name="max_total_notional" defaultValue={cfg.max_total_notional} hint="Somme des tailles ouvertes tous joueurs confondus. 0 = illimité. Limite le risque de contrepartie." />
          <Toggle label="TP / SL autorisés" name="tp_sl_enabled" defaultChecked={cfg.tp_sl_enabled} />
          <Toggle label="Trading actif (nouvelles positions)" name="is_active" defaultChecked={cfg.is_active} />
        </SettingsCard>
      </Section>

      <Section title="Réglages des marchés" hint="Un formulaire par actif. Désactiver un marché bloque les NOUVELLES positions sur cet actif : les positions ouvertes restent surveillées, liquidées et fermables. Les positions déjà ouvertes gardent leur marge de maintenance.">
        {markets.map((m) => (
          <SettingsCard
            key={m.asset_symbol}
            returnTo={RETURN}
            title={`${m.display_symbol} — ${m.asset_name}`}
            hint={`Symbole technique : ${m.asset_symbol}. ${m.positions > 0 ? `${m.positions} position(s) ouverte(s) sur ce marché.` : "Aucune position ouverte."} Levier effectif aujourd'hui : ${Math.min(cfg.leverage_max, m.leverage_max)}x (plafond global ${cfg.leverage_max}x).`}
            action={updateFuturesMarket}
          >
            <input type="hidden" name="asset_symbol" value={m.asset_symbol} />
            <Field label="Levier maximal du marché" name="leverage_max" step="1" defaultValue={m.leverage_max} hint="Entier. 100 / levier doit rester supérieur à la marge de maintenance." />
            <Field label="Marge de maintenance (% de la taille)" name="maintenance_margin_pct" defaultValue={m.maintenance_margin_pct} hint="Seuil de liquidation de ce marché, utilisé à l'ouverture des nouvelles positions." />
            <Toggle label="Marché actif (nouvelles positions)" name="is_active" defaultChecked={m.is_active} />
          </SettingsCard>
        ))}
      </Section>
    </div>
  );
}

function Stat({ label, value, sub, tone: t }: { label: string; value: string; sub: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className={`wk-strip-value${t ? ` wk-${t}` : ""}`}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
