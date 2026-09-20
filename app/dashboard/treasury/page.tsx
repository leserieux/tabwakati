import { getSupabaseAdmin } from "@/lib/supabase";
import { getDbPool } from "@/lib/db";
import { getNativeBalance, getTokenBalance, getBtcBalance } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

const INTERNAL_ONLY_ASSETS = new Set(["WAKATI"]);

interface CryptoRow {
  asset: string;
  network: string;
  onChain: number | null;
  liability: number;
  userCount: number;
  error?: string;
}

interface InternalRow {
  asset: string;
  liability: number;
  userCount: number;
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

async function loadLiabilities(): Promise<Map<string, { total: number; count: number }>> {
  const pool = getDbPool();
  const result = await pool.query<{ asset_symbol: string; total_liability: string; user_count: string }>(
    `SELECT asset_symbol,
            COALESCE(SUM(available_balance + COALESCE(staking_balance,0) + COALESCE(pending_balance,0)), 0) AS total_liability,
            COUNT(*) FILTER (WHERE available_balance + COALESCE(staking_balance,0) + COALESCE(pending_balance,0) > 0) AS user_count
     FROM user_balances
     GROUP BY asset_symbol`
  );

  const map = new Map<string, { total: number; count: number }>();
  for (const l of result.rows) {
    map.set(l.asset_symbol, { total: Number(l.total_liability), count: Number(l.user_count) });
  }
  return map;
}

async function loadCryptoAndInternal(
  liabilityMap: Map<string, { total: number; count: number }>
): Promise<{ crypto: CryptoRow[]; internal: InternalRow[] }> {
  const supabase = getSupabaseAdmin();

  const { data: assets, error: assetsError } = await supabase
    .from("supported_assets")
    .select("symbol, network, contract_address, decimals")
    .neq("network", "Fiat")
    .eq("is_active", true);

  if (assetsError) throw new Error(`Erreur chargement actifs: ${assetsError.message}`);

  const crypto: CryptoRow[] = [];
  const internal: InternalRow[] = [];

  for (const asset of assets || []) {
    const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };

    if (INTERNAL_ONLY_ASSETS.has(asset.symbol)) {
      internal.push({ asset: asset.symbol, liability: liability.total, userCount: liability.count });
      continue;
    }

    let onChain: number | null = null;
    let error: string | undefined;

    try {
      const network = asset.network.toLowerCase();

      if (asset.symbol === "BTC") {
        if (!TREASURY_BTC_ADDRESS) throw new Error("TREASURY_BTC_ADDRESS non configurée");
        onChain = await getBtcBalance(TREASURY_BTC_ADDRESS);
      } else if (asset.contract_address) {
        if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
        onChain = await getTokenBalance(network, asset.contract_address, TREASURY_EVM_ADDRESS, asset.decimals || 18);
      } else {
        if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
        onChain = await getNativeBalance(network, TREASURY_EVM_ADDRESS);
      }
    } catch (e: any) {
      error = e?.message || "Erreur inconnue";
    }

    crypto.push({
      asset: asset.symbol,
      network: asset.network,
      onChain,
      liability: liability.total,
      userCount: liability.count,
      error
    });
  }

  crypto.sort((a, b) => a.asset.localeCompare(b.asset));
  return { crypto, internal };
}

async function fetchPawapayBalances(): Promise<Map<string, number> | { error: string }> {
  const secret = process.env.DASHBOARD_API_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!secret || !supabaseUrl) {
    return { error: "DASHBOARD_API_SECRET ou SUPABASE_URL manquant" };
  }

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
    for (const b of data.balances || []) {
      map.set(b.country, Number(b.balance));
    }
    return map;
  } catch (e: any) {
    return { error: e?.message || "Erreur réseau vers dashboard-pawapay-balance" };
  }
}

async function loadFiat(liabilityMap: Map<string, { total: number; count: number }>): Promise<FiatRow[]> {
  const supabase = getSupabaseAdmin();

  const { data: countries, error: countriesError } = await supabase
    .from("payment_countries")
    .select("iso_code, currency_code, wallet_asset_symbol")
    .eq("is_active", true);

  if (countriesError) throw new Error(`Erreur chargement pays: ${countriesError.message}`);

  const pawapayResult = await fetchPawapayBalances();
  const globalError = "error" in pawapayResult ? pawapayResult.error : undefined;
  const balances = "error" in pawapayResult ? new Map<string, number>() : pawapayResult;

  const rows: FiatRow[] = [];
  for (const country of countries || []) {
    const pawapayBalance = balances.get(country.iso_code) ?? null;
    rows.push({
      asset: country.wallet_asset_symbol,
      currency: country.currency_code,
      country: country.iso_code,
      pawapayBalance,
      liability: 0,
      userCount: 0,
      error: globalError
    });
  }

  for (const row of rows) {
    const liab = liabilityMap.get(row.asset);
    row.liability = liab?.total || 0;
    row.userCount = liab?.count || 0;
  }

  return rows;
}

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 8 });
}

export default async function TreasuryPage() {
  let crypto: CryptoRow[] = [];
  let internal: InternalRow[] = [];
  let fiat: FiatRow[] = [];
  let loadError: string | null = null;

  try {
    const liabilityMap = await loadLiabilities();
    const [{ crypto: c, internal: i }, f] = await Promise.all([
      loadCryptoAndInternal(liabilityMap),
      loadFiat(liabilityMap)
    ]);
    crypto = c;
    internal = i;
    fiat = f;
  } catch (e: any) {
    loadError = e?.message || "Erreur de chargement";
  }

  return (
    <div>
      <h1 style={{ color: "#f8fafc", marginBottom: "0.25rem" }}>Treasury & Solvabilité</h1>
      <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Compare le solde réel (on-chain ou chez PawaPay) au total dû aux utilisateurs. Données rafraîchies à chaque chargement de page.
      </p>

      {loadError && (
        <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          Erreur : {loadError}
        </div>
      )}

      {(!TREASURY_EVM_ADDRESS || !TREASURY_BTC_ADDRESS) && (
        <div style={{ background: "#78350f", color: "#fde68a", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          ⚠️ TREASURY_EVM_ADDRESS et/ou TREASURY_BTC_ADDRESS ne sont pas configurées.
        </div>
      )}

      <SectionTitle>Crypto (on-chain)</SectionTitle>
      <CryptoTable rows={crypto} />

      <SectionTitle>Fiat (via PawaPay)</SectionTitle>
      <FiatTable rows={fiat} />

      <SectionTitle>Tokens internes (hors périmètre on-chain)</SectionTitle>
      <InternalTable rows={internal} />

      <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "1.5rem" }}>
        "Déficit" signifie que le solde réel (on-chain ou PawaPay) a moins que ce qui est dû aux utilisateurs — à traiter en priorité.
        Un solde supérieur au passif est normal (marge de fonctionnement, frais non encore retirés, etc.).
        Les tokens internes n'ont pas encore de réserve on-chain suivie ici.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: "2rem 0 0.75rem" }}>{children}</h2>;
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "12px", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

function CryptoTable({ rows }: { rows: CryptoRow[] }) {
  if (rows.length === 0) {
    return <EmptyState text="Aucun actif crypto actif." />;
  }
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th>Réseau</Th>
          <Th align="right">Solde on-chain (treasury)</Th>
          <Th align="right">Dû aux utilisateurs</Th>
          <Th align="right">Écart</Th>
          <Th align="right">Utilisateurs</Th>
          <Th>Statut</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const diff = row.onChain !== null ? row.onChain - row.liability : null;
          const isShortfall = diff !== null && diff < -0.00000001;

          return (
            <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
              <Td><strong style={{ color: "#f8fafc" }}>{row.asset}</strong></Td>
              <Td>{row.network}</Td>
              <Td align="right">
                {row.error ? <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{row.error}</span> : formatNumber(row.onChain ?? 0)}
              </Td>
              <Td align="right">{formatNumber(row.liability)}</Td>
              <Td align="right">
                {diff !== null ? (
                  <span style={{ color: isShortfall ? "#f87171" : "#4ade80" }}>
                    {diff >= 0 ? "+" : ""}
                    {formatNumber(diff)}
                  </span>
                ) : "—"}
              </Td>
              <Td align="right">{row.userCount}</Td>
              <Td>
                {row.error ? (
                  <Badge color="#f87171" bg="#7f1d1d">Erreur</Badge>
                ) : isShortfall ? (
                  <Badge color="#f87171" bg="#7f1d1d">⚠ Déficit</Badge>
                ) : (
                  <Badge color="#4ade80" bg="#14532d">OK</Badge>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function FiatTable({ rows }: { rows: FiatRow[] }) {
  if (rows.length === 0) {
    return <EmptyState text="Aucun pays fiat actif." />;
  }
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
              ) : "—"}
            </Td>
            <Td align="right">{formatNumber(row.liability)}</Td>
            <Td>
              {row.error ? <Badge color="#f87171" bg="#7f1d1d">Erreur</Badge> : <Badge color="#64748b" bg="#1e293b">Info</Badge>}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function InternalTable({ rows }: { rows: InternalRow[] }) {
  if (rows.length === 0) {
    return <EmptyState text="Aucun token interne." />;
  }
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th align="right">Dû aux utilisateurs</Th>
          <Th align="right">Utilisateurs</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
            <Td><strong style={{ color: "#f8fafc" }}>{row.asset}</strong></Td>
            <Td align="right">{formatNumber(row.liability)}</Td>
            <Td align="right">{row.userCount}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "12px", padding: "1.5rem", color: "#64748b", fontSize: "0.9rem" }}>
      {text}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align || "left",
        padding: "0.75rem 1rem",
        color: "#94a3b8",
        fontSize: "0.8rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em"
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ textAlign: align || "left", padding: "0.75rem 1rem", color: "#cbd5e1", fontSize: "0.9rem" }}>
      {children}
    </td>
  );
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span style={{ background: bg, color, padding: "0.2rem 0.6rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600 }}>
      {children}
    </span>
  );
}
