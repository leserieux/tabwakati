import { getSupabaseAdmin, q } from "@/lib/data";
import { loadUserAssetSummaries } from "@/lib/assets";
import { formatNumber, formatUsd, formatCompactUsd, formatPct, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Asset = { symbol: string; name: string; network: string; ledger_symbol: string; coingecko_id: string | null };
type Price = { asset_symbol: string; price_usd: number; change_24h: number | null; market_cap: number | null; updated_at: string };
type Latest = {
  asset_symbol: string;
  recorded_at: string;
  price_high_24h: number | null;
  price_low_24h: number | null;
  change_24h_pct: number | null;
  volume_24h_usd: number | null;
  market_cap_usd: number | null;
  market_cap_rank: number | null;
  source: string | null;
};
type Daily = { asset_symbol: string; day: string; open_usd: number; close_usd: number; high_usd: number; low_usd: number; avg_usd: number; samples: number };

type Health = "ok" | "stale" | "missing" | "zero";

type Row = {
  asset: Asset;
  price: number | null;
  change24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  rank: number | null;
  source: string | null;
  ageHours: number | null;
  maxAgeHours: number;
  health: Health;
  spark: number[];
  hasMarketFeed: boolean;
};

const HOUR = 3_600_000;

// Seuils de fraîcheur, selon la façon dont le prix est alimenté :
// - actif coté (coingecko_id renseigné) : relevé toutes les ~5 min → périmé au-delà de 3 h
// - monnaie fiat (réseau "Fiat") : taux qui bouge peu → périmé au-delà de 30 jours
// - autre (ex : WAKATI, prix calculé une fois par jour) → périmé au-delà de 36 h
function maxAgeHours(a: Asset): number {
  if (a.coingecko_id) return 3;
  if (a.network === "Fiat") return 24 * 30;
  return 36;
}

function fmtAge(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} j`;
}

function changeTone(c: number | null): Tone {
  if (c === null || c === 0) return "info";
  return c > 0 ? "ok" : "bad";
}

function signedPct(n: number, digits = 2): string {
  return (n > 0 ? "+" : "") + formatPct(n, digits);
}

export default async function MarketsPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();

  const [assetsRes, pricesRes, latestRes, dailyRes, holdings] = await Promise.all([
    q<Asset>(db.from("supported_assets").select("symbol, name, network, ledger_symbol, coingecko_id").eq("is_active", true).order("symbol")),
    q<Price>(db.from("asset_prices").select("asset_symbol, price_usd, change_24h, market_cap, updated_at")),
    q<Latest>(db.from("admin_market_latest").select("*")),
    db.rpc("admin_market_daily", { p_days: 30 }),
    loadUserAssetSummaries()
  ]);

  const daily = ((dailyRes.data as Daily[] | null) ?? []).map((d) => ({
    ...d,
    open_usd: Number(d.open_usd),
    close_usd: Number(d.close_usd),
    high_usd: Number(d.high_usd),
    low_usd: Number(d.low_usd),
    avg_usd: Number(d.avg_usd),
    samples: Number(d.samples)
  }));

  const errors = [assetsRes.error, pricesRes.error, latestRes.error, dailyRes.error?.message, holdings.error].filter(Boolean).join(" · ");

  const priceBy = new Map(pricesRes.rows.map((p) => [String(p.asset_symbol), p]));
  const latestBy = new Map(latestRes.rows.map((l) => [String(l.asset_symbol), l]));
  const holdingBy = new Map(holdings.rows.map((h) => [h.asset, h]));
  const dailyBy = new Map<string, typeof daily>();
  for (const d of daily) {
    const list = dailyBy.get(d.asset_symbol) || [];
    list.push(d);
    dailyBy.set(d.asset_symbol, list);
  }

  const rows: Row[] = assetsRes.rows.map((asset) => {
    const p = priceBy.get(asset.symbol);
    const l = latestBy.get(asset.symbol);
    const price = p ? Number(p.price_usd) : null;
    const ageHours = p ? (now - new Date(p.updated_at).getTime()) / HOUR : null;
    const limit = maxAgeHours(asset);
    const health: Health = !p ? "missing" : !(price !== null && price > 0) ? "zero" : ageHours !== null && ageHours > limit ? "stale" : "ok";
    const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));
    return {
      asset,
      price,
      change24h: num(l?.change_24h_pct) ?? num(p?.change_24h),
      high24h: num(l?.price_high_24h),
      low24h: num(l?.price_low_24h),
      volume24h: num(l?.volume_24h_usd),
      marketCap: num(l?.market_cap_usd) ?? (p && Number(p.market_cap) > 0 ? Number(p.market_cap) : null),
      rank: num(l?.market_cap_rank),
      source: l?.source ?? null,
      ageHours,
      maxAgeHours: limit,
      health,
      spark: (dailyBy.get(asset.symbol) || []).map((d) => d.close_usd),
      hasMarketFeed: !!l && l.source === "coingecko"
    };
  });

  rows.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || a.asset.symbol.localeCompare(b.asset.symbol));

  const okCount = rows.filter((r) => r.health === "ok").length;
  const problems = rows.filter((r) => r.health !== "ok");

  const movers = rows.filter((r) => r.health === "ok" && r.hasMarketFeed && r.change24h !== null && Number.isFinite(r.change24h));
  const best = movers.length ? movers.reduce((a, b) => ((b.change24h as number) > (a.change24h as number) ? b : a)) : null;
  const worst = movers.length ? movers.reduce((a, b) => ((b.change24h as number) < (a.change24h as number) ? b : a)) : null;

  const feedTimes = latestRes.rows.filter((l) => l.source === "coingecko").map((l) => new Date(l.recorded_at).getTime());
  const feedAgeHours = feedTimes.length ? (now - Math.max(...feedTimes)) / HOUR : null;
  const feedTone: Tone = feedAgeHours === null ? "bad" : feedAgeHours > 3 ? "bad" : feedAgeHours > 0.5 ? "warn" : "ok";

  // Statistiques sur la période disponible (jusqu'à 30 jours), par actif ayant au moins 2 jours de données
  const stats = rows
    .map((r) => {
      const series = dailyBy.get(r.asset.symbol) || [];
      if (series.length < 2) return null;
      const min = Math.min(...series.map((d) => d.low_usd));
      const max = Math.max(...series.map((d) => d.high_usd));
      const samples = series.reduce((s, d) => s + d.samples, 0);
      const avg = samples > 0 ? series.reduce((s, d) => s + d.avg_usd * d.samples, 0) / samples : 0;
      const first = series[0].open_usd;
      const last = series[series.length - 1].close_usd;
      return { symbol: r.asset.symbol, days: series.length, min, max, avg, change: first > 0 ? ((last - first) / first) * 100 : null, amplitude: min > 0 ? ((max - min) / min) * 100 : null, lastDay: series[series.length - 1].day };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div>
      <PageHeader title="Marchés" subtitle="Prix, variations et santé des cours de tous les actifs actifs de la plateforme." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Cours à jour" value={`${okCount} / ${rows.length}`} sub="Actifs actifs avec un prix frais" tone={problems.length === 0 ? "ok" : "warn"} />
        <StatCard label="Meilleure variation 24 h" value={best ? signedPct(best.change24h as number) : "—"} sub={best ? best.asset.symbol : "Aucun actif coté"} tone={best && (best.change24h as number) > 0 ? "ok" : undefined} />
        <StatCard label="Pire variation 24 h" value={worst ? signedPct(worst.change24h as number) : "—"} sub={worst ? worst.asset.symbol : "Aucun actif coté"} tone={worst && (worst.change24h as number) < 0 ? "bad" : undefined} />
        <StatCard label="Flux de prix CoinGecko" value={feedAgeHours === null ? "Aucun" : `il y a ${fmtAge(feedAgeHours)}`} sub="Dernier relevé reçu" tone={feedTone} />
      </div>

      <Section title="Marché" hint="Classé par capitalisation. Le prix de WAKATI et des monnaies fiat n'est pas issu du marché (WAKATI est calculé chaque jour, voir WAKATI › Prix et réserve), d'où l'absence de volume et de capitalisation.">
        {rows.length === 0 ? (
          <Empty text="Aucun actif actif." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th right>Prix</Th>
                <Th right>24 h</Th>
                <Th right hideSm>Plus bas – plus haut 24 h</Th>
                <Th right hideSm>Volume 24 h</Th>
                <Th right hideSm>Capitalisation</Th>
                <Th right hideSm>Rang</Th>
                <Th hideSm>Tendance 30 j</Th>
                <Th>Cours</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset.symbol}>
                  <Td label="Actif">
                    <div>{r.asset.symbol}</div>
                    <div className="wk-asset-sub">{r.asset.name} · {r.asset.network}</div>
                  </Td>
                  <Td right label="Prix">{r.price !== null && r.price > 0 ? formatUsd(r.price) : "—"}</Td>
                  <Td right label="24 h">{r.change24h === null || !r.hasMarketFeed ? "—" : <Pill tone={changeTone(r.change24h)}>{signedPct(r.change24h)}</Pill>}</Td>
                  <Td right hideSm label="Plus bas – plus haut 24 h">{r.low24h !== null && r.high24h !== null ? `${formatUsd(r.low24h)} – ${formatUsd(r.high24h)}` : "—"}</Td>
                  <Td right hideSm label="Volume 24 h">{r.volume24h !== null ? formatCompactUsd(r.volume24h) : "—"}</Td>
                  <Td right hideSm label="Capitalisation">{r.marketCap !== null ? formatCompactUsd(r.marketCap) : "—"}</Td>
                  <Td right hideSm label="Rang">{r.rank !== null ? `#${r.rank}` : "—"}</Td>
                  <Td hideSm label="Tendance 30 j"><Sparkline values={r.spark} /></Td>
                  <Td label="Cours">
                    {r.health === "ok" && <Pill tone="ok">{fmtAge(r.ageHours)}</Pill>}
                    {r.health === "stale" && <Pill tone="warn">Périmé · {fmtAge(r.ageHours)}</Pill>}
                    {r.health === "missing" && <Pill tone="bad">Sans cours</Pill>}
                    {r.health === "zero" && <Pill tone="bad">Cours à 0</Pill>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Statistiques sur la période disponible" hint="Jusqu'à 30 jours. Le nombre de jours varie selon l'actif : certains n'ont été ajoutés au flux de prix que récemment, ne comparez pas une variation sur 31 jours à une sur 9. Plus bas / plus haut = extrêmes des relevés (un toutes les ~5 min), pas les extrêmes exacts du marché.">
        {stats.length === 0 ? (
          <Empty text="Pas encore assez d'historique de prix." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th right>Jours de données</Th>
                <Th right>Plus bas</Th>
                <Th right>Plus haut</Th>
                <Th right hideSm>Moyenne</Th>
                <Th right>Variation</Th>
                <Th right hideSm>Amplitude</Th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.symbol}>
                  <Td label="Actif">
                    {s.symbol}
                    {(() => {
                      const ageDays = (now - new Date(s.lastDay + "T23:59:59Z").getTime()) / (24 * HOUR);
                      return ageDays > 2 ? <div className="wk-asset-sub">Données arrêtées le {s.lastDay}</div> : null;
                    })()}
                  </Td>
                  <Td right label="Jours de données">{s.days}</Td>
                  <Td right label="Plus bas">{formatUsd(s.min)}</Td>
                  <Td right label="Plus haut">{formatUsd(s.max)}</Td>
                  <Td right hideSm label="Moyenne">{formatUsd(s.avg)}</Td>
                  <Td right label="Variation">{s.change === null ? "—" : <Pill tone={changeTone(Number(s.change.toFixed(2)))}>{signedPct(s.change)}</Pill>}</Td>
                  <Td right hideSm label="Amplitude">{s.amplitude === null ? "—" : formatPct(s.amplitude, 1)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Santé des prix" hint="Un cours absent, à 0 ou périmé fausse la valorisation en USD partout ailleurs dans le dashboard (Solvabilité, Liquidité, Utilisateurs).">
        {problems.length === 0 ? (
          <Empty text="Tous les actifs actifs ont un cours frais." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th>Problème</Th>
                <Th>Conséquence</Th>
              </tr>
            </thead>
            <tbody>
              {problems.map((r) => {
                const held = holdingBy.get(r.asset.symbol);
                const sameLedger = rows.find((o) => o.asset.symbol !== r.asset.symbol && o.asset.ledger_symbol === r.asset.ledger_symbol && o.health === "ok");
                const problem =
                  r.health === "missing"
                    ? "Aucun cours dans asset_prices"
                    : r.health === "zero"
                    ? "Cours à 0"
                    : `Dernière mise à jour il y a ${fmtAge(r.ageHours)} (seuil ${fmtAge(r.maxAgeHours)})`;
                let consequence: string;
                if (held && held.users > 0) {
                  consequence =
                    r.health === "stale"
                      ? `${held.users} utilisateur(s) en détiennent ${formatNumber(held.total)} : valorisés au dernier cours connu, qui peut ne plus refléter le marché.`
                      : `${held.users} utilisateur(s) en détiennent ${formatNumber(held.total)} : valorisés à 0 $ dans les autres pages.`;
                } else {
                  consequence =
                    r.health === "stale"
                      ? "Aucun solde utilisateur aujourd'hui, donc pas d'impact immédiat."
                      : "Aucun solde utilisateur aujourd'hui, mais un premier dépôt serait valorisé à 0 $.";
                }
                if (sameLedger && (r.health === "missing" || r.health === "zero")) {
                  consequence += ` Un cours existe pour ${sameLedger.asset.symbol} (même symbole ledger « ${r.asset.ledger_symbol} »).`;
                }
                return (
                  <tr key={r.asset.symbol}>
                    <Td label="Actif">
                      {r.asset.symbol}
                      <div className="wk-asset-sub">{r.asset.network}</div>
                    </Td>
                    <Td label="Problème"><Pill tone={r.health === "stale" ? "warn" : "bad"}>{problem}</Pill></Td>
                    <Td label="Conséquence">{consequence}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="wk-asset-sub">—</span>;
  const width = 96;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Tendance sur ${values.length} jours`}>
      <polyline points={points} fill="none" stroke={up ? "var(--ok)" : "var(--bad)"} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
