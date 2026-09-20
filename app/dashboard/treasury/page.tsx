import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import {
  getNativeBalance,
  getTokenBalance,
  getBtcBalance,
  getNativeBalances,
  getTokenBalances,
  getBtcBalances
} from "@/lib/chain";
import { formatNumber, formatUsd } from "@/lib/format";
import { PageTitle, SectionTitle, TableShell, Th, Td, Badge, EmptyState, ErrorBox, Alert } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

// Tokens gérés en interne : pas de réserve on-chain suivie ici
const INTERNAL_ONLY_ASSETS = new Set(["WAKATI"]);

type Liab = { total: number; count: number };

interface CryptoRow {
  asset: string;
  network: string;
  onChain: number | null; // adresse du treasury
  unswept: number | null; // adresses de dépôt des utilisateurs (pas encore balayé)
  unsweptCount: number;
  unsweptFailed: number;
  liability: number;
  userCount: number;
  priceUsd: number | null;
  depositsPaused: boolean;
  error?: string;
}

interface InternalRow {
  asset: string;
  liability: number;
  userCount: number;
  priceUsd: number | null;
}

interface FiatRow {
  asset: string;
  currency: string;
  country: string;
  pawapayBalance: number | null;
  liability: number;
  userCount: number;
  error?: string;
}

interface FeeRow {
  asset: string;
  count: number;
  total: number;
  priceUsd: number | null;
}

async function loadLiabilities(): Promise<Map<string, Liab>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_asset_liabilities");
  if (error) throw new Error(`Erreur chargement passif: ${error.message}`);
  const map = new Map<string, Liab>();
  for (const l of (data as any[]) || []) {
    map.set(l.asset_symbol, { total: Number(l.total_liability), count: Number(l.user_count) });
  }
  return map;
}

async function loadCryptoAndInternal(
  liabilityMap: Map<string, Liab>,
  prices: Map<string, number>
): Promise<{ crypto: CryptoRow[]; internal: InternalRow[] }> {
  const supabase = getSupabaseAdmin();

  const [{ data: assets, error: assetsError }, { data: userAddrs, error: addrError }] = await Promise.all([
    supabase
      .from("supported_assets")
      .select("symbol, network, contract_address, decimals, can_be_deposited")
      .neq("network", "Fiat")
      .eq("is_active", true),
    supabase.from("user_addresses").select("asset_symbol, address").eq("is_active", true)
  ]);
  if (assetsError) throw new Error(`Erreur chargement actifs: ${assetsError.message}`);
  if (addrError) throw new Error(`Erreur chargement adresses utilisateurs: ${addrError.message}`);

  const treasuryLower = new Set([TREASURY_EVM_ADDRESS, TREASURY_BTC_ADDRESS].filter(Boolean).map((a) => a.toLowerCase()));
  const addrMap = new Map<string, string[]>();
  for (const a of userAddrs || []) {
    if (!a.address || treasuryLower.has(String(a.address).toLowerCase())) continue;
    const list = addrMap.get(a.asset_symbol) || [];
    if (!list.includes(a.address)) list.push(a.address);
    addrMap.set(a.asset_symbol, list);
  }

  const internal: InternalRow[] = [];
  const cryptoAssets: NonNullable<typeof assets> = [];
  for (const asset of assets || []) {
    const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };
    if (INTERNAL_ONLY_ASSETS.has(asset.symbol)) {
      internal.push({ asset: asset.symbol, liability: liability.total, userCount: liability.count, priceUsd: prices.get(asset.symbol) ?? null });
    } else if (!(liability.total === 0 && liability.count === 0)) {
      cryptoAssets.push(asset);
    }
  }

  const crypto = await Promise.all(
    cryptoAssets.map(async (asset): Promise<CryptoRow> => {
      const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };
      const addresses = addrMap.get(asset.symbol) || [];
      const network = asset.network.toLowerCase();
      const decimals = asset.decimals || 18;

      let onChain: number | null = null;
      let error: string | undefined;
      let unswept: number | null = null;
      let unsweptFailed = 0;
      let unsweptCount = 0;

      const treasuryTask = (async () => {
        try {
          if (asset.symbol === "BTC") {
            if (!TREASURY_BTC_ADDRESS) throw new Error("TREASURY_BTC_ADDRESS non configurée");
            onChain = await getBtcBalance(TREASURY_BTC_ADDRESS);
          } else if (asset.contract_address) {
            if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
            onChain = await getTokenBalance(network, asset.contract_address, TREASURY_EVM_ADDRESS, decimals);
          } else {
            if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
            onChain = await getNativeBalance(network, TREASURY_EVM_ADDRESS);
          }
        } catch (e: any) {
          error = e?.message || "Erreur inconnue";
        }
      })();

      const usersTask = (async () => {
        try {
          const r =
            asset.symbol === "BTC"
              ? await getBtcBalances(addresses)
              : asset.contract_address
                ? await getTokenBalances(network, asset.contract_address, addresses, decimals)
                : await getNativeBalances(network, addresses);
          unswept = r.total;
          unsweptFailed = r.failed;
          unsweptCount = r.checked;
        } catch {
          unswept = null;
          unsweptFailed = addresses.length;
        }
      })();

      await Promise.all([treasuryTask, usersTask]);

      return {
        asset: asset.symbol,
        network: asset.network,
        onChain,
        unswept,
        unsweptCount,
        unsweptFailed,
        liability: liability.total,
        userCount: liability.count,
        priceUsd: prices.get(asset.symbol) ?? null,
        depositsPaused: asset.can_be_deposited === false,
        error
      };
    })
  );

  crypto.sort((a, b) => a.asset.localeCompare(b.asset));
  internal.sort((a, b) => a.asset.localeCompare(b.asset));
  return { crypto, internal };
}

async function fetchPawapayBalances(): Promise<Map<string, number> | { error: string }> {
  const secret = process.env.DASHBOARD_API_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!secret || !supabaseUrl) return { error: "DASHBOARD_API_SECRET ou SUPABASE_URL manquant" };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/dashboard-pawapay-balance`, {
      headers: { "x-dashboard-secret": secret },
      cache: "no-store"
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error || `PawaPay balance endpoint a répondu ${res.status}` };
    }
    const data = await res.json();
    const map = new Map<string, number>();
    for (const b of data.balances || []) map.set(b.country, Number(b.balance));
    return map;
  } catch (e: any) {
    return { error: e?.message || "Erreur réseau vers dashboard-pawapay-balance" };
  }
}

async function loadFiat(liabilityMap: Map<string, Liab>): Promise<FiatRow[]> {
  const { data: countries, error } = await getSupabaseAdmin()
    .from("payment_countries")
    .select("iso_code, currency_code, wallet_asset_symbol")
    .eq("is_active", true);
  if (error) throw new Error(`Erreur chargement pays: ${error.message}`);

  const pawapay = await fetchPawapayBalances();
  const globalError = "error" in pawapay ? pawapay.error : undefined;
  const balances = "error" in pawapay ? new Map<string, number>() : pawapay;

  return (countries || []).map((c) => {
    const liab = liabilityMap.get(c.wallet_asset_symbol);
    return {
      asset: c.wallet_asset_symbol,
      currency: c.currency_code,
      country: c.iso_code,
      pawapayBalance: balances.get(c.iso_code) ?? null,
      liability: liab?.total || 0,
      userCount: liab?.count || 0,
      error: globalError
    };
  });
}

async function loadFees(prices: Map<string, number>): Promise<{ rows: FeeRow[]; error?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("get_platform_fees_totals");
  if (error) return { rows: [], error: error.message };
  const rows: FeeRow[] = ((data as any[]) || []).map((f) => ({
    asset: f.asset_symbol,
    count: Number(f.fee_count),
    total: Number(f.total_fees),
    priceUsd: prices.get(f.asset_symbol) ?? null
  }));
  rows.sort((a, b) => b.total * (b.priceUsd ?? 0) - a.total * (a.priceUsd ?? 0));
  return { rows };
}

export default async function TreasuryPage() {
  let crypto: CryptoRow[] = [];
  let internal: InternalRow[] = [];
  let fiat: FiatRow[] = [];
  let loadError: string | null = null;

  const prices = await loadPrices();
  const feesPromise = loadFees(prices);

  try {
    const liabilityMap = await loadLiabilities();
    const [{ crypto: c, internal: i }, f] = await Promise.all([loadCryptoAndInternal(liabilityMap, prices), loadFiat(liabilityMap)]);
    crypto = c;
    internal = i;
    fiat = f;
  } catch (e: any) {
    loadError = e?.message || "Erreur de chargement";
  }
  const fees = await feesPromise;

  return (
    <div>
      <PageTitle
        title="Treasury & Solvabilité"
        subtitle="Compare les fonds réels (on-chain ou chez PawaPay) à ce qui est dû aux utilisateurs. Données rafraîchies à chaque chargement de page."
      />
      <ErrorBox text={loadError || undefined} />

      {(!TREASURY_EVM_ADDRESS || !TREASURY_BTC_ADDRESS) && (
        <Alert tone="warn">⚠️ TREASURY_EVM_ADDRESS et/ou TREASURY_BTC_ADDRESS ne sont pas configurées.</Alert>
      )}

      <SectionTitle hint="Total on-chain = adresse du treasury + adresses de dépôt des utilisateurs (fonds pas encore balayés).">
        Crypto (on-chain)
      </SectionTitle>
      <CryptoTable rows={crypto} />

      <SectionTitle>Fiat (via PawaPay)</SectionTitle>
      <FiatTable rows={fiat} />

      <SectionTitle hint="Aucune réserve on-chain suivie ici pour ces tokens.">Tokens internes</SectionTitle>
      <InternalTable rows={internal} />

      <SectionTitle hint="Total des frais collectés depuis le début. Les frais de test et les pertes nettes de jeu sont exclus.">
        Frais de la plateforme
      </SectionTitle>
      <ErrorBox text={fees.error} />
      <FeesTable rows={fees.rows} />

      <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "1.5rem" }}>
        <strong>Déficit</strong> : même en additionnant tout, il y a moins on-chain que ce qui est dû — à traiter en priorité.{" "}
        <strong>À balayer</strong> : le total couvre le dû, mais une partie des fonds est encore sur les adresses des utilisateurs.
        Un total supérieur au passif est normal (marge, frais non encore retirés).
      </p>
    </div>
  );
}

function CryptoTable({ rows }: { rows: CryptoRow[] }) {
  if (rows.length === 0) return <EmptyState text="Aucun actif crypto avec un passif." />;
  const EPS = 0.00000001;
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th>Réseau</Th>
          <Th align="right">Treasury</Th>
          <Th align="right">Adresses utilisateurs</Th>
          <Th align="right">Total on-chain</Th>
          <Th align="right">Dû aux utilisateurs</Th>
          <Th align="right">Écart</Th>
          <Th align="right">Écart (USD)</Th>
          <Th align="right">Utilisateurs</Th>
          <Th>Statut</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const total = row.onChain !== null ? row.onChain + (row.unswept ?? 0) : null;
          const diff = total !== null ? total - row.liability : null;
          const treasuryDiff = row.onChain !== null ? row.onChain - row.liability : null;
          const isShortfall = diff !== null && diff < -EPS;
          const toSweep = !isShortfall && treasuryDiff !== null && treasuryDiff < -EPS;
          const partial = row.unswept === null || row.unsweptFailed > 0;
          const color = isShortfall ? "#f87171" : "#4ade80";

          return (
            <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
              <Td>
                <strong style={{ color: "#f8fafc" }}>{row.asset}</strong>
                {row.depositsPaused && (
                  <div>
                    <Badge tone="warn">dépôts suspendus</Badge>
                  </div>
                )}
              </Td>
              <Td>{row.network}</Td>
              <Td align="right">
                {row.error ? <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{row.error}</span> : formatNumber(row.onChain ?? 0)}
              </Td>
              <Td align="right">
                {row.unswept === null ? (
                  <span style={{ color: "#f87171", fontSize: "0.8rem" }}>Lecture impossible</span>
                ) : (
                  <>
                    {formatNumber(row.unswept)}
                    <div style={{ color: "#64748b", fontSize: "0.7rem" }}>
                      {row.unsweptCount} adresse{row.unsweptCount > 1 ? "s" : ""}
                      {row.unsweptFailed > 0 ? ` · ${row.unsweptFailed} illisible${row.unsweptFailed > 1 ? "s" : ""}` : ""}
                    </div>
                  </>
                )}
              </Td>
              <Td align="right">{total !== null ? formatNumber(total) : "—"}</Td>
              <Td align="right">{formatNumber(row.liability)}</Td>
              <Td align="right">
                {diff !== null ? (
                  <span style={{ color }}>
                    {diff >= 0 ? "+" : ""}
                    {formatNumber(diff)}
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td align="right">
                {diff !== null && row.priceUsd !== null ? (
                  <span style={{ color }}>
                    {diff >= 0 ? "+" : ""}
                    {formatUsd(diff * row.priceUsd)}
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td align="right">{row.userCount}</Td>
              <Td>
                {row.error ? (
                  <Badge tone="bad">Erreur</Badge>
                ) : isShortfall ? (
                  <Badge tone="bad">⚠ Déficit</Badge>
                ) : toSweep ? (
                  <Badge tone="warn">À balayer</Badge>
                ) : (
                  <Badge tone="ok">OK</Badge>
                )}
                {partial && !row.error && <div style={{ color: "#fbbf24", fontSize: "0.7rem", marginTop: "0.25rem" }}>lecture partielle</div>}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function FiatTable({ rows }: { rows: FiatRow[] }) {
  if (rows.length === 0) return <EmptyState text="Aucun pays fiat actif." />;
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Pays</Th>
          <Th>Devise</Th>
          <Th>Actif wallet</Th>
          <Th align="right">Solde chez PawaPay</Th>
          <Th align="right">Dû aux utilisateurs (actif global)</Th>
          <Th>Statut</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.country} style={{ borderTop: "1px solid #334155" }}>
            <Td><strong style={{ color: "#f8fafc" }}>{row.country}</strong></Td>
            <Td>{row.currency}</Td>
            <Td>{row.asset}</Td>
            <Td align="right">
              {row.error ? (
                <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{row.error}</span>
              ) : row.pawapayBalance !== null ? (
                formatNumber(row.pawapayBalance)
              ) : (
                "—"
              )}
            </Td>
            <Td align="right">{formatNumber(row.liability)}</Td>
            <Td>{row.error ? <Badge tone="bad">Erreur</Badge> : <Badge tone="info">Info</Badge>}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function InternalTable({ rows }: { rows: InternalRow[] }) {
  if (rows.length === 0) return <EmptyState text="Aucun token interne." />;
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th align="right">Dû aux utilisateurs</Th>
          <Th align="right">Valeur (USD)</Th>
          <Th align="right">Utilisateurs</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
            <Td><strong style={{ color: "#f8fafc" }}>{row.asset}</strong></Td>
            <Td align="right">{formatNumber(row.liability)}</Td>
            <Td align="right">{row.priceUsd !== null ? formatUsd(row.liability * row.priceUsd) : "—"}</Td>
            <Td align="right">{row.userCount}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function FeesTable({ rows }: { rows: FeeRow[] }) {
  if (rows.length === 0) return <EmptyState text="Aucun frais collecté." />;
  const totalUsd = rows.reduce((n, f) => n + (f.priceUsd !== null ? f.total * f.priceUsd : 0), 0);
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th align="right">Frais collectés</Th>
          <Th align="right">Nombre</Th>
          <Th align="right">Valeur (USD)</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.asset} style={{ borderTop: "1px solid #334155" }}>
            <Td><strong style={{ color: "#f8fafc" }}>{f.asset}</strong></Td>
            <Td align="right">{formatNumber(f.total)}</Td>
            <Td align="right">{f.count}</Td>
            <Td align="right">{f.priceUsd !== null ? formatUsd(f.total * f.priceUsd) : "—"}</Td>
          </tr>
        ))}
        <tr style={{ borderTop: "1px solid #334155", background: "#0f172a" }}>
          <Td><strong style={{ color: "#f8fafc" }}>Total</strong></Td>
          <Td align="right">—</Td>
          <Td align="right">{rows.reduce((n, f) => n + f.count, 0)}</Td>
          <Td align="right"><strong style={{ color: "#f8fafc" }}>{formatUsd(totalUsd)}</strong></Td>
        </tr>
      </tbody>
    </TableShell>
  );
}
