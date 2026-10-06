import { getSupabaseAdmin, loadPrices } from "@/lib/data";
import { loadOnchainCustody } from "@/lib/custody";
import { fetchPawapayWallets } from "@/lib/pawapay";
import { loadWakatiInApp } from "@/lib/wakati";
import { formatNumber, formatToken, formatCompactNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, Icon, SegmentBar, Swatch, SEG } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tokens gérés en interne : aucune réserve à couvrir ici
const INTERNAL_ONLY_ASSETS = new Set(["WAKATI"]);
const EPS = 0.00000001;

type Liab = { total: number; count: number };
type Status = "covered" | "minor" | "short" | "sweep" | "error";

/** Une ligne = un actif : ce que j'ai, ce que je dois, le résultat. */
interface Line {
  asset: string;
  label: string; // ex. "BNB (BSC)"
  have: number | null;
  owe: number;
  note?: string; // ex. "dont 2 sur les adresses des utilisateurs"
  status: Status;
  priceUsd: number | null;
  error?: string;
  details?: { label: string; value: number }[];
}

// ─────────────────────────── Chargement des données ───────────────────────────

async function loadLiabilities(): Promise<Map<string, Liab>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_asset_liabilities");
  if (error) throw new Error(`Impossible de lire ce qui est dû aux utilisateurs (${error.message})`);
  const map = new Map<string, Liab>();
  for (const l of (data as any[]) || []) {
    map.set(l.asset_symbol, { total: Number(l.total_liability), count: Number(l.user_count) });
  }
  return map;
}

function computeStatus(have: number | null, owe: number, treasuryOnly: number | null): Status {
  if (have === null) return "error";
  if (have < owe - EPS) return "short";
  if (treasuryOnly !== null && treasuryOnly < owe - EPS) return "sweep";
  return "covered";
}

async function loadCrypto(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[] }> {
  const db = getSupabaseAdmin();
  const { data: assets, error: assetsError } = await db
    .from("supported_assets")
    .select("symbol, network, contract_address, decimals")
    .neq("network", "Fiat")
    .eq("is_active", true);
  if (assetsError) throw new Error(`Impossible de lire les actifs (${assetsError.message})`);

  const toRead = (assets || []).filter((a) => {
    const l = liab.get(a.symbol) || { total: 0, count: 0 };
    if (INTERNAL_ONLY_ASSETS.has(a.symbol)) return false; // WAKATI : section dédiée plus bas
    return !(l.total === 0 && l.count === 0);
  });

  const custody = await loadOnchainCustody(toRead);

  const lines: Line[] = toRead.map((asset) => {
    const owe = liab.get(asset.symbol)?.total ?? 0;
    const c = custody.get(asset.symbol);
    const treasury = c?.treasury ?? null;
    const users = c?.users ?? 0;
    const usersFailed = c?.usersFailed ?? 0;
    const have = c?.total ?? null;

    const noteParts: string[] = [];
    if (users > EPS) noteParts.push(`dont ${formatNumber(users)} encore sur les adresses des utilisateurs`);
    if (usersFailed > 0) noteParts.push(`${usersFailed} adresse(s) non lue(s)`);

    return {
      asset: asset.symbol,
      label: `${asset.symbol} (${asset.network})`,
      have,
      owe,
      note: noteParts.join(" · ") || undefined,
      status: computeStatus(have, owe, treasury),
      priceUsd: prices.get(asset.symbol) ?? null,
      error: c?.error
    };
  });

  lines.sort((a, b) => a.asset.localeCompare(b.asset));

  return { lines };
}

async function loadMobileMoney(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[]; error?: string }> {
  const { data: countries, error } = await getSupabaseAdmin()
    .from("payment_countries")
    .select("iso_code, currency_code, wallet_asset_symbol")
    .eq("is_active", true);
  if (error) throw new Error(`Impossible de lire les pays (${error.message})`);

  const { wallets, error: pawapayError } = await fetchPawapayWallets();

  const byAsset = new Map<string, { iso: string; currency: string }[]>();
  for (const c of countries || []) {
    const list = byAsset.get(c.wallet_asset_symbol) || [];
    list.push({ iso: String(c.iso_code).toUpperCase(), currency: c.currency_code });
    byAsset.set(c.wallet_asset_symbol, list);
  }

  const lines: Line[] = [];
  for (const [asset, list] of byAsset) {
    const owe = liab.get(asset)?.total ?? 0;
    const details = list.map((c) => ({
      label: `${c.iso} (${c.currency})`,
      value: wallets.filter((w) => w.country === c.iso).reduce((n, w) => n + w.balance, 0)
    }));
    const have = pawapayError ? null : details.reduce((n, d) => n + d.value, 0);
    lines.push({
      asset,
      label: `${asset} (PawaPay)`,
      have,
      owe,
      status: computeStatus(have, owe, null),
      priceUsd: prices.get(asset) ?? null,
      error: pawapayError,
      details
    });
  }
  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  // On masque un actif sans rien de dû ni de détenu (ex. un pays pas encore utilisé)
  return { lines: lines.filter((l) => l.owe > EPS || (l.have ?? 0) > EPS), error: pawapayError };
}

// ─────────────────────────────────── Page ───────────────────────────────────

const MINOR_USD = 1; // en dessous, un manque est signalé « mineur »

function gap(l: Line): number | null {
  return l.have === null ? null : l.have - l.owe;
}
function haveUsd(l: Line): number | null {
  return l.have !== null && l.priceUsd !== null ? l.have * l.priceUsd : null;
}
function oweUsd(l: Line): number | null {
  return l.priceUsd !== null ? l.owe * l.priceUsd : null;
}
function ratio(l: Line): number {
  if (l.have === null) return 0;
  return l.owe > EPS ? l.have / l.owe : 1;
}
function tone(s: Status): "ok" | "warn" | "bad" | "info" {
  return s === "covered" ? "ok" : s === "short" || s === "error" ? "bad" : s === "minor" || s === "sweep" ? "warn" : "info";
}
function usd(l: Line, amount: number): string {
  return l.priceUsd !== null ? formatUsd(amount * l.priceUsd) : "";
}

export default async function SolvencyPage() {
  let crypto: Line[] = [];
  let mobile: Line[] = [];
  let loadError: string | null = null;

  const prices = await loadPrices();
  const wk = await loadWakatiInApp();
  try {
    const liab = await loadLiabilities();
    const [c, m] = await Promise.all([loadCrypto(liab, prices), loadMobileMoney(liab, prices)]);
    crypto = c.lines;
    mobile = m.lines;
  } catch (e: any) {
    loadError = e?.message || "Erreur de chargement";
  }

  // Un manque de moins de 1 $ est « mineur » (poussière) et ne déclenche pas l'alerte rouge
  const classify = (l: Line): Line => {
    const g = gap(l);
    if (l.status === "short" && g !== null && l.priceUsd !== null && Math.abs(g * l.priceUsd) < MINOR_USD) return { ...l, status: "minor" };
    return l;
  };
  crypto = crypto.map(classify);
  mobile = mobile.map(classify);

  const all = [...crypto, ...mobile];
  const short = all.filter((l) => l.status === "short");
  const minor = all.filter((l) => l.status === "minor");
  const errors = all.filter((l) => l.status === "error");
  const toSweep = all.filter((l) => l.status === "sweep");

  // Totaux en USD (actifs valorisés uniquement). La couverture ne compense pas un actif par un autre.
  let held = 0;
  let owed = 0;
  let covered = 0;
  for (const l of all) {
    const h = haveUsd(l);
    const o = oweUsd(l);
    if (h === null || o === null) continue;
    held += h;
    owed += o;
    covered += Math.min(h, o);
  }
  const coverage = owed > 0 ? covered / owed : 1;
  const missingUsd = short.reduce((n, l) => n + (l.priceUsd !== null ? -(gap(l) ?? 0) * l.priceUsd : 0), 0);

  // Actions concrètes, en français simple
  const todo: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  for (const l of short) {
    const missing = -(gap(l) ?? 0);
    const u = usd(l, missing);
    todo.push({
      tone: "bad",
      text: l.label.includes("PawaPay")
        ? `Il manque ${formatNumber(missing)} ${l.asset}${u ? ` (environ ${u})` : ""} chez PawaPay. Approvisionne le compte marchand.`
        : `Il manque ${formatNumber(missing)} ${l.asset}${u ? ` (environ ${u})` : ""}. Envoie-les sur l'adresse du treasury.`
    });
  }
  for (const l of minor) {
    const missing = -(gap(l) ?? 0);
    const u = usd(l, missing);
    todo.push({ tone: "warn", text: `Écart mineur sur ${l.asset} : il manque ${formatNumber(missing)}${u ? ` (environ ${u})` : ""}. À combler quand tu approvisionnes le treasury.` });
  }
  for (const l of toSweep) todo.push({ tone: "warn", text: `${l.asset} : les fonds sont couverts, mais une partie est encore sur les adresses des utilisateurs. Lance le balayage.` });
  for (const l of errors) todo.push({ tone: "bad", text: `${l.label} : lecture impossible (${l.error || "erreur inconnue"}).` });

  const hero =
    loadError || all.length === 0
      ? { tone: "bad" as const, icon: "x" as const, title: "Le calcul n'a pas pu être fait", text: loadError || "Aucune donnée disponible." }
      : short.length > 0
        ? { tone: "bad" as const, icon: "alert" as const, title: missingUsd > 0 ? `Il manque environ ${formatUsd(missingUsd)} pour couvrir tout le monde` : "Certains actifs ne sont pas couverts", text: "Les lignes en rouge ci-dessous indiquent quoi approvisionner." }
        : errors.length > 0
          ? { tone: "warn" as const, icon: "alert" as const, title: "Certaines lectures ont échoué", text: minor.length > 0 ? "Les autres actifs sont couverts ou n'ont qu'un écart mineur, mais tous les soldes n'ont pas pu être vérifiés." : "Les autres actifs sont couverts, mais tous les soldes n'ont pas pu être vérifiés." }
          : { tone: "ok" as const, icon: "check" as const, title: "Tout est couvert", text: minor.length > 0 ? `Écarts mineurs (moins de ${formatUsd(MINOR_USD)}) sur ${minor.map((l) => l.asset).join(", ")}.` : "Tu détiens assez pour rembourser tous les utilisateurs." };

  return (
    <div>
      <PageHeader title="Solvabilité" subtitle="Compare l'argent réel que tu détiens à ce que tu dois aux utilisateurs, actif par actif." updatedAt={formatDateTime(new Date())} />

      <div className={`wk-hero wk-hero-${hero.tone}`}>
        <div className="wk-hero-top">
          <div className="wk-hero-msg">
            <span className={`wk-hero-icon wk-hero-icon-${hero.tone}`}>
              <Icon name={hero.icon} size={26} />
            </span>
            <div>
              <h2 className="wk-hero-title">{hero.title}</h2>
              <p className="wk-hero-text">{hero.text}</p>
            </div>
          </div>
          {owed > 0 && (
            <div className="wk-figures">
              <div className="wk-figure">
                <div className="wk-figure-label">Détenu</div>
                <div className="wk-figure-value">{formatUsd(held)}</div>
              </div>
              <div className="wk-figure">
                <div className="wk-figure-label">Dû aux utilisateurs</div>
                <div className="wk-figure-value">{formatUsd(owed)}</div>
              </div>
              <div className="wk-figure">
                <div className="wk-figure-label">Dû couvert</div>
                <div className="wk-figure-value">{formatPct(coverage * 100)}</div>
              </div>
            </div>
          )}
        </div>
        {owed > 0 && (
          <div className="wk-meter">
            <div className="wk-meter-track">
              <div className={`wk-meter-fill wk-meter-${hero.tone}`} style={{ width: `${Math.min(coverage, 1) * 100}%` }} />
            </div>
            <div className="wk-meter-legend">
              <span>0 %</span>
              <span>Valeur en dollars des actifs cotés, hors WAKATI</span>
              <span>100 %</span>
            </div>
          </div>
        )}
      </div>

      {todo.length > 0 && (
        <div className="wk-todo">
          <h3 className="wk-todo-title">À faire</h3>
          <ul className="wk-todo-list">
            {todo.map((t, i) => (
              <li key={i} className="wk-todo-item">
                <span className={`wk-dot wk-dot-${t.tone}`} />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Crypto" hint="J'ai = treasury + fonds encore sur les adresses des utilisateurs.">
        <LinesTable lines={crypto} empty="Aucune crypto n'est due aux utilisateurs." />
      </Section>

      <Section title="Argent mobile" hint="J'ai = solde de ton compte marchand PawaPay, tous pays du même actif additionnés.">
        <LinesTable lines={mobile} empty="Aucun pays actif." />
      </Section>

      <Section title="WAKATI dans l'application" hint="Tout ce que ta plateforme suit en interne : le stock qu'elle garde et les soldes de tes utilisateurs. Les WAKATI sur la blockchain se voient dans le menu WAKATI.">
        <WakatiInAppBlock wk={wk} />
      </Section>
    </div>
  );
}

function StatusPill({ s }: { s: Status }) {
  if (s === "covered") return <Pill tone="ok">Couvert</Pill>;
  if (s === "minor") return <Pill tone="warn">Écart mineur</Pill>;
  if (s === "sweep") return <Pill tone="warn">À balayer</Pill>;
  if (s === "short") return <Pill tone="bad">Il manque</Pill>;
  return <Pill tone="bad">Erreur</Pill>;
}

const fmt = (l: Line, n: number) => (l.asset === "WAKATI" ? formatToken(n) : formatNumber(n));

function LinesTable({ lines, empty }: { lines: Line[]; empty: string }) {
  if (lines.length === 0) return <Empty text={empty} />;
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Actif</Th>
          <Th right>J'ai</Th>
          <Th right>Je dois</Th>
          <Th hideSm>Couverture</Th>
          <Th right>Écart</Th>
          <Th>Résultat</Th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const g = gap(l);
          const negative = g !== null && g < -EPS;
          const [name, sub] = l.label.split(" (");
          return (
            <tr key={l.label}>
              <Td>
                <div className="wk-asset">
                  {name} {sub && <span className="wk-asset-sub">{sub.replace(")", "")}</span>}
                </div>
                {l.details && l.details.length > 0 && (
                  <details className="wk-details">
                    <summary>Détail par pays</summary>
                    <div className="wk-details-body">
                      {l.details.map((d) => (
                        <div key={d.label}>
                          {d.label} : {fmt(l, d.value)}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Td>
              <Td right label="J'ai">
                {l.error ? <span className="wk-err">{l.error}</span> : l.have === null ? "—" : fmt(l, l.have)}
                {l.note && <div className="wk-note">{l.note}</div>}
              </Td>
              <Td right label="Je dois">{fmt(l, l.owe)}</Td>
              <Td hideSm>{l.have === null ? <span className="wk-usd">—</span> : <CoverageBar ratio={ratio(l)} tone={tone(l.status)} />}</Td>
              <Td right label="Écart">
                {g === null ? (
                  "—"
                ) : (
                  <>
                    <span className={negative ? "wk-neg" : "wk-pos"}>
                      {g >= 0 ? "+" : ""}
                      {fmt(l, g)}
                    </span>
                    {usd(l, g) && (
                      <div className="wk-usd">
                        {g >= 0 ? "+" : ""}
                        {usd(l, g)}
                      </div>
                    )}
                  </>
                )}
              </Td>
              <Td label="Résultat">
                <StatusPill s={l.status} />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

function WakatiInAppBlock({ wk }: { wk: Awaited<ReturnType<typeof loadWakatiInApp>> }) {
  if (wk.error) return <div className="wk-alert-bad">Lecture impossible : {wk.error}</div>;

  const platform = wk.stock ?? 0; // WAKATI gardés par la plateforme
  const users = wk.total; // WAKATI détenus par les utilisateurs = en circulation
  const grand = platform + users; // total dans l'appli
  if (grand === 0) return <Empty text="Aucun WAKATI dans l'application." />;

  const pctTotal = (n: number) => formatPct((n / grand) * 100, n > 0 && n / grand < 0.001 ? 3 : 1);
  const pctCirc = (n: number) => (users > 0 ? formatPct((n / users) * 100, 1) : "—");
  const val = (n: number) => (wk.price > 0 ? formatUsd(n * wk.price) : "—");

  const rows: { key: string; label: string; desc: string; value: number; color: string; sub?: boolean; strong?: boolean; inCirc?: boolean }[] = [
    { key: "stock", label: "Stock de la plateforme", desc: "WAKATI que la plateforme garde pour vendre, échanger et prêter. Ils ne sont pas encore chez les utilisateurs.", value: platform, color: SEG.reserve },
    { key: "users", label: "Détenus par les utilisateurs", desc: `Total des soldes de ${wk.holders} utilisateurs. C'est ce qui est en circulation.`, value: users, color: "transparent", strong: true, inCirc: true },
    { key: "available", label: "dont disponible", desc: "Libre : utilisable, échangeable ou retirable.", value: wk.available, color: SEG.available, sub: true, inCirc: true },
    { key: "staking", label: "dont en staking", desc: "Verrouillé dans le pool de staking.", value: wk.staking, color: SEG.staking, sub: true, inCirc: true },
    { key: "pending", label: "dont en attente", desc: "En cours de traitement.", value: wk.pending, color: SEG.pending, sub: true, inCirc: true }
  ];

  return (
    <>
      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Total dans l'appli</div>
          <div className="wk-strip-value">{formatCompactNumber(grand)}</div>
          <div className="wk-strip-sub">{wk.price > 0 ? `environ ${formatUsd(grand * wk.price)}` : "WAKATI"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Stock de la plateforme</div>
          <div className="wk-strip-value">{formatCompactNumber(platform)}</div>
          <div className="wk-strip-sub">{pctTotal(platform)} du total</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">En circulation</div>
          <div className="wk-strip-value">{formatToken(users)}</div>
          <div className="wk-strip-sub">chez {wk.holders} utilisateurs</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">En staking</div>
          <div className="wk-strip-value">{formatToken(wk.staking)}</div>
          <div className="wk-strip-sub">{pctCirc(wk.staking)} de la circulation</div>
        </div>
      </div>

      <div className="wk-panel" style={{ marginTop: 12 }}>
        <SegmentBar
          label="Répartition des WAKATI dans l'application"
          segments={[
            { key: "stock", label: "Stock de la plateforme", value: platform, color: SEG.reserve },
            { key: "available", label: "Disponible", value: wk.available, color: SEG.available },
            { key: "staking", label: "En staking", value: wk.staking, color: SEG.staking },
            { key: "pending", label: "En attente", value: wk.pending, color: SEG.pending }
          ]}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <TableWrap>
          <thead>
            <tr>
              <Th>Catégorie</Th>
              <Th right>Quantité</Th>
              <Th right>Part du total</Th>
              <Th right>Part de la circulation</Th>
              <Th right>Valeur</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td>
                  <div className="wk-legend-name" style={r.sub ? { paddingLeft: 20 } : r.strong ? { fontWeight: 600 } : undefined}>
                    {r.color !== "transparent" ? <Swatch color={r.color} /> : <span className="wk-swatch" style={{ background: "transparent" }} />}
                    {r.label}
                  </div>
                  <div className="wk-legend-desc" style={r.sub ? { marginLeft: 40 } : undefined}>{r.desc}</div>
                </Td>
                <Td right label="Quantité"><span style={r.strong ? { fontWeight: 600 } : undefined}>{formatToken(r.value)}</span></Td>
                <Td right label="Part du total">{pctTotal(r.value)}</Td>
                <Td right label="Part de la circulation">{r.inCirc ? pctCirc(r.value) : "—"}</Td>
                <Td right label="Valeur">{val(r.value)}</Td>
              </tr>
            ))}
            <tr style={{ background: "#fafbfc" }}>
              <Td><span className="wk-asset">Total dans l'appli</span></Td>
              <Td right label="Quantité"><strong style={{ color: "var(--ink)" }}>{formatToken(grand)}</strong></Td>
              <Td right label="Part du total">100 %</Td>
              <Td right label="Part de la circulation">—</Td>
              <Td right label="Valeur"><strong style={{ color: "var(--ink)" }}>{val(grand)}</strong></Td>
            </tr>
          </tbody>
        </TableWrap>
      </div>

      <div className="wk-callout" style={{ marginTop: 12 }}>
        <strong>À retenir.</strong> Sur {formatCompactNumber(grand)} WAKATI dans l'appli, {formatToken(users)} ({pctTotal(users)}) sont chez les utilisateurs. Seulement {formatToken(wk.available)} sont vraiment libres : le reste est verrouillé en staking. Valeurs calculées au prix interne.
      </div>

      <p style={{ margin: "12px 0 0", fontSize: 14 }}>
        <a className="wk-link" href="/dashboard/wakati">Voir la tokenomics complète (blockchain, prix, staking, détenteurs)</a>
      </p>
    </>
  );
}
