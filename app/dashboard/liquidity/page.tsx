import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { loadOnchainCustody } from "@/lib/custody";
import { loadFiatCustody } from "@/lib/pawapay";
import { loadWakatiInApp } from "@/lib/wakati";
import { formatNumber, formatToken, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, CoverageBar, Empty, ErrorNote, Icon } from "@/components/ui";
import { adjustLiquidity } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EPS = 0.00000001;
const MINOR_USD = 1; // en dessous, un manque est signalé « mineur » plutôt que rouge

type Asset = {
  symbol: string;
  name: string;
  network: string;
  contract_address: string | null;
  decimals: number | null;
  can_be_swapped: boolean;
};

type Wallet = { asset_symbol: string; balance: number; updated_at: string };
type Metrics = { asset_symbol: string; total_swap_volume: number | null; total_swap_fees_collected: number | null };

type LedgerRow = {
  id: string;
  asset_symbol: string;
  entry_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
};

type Status = "covered" | "minor" | "short" | "absent" | "dry" | "error";

interface Line {
  asset: string;
  network: string;
  canSwap: boolean;
  compareLabel: string; // "trésor on-chain" / "PawaPay" / "circulation utilisateurs"
  have: number | null; // ce qui couvre réellement la réserve (WAKATI : c'est la réserve elle-même, voir plus bas)
  owe: number | null; // ce que la réserve doit couvrir
  note?: string;
  error?: string;
  status: Status;
  priceUsd: number | null;
  details?: { label: string; value: number }[]; // détail par pays (fiat)
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  fee_credit: "Frais crédités",
  burn: "Burn",
  admin_withdrawal: "Retrait admin",
  adjustment: "Ajustement / ajout admin",
  backfill: "Correction rétroactive",
  payout_debit: "Gain payé (jeu)",
  admin_reclaim: "Récupération admin",
  loan_disbursement: "Prêt versé",
  loan_repayment: "Remboursement de prêt",
  liquidation: "Liquidation"
};

function computeStatus(have: number | null, owe: number | null, ledger: number | null, canSwap: boolean, swapVolume: number): Status {
  if (canSwap && ledger === null) return "absent";
  if (canSwap && (ledger ?? 0) <= EPS && swapVolume > 0) return "dry";
  if (have === null || owe === null) return "error";
  if (owe <= EPS) return "covered";
  if (have < owe - EPS) return "short";
  return "covered";
}

async function loadLines(): Promise<{ lines: Line[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [assetsRes, walletsRes, metricsRes, prices, wk, fiatCustody] = await Promise.all([
    q<Asset>(db.from("supported_assets").select("symbol, name, network, contract_address, decimals, can_be_swapped").eq("is_active", true)),
    q<Wallet>(db.from("treasury_wallets").select("asset_symbol, balance, updated_at")),
    q<Metrics>(db.from("supported_assets_metrics").select("asset_symbol, total_swap_volume, total_swap_fees_collected")),
    loadPrices(),
    loadWakatiInApp(),
    loadFiatCustody()
  ]);

  if (assetsRes.error) return { lines: [], error: assetsRes.error };

  const walletOf = new Map(walletsRes.rows.map((w) => [w.asset_symbol, w]));
  const metricsOf = new Map(metricsRes.rows.map((m) => [m.asset_symbol, m]));
  const assets = assetsRes.rows.filter((a) => a.can_be_swapped || walletOf.has(a.symbol));

  const custody = await loadOnchainCustody(assets.filter((a) => a.network !== "Fiat" && a.symbol !== "WAKATI"));

  const lines: Line[] = assets.map((asset) => {
    const wallet = walletOf.get(asset.symbol);
    const ledger = wallet ? Number(wallet.balance) : null;
    const swapVolume = Number(metricsOf.get(asset.symbol)?.total_swap_volume || 0);
    const swapFees = Number(metricsOf.get(asset.symbol)?.total_swap_fees_collected || 0);
    const priceUsd = prices.get(asset.symbol) ?? null;

    let have: number | null;
    let owe: number | null;
    let compareLabel: string;
    let note: string | undefined;
    let error: string | undefined;
    let details: { label: string; value: number }[] | undefined;

    if (asset.symbol === "WAKATI") {
      // Jeton natif : la réserve (stock plateforme) DOIT être ≥ ce que les utilisateurs détiennent déjà.
      have = ledger; // la réserve joue le rôle de "J'ai"
      owe = wk.error ? null : wk.total; // la circulation joue le rôle de "Je dois"
      compareLabel = "circulation utilisateurs";
      error = wk.error;
    } else if (asset.network === "Fiat") {
      const fc = fiatCustody.get(asset.symbol);
      have = fc?.total ?? null; // PawaPay joue "J'ai"
      owe = ledger; // la réserve joue "Je dois"
      compareLabel = "PawaPay";
      error = fc?.error;
      details = fc?.details;
    } else {
      const c = custody.get(asset.symbol);
      have = c?.total ?? null; // trésor on-chain + adresses non balayées joue "J'ai"
      owe = ledger; // la réserve joue "Je dois"
      compareLabel = "trésor on-chain";
      error = c?.error;
      if (c && c.users > EPS) note = `dont ${formatNumber(c.users)} non balayés`;
    }

    const status = computeStatus(have, owe, ledger, asset.can_be_swapped, swapVolume);

    return {
      asset: asset.symbol,
      network: asset.network,
      canSwap: asset.can_be_swapped,
      compareLabel,
      have,
      owe,
      note,
      error,
      status,
      priceUsd,
      details,
      // conservés pour l'affichage des colonnes volume/frais
      // (non typés dans Line pour rester simple : accès direct via metricsOf au rendu si besoin)
    } as Line;
  });

  // reclassement "short" -> "minor" si l'écart pèse moins de MINOR_USD $
  const classified = lines.map((l) => {
    if (l.status !== "short" || l.have === null || l.owe === null || l.priceUsd === null) return l;
    const gapUsd = Math.abs((l.have - l.owe) * l.priceUsd);
    return gapUsd < MINOR_USD ? { ...l, status: "minor" as Status } : l;
  });

  classified.sort((a, b) => a.asset.localeCompare(b.asset));
  return { lines: classified };
}

function gap(l: Line): number | null {
  return l.have === null || l.owe === null ? null : l.have - l.owe;
}
function ratio(l: Line): number {
  if (l.have === null || l.owe === null) return 0;
  return l.owe > EPS ? l.have / l.owe : 1;
}
function usd(l: Line, amount: number): string {
  return l.priceUsd !== null ? formatUsd(amount * l.priceUsd) : "";
}
function tone(s: Status): "ok" | "warn" | "bad" | "info" {
  if (s === "covered") return "ok";
  if (s === "minor" || s === "dry") return "warn";
  return "bad"; // short, absent, error
}
function fmt(l: Line, n: number): string {
  return l.asset === "WAKATI" ? formatToken(n) : formatNumber(n);
}

function StatusPill({ s }: { s: Status }) {
  if (s === "covered") return <Pill tone="ok">Couvert</Pill>;
  if (s === "minor") return <Pill tone="warn">Écart mineur</Pill>;
  if (s === "dry") return <Pill tone="warn">À sec</Pill>;
  if (s === "absent") return <Pill tone="bad">Réserve absente</Pill>;
  if (s === "short") return <Pill tone="bad">Il manque</Pill>;
  return <Pill tone="bad">Erreur</Pill>;
}

export default async function LiquidityPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string; msg?: string };
}) {
  const db = getSupabaseAdmin();
  const [{ lines, error: loadError }, ledgerRes] = await Promise.all([
    loadLines(),
    q<LedgerRow>(
      db
        .from("treasury_ledger")
        .select("id, asset_symbol, entry_type, amount, balance_before, balance_after, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(30)
    )
  ]);

  const short = lines.filter((l) => l.status === "short");
  const minor = lines.filter((l) => l.status === "minor");
  const absent = lines.filter((l) => l.status === "absent");
  const dry = lines.filter((l) => l.status === "dry");
  const errored = lines.filter((l) => l.status === "error");
  const swappableAssets = lines.filter((l) => l.canSwap);

  let heldUsd = 0;
  let owedUsd = 0;
  let coveredUsd = 0;
  for (const l of lines) {
    if (l.have === null || l.owe === null || l.priceUsd === null) continue;
    heldUsd += l.have * l.priceUsd;
    owedUsd += l.owe * l.priceUsd;
    coveredUsd += Math.min(l.have, l.owe) * l.priceUsd;
  }
  const coverage = owedUsd > 0 ? coveredUsd / owedUsd : 1;
  const missingUsd = short.reduce((n, l) => n + (l.priceUsd !== null ? -(gap(l) ?? 0) * l.priceUsd : 0), 0);

  const todo: { tone: "bad" | "warn"; text: string }[] = [];
  for (const l of absent) todo.push({ tone: "bad", text: `${l.asset} : réserve de swap jamais initialisée — les swaps vers cet actif échoueront.` });
  for (const l of short) todo.push({ tone: "bad", text: `Il manque ${formatNumber(-(gap(l) ?? 0))} ${l.asset}${usd(l, -(gap(l) ?? 0)) ? ` (~${usd(l, -(gap(l) ?? 0))})` : ""} vs ${l.compareLabel}.` });
  for (const l of dry) todo.push({ tone: "warn", text: `${l.asset} : réserve à sec malgré une activité de swap passée.` });
  for (const l of minor) todo.push({ tone: "warn", text: `${l.asset} : écart mineur (< ${formatUsd(MINOR_USD)}) vs ${l.compareLabel}.` });
  for (const l of errored) todo.push({ tone: "bad", text: `${l.asset} : lecture impossible (${l.error || "erreur inconnue"}).` });

  const hero =
    loadError
      ? { tone: "bad" as const, icon: "x" as const, title: "Le calcul n'a pas pu être fait", text: loadError }
      : short.length > 0 || absent.length > 0
        ? { tone: "bad" as const, icon: "alert" as const, title: missingUsd > 0 ? `Il manque environ ${formatUsd(missingUsd)} pour couvrir les réserves de swap` : "Certaines réserves de swap posent problème", text: "Voir « À faire » ci-dessous." }
        : errored.length > 0
          ? { tone: "warn" as const, icon: "alert" as const, title: "Certaines lectures ont échoué", text: "Le reste est couvert." }
          : { tone: "ok" as const, icon: "check" as const, title: "Toutes les réserves de swap sont couvertes", text: minor.length > 0 || dry.length > 0 ? `À surveiller : ${[...minor, ...dry].map((l) => l.asset).join(", ")}.` : "" };

  return (
    <div>
      <PageHeader title="Liquidité (swap)" subtitle="Ce qui garantit chaque swap, comparé à ce qui la couvre réellement." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={searchParams.error ? `Échec sur ${searchParams.error} : ${searchParams.msg || ""}` : null} />
      {searchParams.saved && <div className="wk-alert-ok">Réserve {searchParams.saved} mise à jour.</div>}

      <div className={`wk-hero wk-hero-${hero.tone}`}>
        <div className="wk-hero-top">
          <div className="wk-hero-msg">
            <span className={`wk-hero-icon wk-hero-icon-${hero.tone}`}>
              <Icon name={hero.icon} size={26} />
            </span>
            <div>
              <h2 className="wk-hero-title">{hero.title}</h2>
              {hero.text && <p className="wk-hero-text">{hero.text}</p>}
            </div>
          </div>
          {owedUsd > 0 && (
            <div className="wk-figures">
              <div className="wk-figure">
                <div className="wk-figure-label">J'ai</div>
                <div className="wk-figure-value">{formatUsd(heldUsd)}</div>
              </div>
              <div className="wk-figure">
                <div className="wk-figure-label">Je dois</div>
                <div className="wk-figure-value">{formatUsd(owedUsd)}</div>
              </div>
              <div className="wk-figure">
                <div className="wk-figure-label">Couvert</div>
                <div className="wk-figure-value">{formatPct(coverage * 100)}</div>
              </div>
            </div>
          )}
        </div>
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

      <Section title="Réserves par actif">
        {lines.length === 0 ? (
          <Empty text="Aucun actif swappable." />
        ) : (
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
                return (
                  <tr key={l.asset}>
                    <Td>
                      <div className="wk-asset">{l.asset}</div>
                      <div className="wk-asset-sub">{l.network} · vs {l.compareLabel}</div>
                      {l.details && l.details.length > 0 && (
                        <details className="wk-details">
                          <summary>Détail par pays</summary>
                          <div className="wk-details-body">
                            {l.details.map((d) => (
                              <div key={d.label}>{d.label} : {fmt(l, d.value)}</div>
                            ))}
                          </div>
                        </details>
                      )}
                    </Td>
                    <Td right label="J'ai">
                      {l.error ? <span className="wk-err">{l.error}</span> : l.have === null ? "—" : fmt(l, l.have)}
                      {l.note && <div className="wk-note">{l.note}</div>}
                    </Td>
                    <Td right label="Je dois">{l.owe === null ? "—" : fmt(l, l.owe)}</Td>
                    <Td hideSm>{l.have === null || l.owe === null ? <span className="wk-usd">—</span> : <CoverageBar ratio={ratio(l)} tone={tone(l.status)} />}</Td>
                    <Td right label="Écart">
                      {g === null ? (
                        "—"
                      ) : (
                        <>
                          <span className={g < -EPS ? "wk-neg" : "wk-pos"}>{g >= 0 ? "+" : ""}{fmt(l, g)}</span>
                          {usd(l, g) && <div className="wk-usd">{g >= 0 ? "+" : ""}{usd(l, g)}</div>}
                        </>
                      )}
                    </Td>
                    <Td label="Résultat"><StatusPill s={l.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Ajuster une réserve" hint="Motif obligatoire. Journalisé dans l'historique et le journal d'audit.">
        <form action={adjustLiquidity} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="wk-label" htmlFor="asset_symbol">Actif</label>
            <select id="asset_symbol" name="asset_symbol" className="wk-input" style={{ width: 150 }} required defaultValue="">
              <option value="" disabled>Choisir…</option>
              {swappableAssets.map((l) => (
                <option key={l.asset} value={l.asset}>{l.asset}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="wk-label" htmlFor="direction">Sens</label>
            <select id="direction" name="direction" className="wk-input" style={{ width: 130 }} defaultValue="add">
              <option value="add">Ajouter</option>
              <option value="remove">Retirer</option>
            </select>
          </div>
          <div>
            <label className="wk-label" htmlFor="amount">Montant</label>
            <input id="amount" name="amount" type="number" step="any" min="0" className="wk-input" style={{ width: 160 }} required />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <label className="wk-label" htmlFor="reason">Motif</label>
            <input id="reason" name="reason" type="text" className="wk-input" placeholder="Ex : dépôt de 0.5 BTC sur le hot wallet" required minLength={5} />
          </div>
          <button type="submit" className="wk-btn">Valider</button>
        </form>
      </Section>

      <Section title="Historique">
        {ledgerRes.error ? (
          <ErrorNote text={`Historique illisible : ${ledgerRes.error}`} />
        ) : ledgerRes.rows.length === 0 ? (
          <Empty text="Aucun mouvement enregistré." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Actif</Th>
                <Th>Type</Th>
                <Th right>Montant</Th>
                <Th right hideSm>Avant → après</Th>
                <Th hideSm>Motif</Th>
              </tr>
            </thead>
            <tbody>
              {ledgerRes.rows.map((r) => (
                <tr key={r.id}>
                  <Td label="Date">{formatDateTime(new Date(r.created_at))}</Td>
                  <Td label="Actif">{r.asset_symbol}</Td>
                  <Td label="Type">{ENTRY_TYPE_LABELS[r.entry_type] || r.entry_type}</Td>
                  <Td right label="Montant">{formatNumber(Number(r.amount))}</Td>
                  <Td right label="Avant → après" hideSm>
                    <span className="wk-asset-sub">{formatNumber(Number(r.balance_before))} → {formatNumber(Number(r.balance_after))}</span>
                  </Td>
                  <Td label="Motif" hideSm><span className="wk-asset-sub">{r.reason || "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
