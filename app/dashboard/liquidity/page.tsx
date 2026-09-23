import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { loadOnchainCustody } from "@/lib/custody";
import { loadWakatiInApp } from "@/lib/wakati";
import { formatNumber, formatToken, formatUsd, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";
import { adjustLiquidity } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EPS = 0.00000001;

type Asset = {
  symbol: string;
  name: string;
  network: string;
  contract_address: string | null;
  decimals: number | null;
  can_be_swapped: boolean;
};

type Wallet = {
  asset_symbol: string;
  balance: number;
  total_collected: number;
  total_withdrawn: number;
  total_burned: number;
  updated_at: string;
};

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

interface Line {
  asset: string;
  name: string;
  network: string;
  canSwap: boolean;
  isFiat: boolean;
  ledger: number | null; // treasury_wallets.balance — ce que le swap vérifie réellement
  reference: number | null; // ce à quoi on compare la réserve pour juger si elle est "couverte"
  referenceLabel: string;
  referenceNote?: string;
  referenceError?: string;
  swapVolume: number;
  swapFees: number;
  priceUsd: number | null;
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

async function loadLines(): Promise<{ lines: Line[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [assetsRes, walletsRes, metricsRes, prices, wk] = await Promise.all([
    q<Asset>(db.from("supported_assets").select("symbol, name, network, contract_address, decimals, can_be_swapped").eq("is_active", true)),
    q<Wallet>(db.from("treasury_wallets").select("*")),
    q<Metrics>(db.from("supported_assets_metrics").select("asset_symbol, total_swap_volume, total_swap_fees_collected")),
    loadPrices(),
    loadWakatiInApp()
  ]);

  if (assetsRes.error) return { lines: [], error: assetsRes.error };

  const walletOf = new Map(walletsRes.rows.map((w) => [w.asset_symbol, w]));
  const metricsOf = new Map(metricsRes.rows.map((m) => [m.asset_symbol, m]));

  // On ne montre que les actifs swappables, ou ceux qui ont déjà une réserve (au cas où can_be_swapped a changé depuis).
  const assets = assetsRes.rows.filter((a) => a.can_be_swapped || walletOf.has(a.symbol));

  // Lecture on-chain groupée pour tous les actifs crypto non-WAKATI (WAKATI a sa propre logique de référence ci-dessous).
  const custody = await loadOnchainCustody(assets.filter((a) => a.symbol !== "WAKATI"));

  const lines: Line[] = assets.map((asset) => {
    const wallet = walletOf.get(asset.symbol);
    const metrics = metricsOf.get(asset.symbol);
    const ledger = wallet ? Number(wallet.balance) : null;
    const isFiat = asset.network === "Fiat";

    let reference: number | null = null;
    let referenceLabel = "On-chain (trésor + adresses utilisateurs)";
    let referenceNote: string | undefined;
    let referenceError: string | undefined;

    if (asset.symbol === "WAKATI") {
      // WAKATI est le jeton natif de la plateforme : le solde on-chain de l'adresse trésor n'a pas de sens à
      // comparer directement (elle détient l'essentiel de l'offre, minée ou non). La vraie question est :
      // la réserve interne suffit-elle à couvrir ce que les utilisateurs détiennent déjà dans l'appli ?
      reference = wk.error ? null : wk.total;
      referenceLabel = "Détenu par les utilisateurs (circulation)";
      referenceError = wk.error;
    } else if (isFiat) {
      referenceLabel = "— (fiat, pas de vérification on-chain)";
    } else {
      const c = custody.get(asset.symbol);
      reference = c?.total ?? null;
      referenceError = c?.error;
      if (c && c.users > EPS) referenceNote = `dont ${formatNumber(c.users)} encore sur des adresses utilisateurs non balayées`;
    }

    return {
      asset: asset.symbol,
      name: asset.name,
      network: asset.network,
      canSwap: asset.can_be_swapped,
      isFiat,
      ledger,
      reference,
      referenceLabel,
      referenceNote,
      referenceError,
      swapVolume: Number(metrics?.total_swap_volume || 0),
      swapFees: Number(metrics?.total_swap_fees_collected || 0),
      priceUsd: prices.get(asset.symbol) ?? null
    };
  });

  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  return { lines };
}

/**
 * Un écart n'est un problème QUE dans un sens : la réserve interne (ce que le swap promet) qui dépasse
 * ce qui est réellement détenu (on-chain, ou — pour WAKATI — ce que les utilisateurs détiennent déjà).
 * Réserve <= référence : toujours normal, quelle que soit l'ampleur de l'écart.
 */
function driftInfo(l: Line): { drift: number | null; tone: Tone } {
  if (l.ledger === null || l.reference === null) return { drift: null, tone: "info" };
  const drift = l.ledger - l.reference;
  const tolerance = Math.max(0.000001, l.reference * 0.005); // dust / latence de lecture
  if (drift <= tolerance) return { drift, tone: "ok" };
  return { drift, tone: "bad" };
}

function reserveTone(l: Line): Tone {
  if (l.canSwap && l.ledger === null) return "bad"; // réserve jamais initialisée : les swaps vers cet actif échoueront
  if (l.canSwap && (l.ledger ?? 0) <= EPS && l.swapVolume > 0) return "warn"; // réserve à sec malgré une activité passée
  return "ok";
}

function combinedTone(l: Line): Tone {
  const rt = reserveTone(l);
  if (rt !== "ok") return rt;
  return driftInfo(l).tone;
}

function fmt(l: Line, n: number): string {
  return l.asset === "WAKATI" ? formatToken(n) : formatNumber(n);
}

function usd(l: Line, n: number): string | null {
  return l.priceUsd ? formatUsd(n * l.priceUsd) : null;
}

function StatePill({ tone }: { tone: Tone }) {
  if (tone === "ok") return <Pill tone="ok">OK</Pill>;
  if (tone === "warn") return <Pill tone="warn">À surveiller</Pill>;
  if (tone === "info") return <Pill tone="info">Non vérifiable</Pill>;
  return <Pill tone="bad">Problème</Pill>;
}

export default async function LiquidityPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string; msg?: string };
}) {
  const db = getSupabaseAdmin();
  const [{ lines, error }, ledgerRes] = await Promise.all([
    loadLines(),
    q<LedgerRow>(
      db
        .from("treasury_ledger")
        .select("id, asset_symbol, entry_type, amount, balance_before, balance_after, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(30)
    )
  ]);

  const alerts = lines.filter((l) => {
    const rt = reserveTone(l);
    return rt !== "ok" || driftInfo(l).tone === "bad";
  });
  const swappableAssets = lines.filter((l) => l.canSwap);

  return (
    <div>
      <PageHeader
        title="Liquidité (swap)"
        subtitle="Réserve interne qui garantit chaque swap, comparée à ce qui la couvre réellement — et l'historique des mouvements."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={error ? `Certains actifs n'ont pas pu être lus : ${error}` : null} />
      {searchParams.saved && <div className="wk-alert-ok">Réserve {searchParams.saved} mise à jour.</div>}
      {searchParams.error && <div className="wk-alert-bad">Échec sur {searchParams.error} : {searchParams.msg || "voir le journal d'audit"}</div>}

      <div className="wk-callout" style={{ marginBottom: 4 }}>
        <strong>Comment ça marche.</strong> Il n'y a pas de pool par paire (type AMM) : chaque swap est honoré directement
        par une réserve unique par actif (<code>treasury_wallets</code>). Un écart n'est un problème que dans un sens :
        réserve interne <em>supérieure</em> à ce qui la couvre réellement (le trésor on-chain pour les cryptos, la
        circulation utilisateurs pour WAKATI). Dans l'autre sens, c'est normal — voire sain.
      </div>

      <Section title="À surveiller" hint="Réserves absentes, épuisées, ou qui promettent plus que ce qui les couvre réellement.">
        {alerts.length === 0 ? (
          <div className="wk-watch-item"><span className="wk-dot wk-dot-ok" /><span>Rien à signaler.</span></div>
        ) : (
          <div className="wk-watch">
            {alerts.map((l) => {
              const rt = reserveTone(l);
              const d = driftInfo(l);
              let text = "";
              let tone: "bad" | "warn" = "warn";
              if (rt === "bad") {
                text = `${l.asset} : réserve jamais initialisée — les swaps vers cet actif échoueront.`;
                tone = "bad";
              } else if (rt === "warn") {
                text = `${l.asset} : réserve à sec (${fmt(l, l.ledger ?? 0)}) malgré une activité de swap passée.`;
                tone = "warn";
              } else if (d.tone === "bad") {
                text = `${l.asset} : la réserve interne (${fmt(l, l.ledger ?? 0)}) dépasse ${l.referenceLabel.toLowerCase()} (${fmt(l, l.reference ?? 0)}).`;
                tone = "bad";
              }
              return (
                <div key={l.asset} className="wk-watch-item">
                  <span className={`wk-dot wk-dot-${tone}`} />
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Réserves par actif" hint="« Réserve » = ce que le swap vérifie. « Référence » = ce qui doit la couvrir (le trésor on-chain pour les cryptos, la circulation utilisateurs pour WAKATI).">
        <TableWrap>
          <thead>
            <tr>
              <Th>Actif</Th>
              <Th right>Réserve (swap)</Th>
              <Th right hideSm>Référence</Th>
              <Th right hideSm>Écart</Th>
              <Th right hideSm>Volume swap (total)</Th>
              <Th right hideSm>Frais swap (total)</Th>
              <Th>État</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const d = driftInfo(l);
              const tone = combinedTone(l);
              return (
                <tr key={l.asset}>
                  <Td>
                    <div className="wk-asset">{l.asset} {!l.canSwap && <span className="wk-asset-sub">(swap désactivé)</span>}</div>
                    <div className="wk-asset-sub">{l.name} · {l.network}</div>
                  </Td>
                  <Td right label="Réserve (swap)">
                    {l.ledger === null ? <span className="wk-err">non initialisée</span> : fmt(l, l.ledger)}
                    {l.ledger !== null && usd(l, l.ledger) && <div className="wk-usd">{usd(l, l.ledger)}</div>}
                  </Td>
                  <Td right label="Référence" hideSm>
                    {l.referenceError ? (
                      <span className="wk-err">{l.referenceError}</span>
                    ) : l.reference === null ? (
                      <span className="wk-asset-sub">{l.isFiat ? "— (fiat)" : "—"}</span>
                    ) : (
                      fmt(l, l.reference)
                    )}
                    {l.referenceNote && <div className="wk-note">{l.referenceNote}</div>}
                    <div className="wk-asset-sub">{l.referenceLabel}</div>
                  </Td>
                  <Td right label="Écart" hideSm>
                    {d.drift === null ? (
                      "—"
                    ) : (
                      <span className={d.drift > EPS ? "wk-neg" : "wk-pos"}>
                        {d.drift >= 0 ? "+" : ""}{fmt(l, d.drift)}
                      </span>
                    )}
                  </Td>
                  <Td right label="Volume swap (total)" hideSm>{fmt(l, l.swapVolume)}</Td>
                  <Td right label="Frais swap (total)" hideSm>{fmt(l, l.swapFees)}</Td>
                  <Td label="État">
                    <StatePill tone={tone} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Ajuster une réserve" hint="Reflète un mouvement réel (dépôt ou retrait sur le hot wallet) ou corrige une erreur de comptage. Journalisé dans l'historique ci-dessous et dans le journal d'audit.">
        <form action={adjustLiquidity} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="wk-label" htmlFor="asset_symbol">Actif</label>
            <select id="asset_symbol" name="asset_symbol" className="wk-input" style={{ width: 150 }} required defaultValue="">
              <option value="" disabled>Choisir…</option>
              {swappableAssets.map((l) => (
                <option key={l.asset} value={l.asset}>{l.asset} — réserve {l.ledger === null ? "0" : fmt(l, l.ledger)}</option>
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
            <label className="wk-label" htmlFor="reason">Motif (obligatoire)</label>
            <input id="reason" name="reason" type="text" className="wk-input" placeholder="Ex : dépôt de 0.5 BTC sur le hot wallet le 23/09" required minLength={5} />
          </div>
          <button type="submit" className="wk-btn">Valider</button>
        </form>
      </Section>

      <Section title="Historique des mouvements" hint="Les 30 derniers mouvements sur les réserves de trésorerie, tous actifs confondus.">
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
                  <Td label="Motif" hideSm>
                    <span className="wk-asset-sub">{r.reason || "—"}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
