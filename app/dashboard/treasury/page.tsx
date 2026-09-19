import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getNativeBalance,
  getTokenBalance,
  getBtcBalance,
  getNativeBalances,
  getTokenBalances,
  getBtcBalances
} from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // toujours des données fraîches, jamais de cache

// Adresses publiques du treasury (dérivées de TREASURY_MNEMONIC côté backend Supabase).
// Ce ne sont QUE des adresses publiques — aucune clé privée ici.
const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

interface Row {
  asset: string;
  network: string;
  onChain: number | null; // solde de l'adresse du treasury
  unswept: number | null; // solde cumulé des adresses de dépôt utilisateurs (non balayé)
  unsweptFailed: number; // adresses utilisateurs dont la lecture a échoué
  unsweptCount: number; // nombre d'adresses utilisateurs lues
  liability: number;
  userCount: number;
  error?: string;
}

async function loadData(): Promise<Row[]> {
  const supabase = getSupabaseAdmin();

  const [
    { data: liabilities, error: liabError },
    { data: assets, error: assetsError },
    { data: userAddrs, error: addrError }
  ] = await Promise.all([
    supabase.rpc("get_asset_liabilities"),
    supabase
      .from("supported_assets")
      .select("symbol, network, contract_address, decimals")
      .neq("network", "Fiat"),
    supabase.from("user_addresses").select("asset_symbol, address").eq("is_active", true)
  ]);

  if (liabError) throw new Error(`Erreur chargement passif: ${liabError.message}`);
  if (assetsError) throw new Error(`Erreur chargement actifs: ${assetsError.message}`);
  if (addrError) throw new Error(`Erreur chargement adresses utilisateurs: ${addrError.message}`);

  const liabilityMap = new Map<string, { total: number; count: number }>();
  for (const l of liabilities || []) {
    liabilityMap.set(l.asset_symbol, {
      total: Number(l.total_liability),
      count: Number(l.user_count)
    });
  }

  // Adresses de dépôt utilisateurs, dédupliquées par actif (hors adresse du treasury).
  const treasuryLower = new Set(
    [TREASURY_EVM_ADDRESS, TREASURY_BTC_ADDRESS].filter(Boolean).map((a) => a.toLowerCase())
  );
  const addrMap = new Map<string, string[]>();
  for (const a of userAddrs || []) {
    if (!a.address || treasuryLower.has(String(a.address).toLowerCase())) continue;
    const list = addrMap.get(a.asset_symbol) || [];
    if (!list.includes(a.address)) list.push(a.address);
    addrMap.set(a.asset_symbol, list);
  }

  const relevant = (assets || []).filter((asset) => {
    const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };
    // On n'affiche que les actifs ayant un passif
    return !(liability.total === 0 && liability.count === 0);
  });

  const rows = await Promise.all(
    relevant.map(async (asset): Promise<Row> => {
      const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };
      const addresses = addrMap.get(asset.symbol) || [];
      const network = asset.network.toLowerCase();
      const decimals = asset.decimals || 18;

      let onChain: number | null = null;
      let error: string | undefined;
      let unswept: number | null = null;
      let unsweptFailed = 0;
      let unsweptCount = 0;

      // Treasury et adresses utilisateurs sont lus en parallèle
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
        unsweptFailed,
        unsweptCount,
        liability: liability.total,
        userCount: liability.count,
        error
      };
    })
  );

  return rows.sort((a, b) => a.asset.localeCompare(b.asset));
}

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 8 });
}

export default async function TreasuryPage() {
  let rows: Row[] = [];
  let loadError: string | null = null;

  try {
    rows = await loadData();
  } catch (e: any) {
    loadError = e?.message || "Erreur de chargement";
  }

  return (
    <div>
      <h1 style={{ color: "#f8fafc", marginBottom: "0.25rem" }}>Treasury & Solvabilité</h1>
      <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Compare le solde réel on-chain du treasury au total dû aux utilisateurs (passif). Données rafraîchies à chaque chargement de page.
      </p>

      {loadError && (
        <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
          Erreur : {loadError}
        </div>
      )}

      {!TREASURY_EVM_ADDRESS || !TREASURY_BTC_ADDRESS ? (
        <div style={{ background: "#78350f", color: "#fde68a", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          ⚠️ TREASURY_EVM_ADDRESS et/ou TREASURY_BTC_ADDRESS ne sont pas configurées dans les variables d'environnement Vercel. Voir le README pour les valeurs à utiliser.
        </div>
      ) : null}

      <div style={{ background: "#1e293b", borderRadius: "12px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Actif</Th>
              <Th>Réseau</Th>
              <Th align="right">Treasury</Th>
              <Th align="right">Adresses utilisateurs (non balayé)</Th>
              <Th align="right">Total on-chain</Th>
              <Th align="right">Dû aux utilisateurs</Th>
              <Th align="right">Écart</Th>
              <Th align="right">Utilisateurs</Th>
              <Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const EPS = 0.00000001;
              const total = row.onChain !== null ? row.onChain + (row.unswept ?? 0) : null;
              const diff = total !== null ? total - row.liability : null;
              const treasuryDiff = row.onChain !== null ? row.onChain - row.liability : null;
              const isShortfall = diff !== null && diff < -EPS;
              // Couvert au total, mais pas encore ramené sur l'adresse du treasury
              const toSweep = !isShortfall && treasuryDiff !== null && treasuryDiff < -EPS;
              const partialRead = row.unswept === null || row.unsweptFailed > 0;

              return (
                <tr key={row.asset} style={{ borderTop: "1px solid #334155" }}>
                  <Td><strong style={{ color: "#f8fafc" }}>{row.asset}</strong></Td>
                  <Td>{row.network}</Td>
                  <Td align="right">
                    {row.error ? (
                      <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{row.error}</span>
                    ) : (
                      formatNumber(row.onChain ?? 0)
                    )}
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
                      <span style={{ color: isShortfall ? "#f87171" : "#4ade80" }}>
                        {diff >= 0 ? "+" : ""}
                        {formatNumber(diff)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td align="right">{row.userCount}</Td>
                  <Td>
                    {row.error ? (
                      <Badge color="#f87171" bg="#7f1d1d">Erreur</Badge>
                    ) : isShortfall ? (
                      <Badge color="#f87171" bg="#7f1d1d">⚠ Déficit</Badge>
                    ) : toSweep ? (
                      <Badge color="#fbbf24" bg="#78350f">À balayer</Badge>
                    ) : (
                      <Badge color="#4ade80" bg="#14532d">OK</Badge>
                    )}
                    {partialRead && !row.error && (
                      <div style={{ color: "#fbbf24", fontSize: "0.7rem", marginTop: "0.25rem" }}>
                        lecture partielle
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "1rem" }}>
        <strong>Total on-chain</strong> = adresse du treasury + adresses de dépôt des utilisateurs (fonds pas encore balayés).
        <strong>Déficit</strong> : même en additionnant tout, il y a moins on-chain que ce qui est dû — à traiter en priorité.
        <strong>À balayer</strong> : le total couvre le dû, mais une partie des fonds est encore sur les adresses des utilisateurs.
        Un total supérieur au passif est normal (marge, frais collectés non encore retirés, etc.).
        Le gas restant sur les adresses utilisateurs est compté dans « Adresses utilisateurs », mais n'est pas toujours récupérable.
      </p>
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
    <span
      style={{
        background: bg,
        color,
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600
      }}
    >
      {children}
    </span>
  );
}
