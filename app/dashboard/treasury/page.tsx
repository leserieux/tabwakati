import { getSupabaseAdmin } from "@/lib/supabase";
import { getNativeBalance, getTokenBalance, getBtcBalance } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // toujours des données fraîches, jamais de cache

// Adresses publiques du treasury (dérivées de TREASURY_MNEMONIC côté backend Supabase).
// Ce ne sont QUE des adresses publiques — aucune clé privée ici.
const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

interface Row {
  asset: string;
  network: string;
  onChain: number | null;
  liability: number;
  userCount: number;
  error?: string;
}

async function loadData(): Promise<Row[]> {
  const supabase = getSupabaseAdmin();

  const [{ data: liabilities, error: liabError }, { data: assets, error: assetsError }] = await Promise.all([
    supabase.rpc("get_asset_liabilities"),
    supabase
      .from("supported_assets")
      .select("symbol, network, contract_address, decimals")
      .neq("network", "Fiat")
  ]);

  if (liabError) throw new Error(`Erreur chargement passif: ${liabError.message}`);
  if (assetsError) throw new Error(`Erreur chargement actifs: ${assetsError.message}`);

  const liabilityMap = new Map<string, { total: number; count: number }>();
  for (const l of liabilities || []) {
    liabilityMap.set(l.asset_symbol, {
      total: Number(l.total_liability),
      count: Number(l.user_count)
    });
  }

  const rows: Row[] = [];

  for (const asset of assets || []) {
    const liability = liabilityMap.get(asset.symbol) || { total: 0, count: 0 };
    // On n'affiche que les actifs ayant un passif ou déjà connus comme importants
    if (liability.total === 0 && liability.count === 0) continue;

    let onChain: number | null = null;
    let error: string | undefined;

    try {
      const network = asset.network.toLowerCase();

      if (asset.symbol === "BTC") {
        if (!TREASURY_BTC_ADDRESS) throw new Error("TREASURY_BTC_ADDRESS non configurée");
        onChain = await getBtcBalance(TREASURY_BTC_ADDRESS);
      } else if (asset.contract_address) {
        if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
        onChain = await getTokenBalance(
          network,
          asset.contract_address,
          TREASURY_EVM_ADDRESS,
          asset.decimals || 18
        );
      } else {
        // Actif natif (MATIC, BNB)
        if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
        onChain = await getNativeBalance(network, TREASURY_EVM_ADDRESS);
      }
    } catch (e: any) {
      error = e?.message || "Erreur inconnue";
    }

    rows.push({
      asset: asset.symbol,
      network: asset.network,
      onChain,
      liability: liability.total,
      userCount: liability.count,
      error
    });
  }

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
              const isOk = diff !== null && !isShortfall;

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
                    ) : (
                      <Badge color="#4ade80" bg="#14532d">OK</Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "1rem" }}>
        "Déficit" signifie que le treasury on-chain a moins que ce qui est dû aux utilisateurs pour cet actif — à traiter en priorité.
        Un solde on-chain supérieur au passif est normal (marge de fonctionnement, frais collectés non encore retirés, etc.).
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
