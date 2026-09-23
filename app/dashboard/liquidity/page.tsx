import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { getNativeBalance, getTokenBalance, getBtcBalance } from "@/lib/chain";
import { formatNumber, formatToken, formatUsd, formatDateTime } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";
import { adjustLiquidity } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";
const EPS = 0.00000001;
// Écart toléré entre le solde interne (utilisé pour gater les swaps) et le solde réel on-chain,
// avant qu'on considère ça comme un signal à vérifier plutôt qu'un simple arrondi.
const DRIFT_ALERT_RATIO = 0.02; // 2 %

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
  ledger: number | null; // treasury_wallets.balance — ce que le swap vérifie réellement
  onchain: number | null; // solde réel sur l'adresse trésor
  onchainError?: string;
  isFiat: boolean;
  swapVolume: number;
  swapFees: number;
  priceUsd: number | null;
  updatedAt: string | null;
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

async function loadOnchain(asset: Asset): Promise<{ value: number | null; error?: string }> {
  if (asset.network === "Fiat") return { value: null };
  try {
    if (asset.symbol === "BTC") {
      if (!TREASURY_BTC_ADDRESS) return { value: null, error: "TREASURY_BTC_ADDRESS non configurée" };
      return { value: await getBtcBalance(TREASURY_BTC_ADDRESS) };
    }
    if (!TREASURY_EVM_ADDRESS) return { value: null, error: "TREASURY_EVM_ADDRESS non configurée" };
    const network = asset.network.toLowerCase();
    const value = asset.contract_address
      ? await getTokenBalance(network, asset.contract_address, TREASURY_EVM_ADDRESS, asset.decimals || 18)
      : await getNativeBalance(network, TREASURY_EVM_ADDRESS);
    return { value };
  } catch (e: any) {
    return { value: null, error: e?.message || "Erreur de lecture on-chain" };
  }
}

async function loadLines(): Promise<{ lines: Line[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [assetsRes, walletsRes, metricsRes, prices] = await Promise.all([
    q<Asset>(db.from("supported_assets").select("symbol, name, network, contract_address, decimals, can_be_swapped").eq("is_active", true)),
    q<Wallet>(db.from("treasury_wallets").select("*")),
    q<Metrics>(db.from("supported_assets_metrics").select("asset_symbol, total_swap_volume, total_swap_fees_collected")),
    loadPrices()
  ]);

  if (assetsRes.error) return { lines: [], error: assetsRes.error };

  const walletOf = new Map(walletsRes.rows.map((w) => [w.asset_symbol, w]));
  const metricsOf = new Map(metricsRes.rows.map((m) => [m.asset_symbol, m]));

  // On ne montre que les actifs swappables, ou ceux qui ont déjà une réserve (au cas où can_be_swapped a changé depuis).
  const assets = assetsRes.rows.filter((a) => a.can_be_swapped || walletOf.has(a.symbol));

  const lines = await Promise.all(
    assets.map(async (asset): Promise<Line> => {
      const wallet = walletOf.get(asset.symbol);
      const { value: onchain, error: onchainError } = await loadOnchain(asset);
      const metrics = metricsOf.get(asset.symbol);

      return {
        asset: asset.symbol,
        name: asset.name,
        network: asset.network,
        canSwap: asset.can_be_swapped,
        ledger: wallet ? Number(wallet.balance) : null,
        onchain,
        onchainError,
        isFiat: asset.network === "Fiat",
        swapVolume: Number(metrics?.total_swap_volume || 0),
        swapFees: Number(metrics?.total_swap_fees_collected || 0),
        priceUsd: prices.get(asset.symbol) ?? null,
        updatedAt: wallet?.updated_at ?? null
      };
    })
  );

  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  return { lines };
}

function driftInfo(l: Line): { drift: number | null; tone: Tone } {
  if (l.ledger === null || l.onchain === null) return { drift: null, tone: "info" };
  const drift = l.ledger - l.onchain;
  const base = Math.max(l.onchain, l.ledger, EPS);
  if (Math.abs(drift) / base <= DRIFT_ALERT_RATIO) return { drift, tone: "ok" };
  // La réserve interne promet plus que ce que le trésor détient réellement : risque pour les swaps.
  return { drift, tone: drift > 0 ? "bad" : "warn" };
}

function reserveTone(l: Line): Tone {
  if (l.canSwap && l.ledger === null) return "bad"; // réserve jamais initialisée : les swaps vers cet actif échoueront
  if (l.canSwap && (l.ledger ?? 0) <= EPS && l.swapVolume > 0) return "warn"; // réserve à sec malgré une activité passée
  return "ok";
}

function fmt(l: Line, n: number): string {
  return l.asset === "WAKATI" ? formatToken(n) : formatNumber(n);
}

function usd(l: Line, n: number): string | null {
  return l.priceUsd ? formatUsd(n * l.priceUsd) : null;
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

  const alerts = lines.filter((l) => reserveTone(l) !== "ok" || driftInfo(l).tone === "bad");
  const swappableAssets = lines.filter((l) => l.canSwap);

  return (
    <div>
      <PageHeader
        title="Liquidité (swap)"
        subtitle="Réserve interne qui garantit chaque swap, comparée au trésor réel — et l'historique des mouvements."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={error ? `Certains actifs n'ont pas pu être lus : ${error}` : null} />
      {searchParams.saved && <div className="wk-alert-ok">Réserve {searchParams.saved} mise à jour.</div>}
      {searchParams.error && <div className="wk-alert-bad">Échec sur {searchParams.error} : {searchParams.msg || "voir le journal d'audit"}</div>}

      <div className="wk-callout" style={{ marginBottom: 4 }}>
        <strong>Comment ça marche.</strong> Il n'y a pas de pool par paire (type AMM) : chaque swap est honoré directement
        par une réserve unique par actif (<code>treasury_wallets</code>). Si cette réserve n'a pas assez de l'actif demandé,
        le swap échoue pour l'utilisateur — c'est cette réserve qu'on surveille et ajuste ici.
      </div>

      <Section title="À surveiller" hint="Réserves absentes, épuisées, ou qui promettent plus que ce que le trésor détient réellement.">
        {alerts.length === 0 ? (
          <div className="wk-watch-item"><span className="wk-dot wk-dot-ok" /><span>Rien à signaler.</span></div>
        ) : (
          <div className="wk-watch">
            {alerts.map((l) => {
              const rt = reserveTone(l);
              const d = driftInfo(l);
              let text = "";
              if (rt === "bad") text = `${l.asset} : réserve jamais initialisée — les swaps vers cet actif échoueront.`;
              else if (rt === "warn") text = `${l.asset} : réserve à sec (${fmt(l, l.ledger ?? 0)}) malgré une activité de swap passée.`;
              else if (d.tone === "bad") text = `${l.asset} : la réserve interne (${fmt(l, l.ledger ?? 0)}) dépasse le solde on-chain réel (${fmt(l, l.onchain ?? 0)}) de plus de ${(DRIFT_ALERT_RATIO * 100).toFixed(0)} % — à vérifier.`;
              return (
                <div key={l.asset} className="wk-watch-item">
                  <span className={`wk-dot wk-dot-${rt === "bad" || d.tone === "bad" ? "bad" : "warn"}`} />
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Réserves par actif" hint="« Réserve » = ce que le swap vérifie. « On-chain » = ce que le trésor détient vraiment sur son adresse publique.">
        <TableWrap>
          <thead>
            <tr>
              <Th>Actif</Th>
              <Th right>Réserve (swap)</Th>
              <Th right hideSm>On-chain (trésor)</Th>
              <Th right hideSm>Écart</Th>
              <Th right hideSm>Volume swap (total)</Th>
              <Th right hideSm>Frais swap (total)</Th>
              <Th>État</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const d = driftInfo(l);
              const rt = reserveTone(l);
              const tone: Tone = rt !== "ok" ? rt : d.tone;
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
                  <Td right label="On-chain (trésor)" hideSm>
                    {l.isFiat ? <span className="wk-asset-sub">— (fiat)</span> : l.onchainError ? <span className="wk-err">{l.onchainError}</span> : l.onchain === null ? "—" : fmt(l, l.onchain)}
                  </Td>
                  <Td right label="Écart" hideSm>
                    {d.drift === null ? "—" : (
                      <span className={d.drift > EPS ? "wk-pos" : d.drift < -EPS ? "wk-neg" : undefined}>
                        {d.drift >= 0 ? "+" : ""}{fmt(l, d.drift)}
                      </span>
                    )}
                  </Td>
                  <Td right label="Volume swap (total)" hideSm>{fmt(l, l.swapVolume)}</Td>
                  <Td right label="Frais swap (total)" hideSm>{fmt(l, l.swapFees)}</Td>
                  <Td label="État">
                    {tone === "ok" ? <Pill tone="ok">OK</Pill> : tone === "warn" ? <Pill tone="warn">À surveiller</Pill> : <Pill tone="bad">Problème</Pill>}
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
