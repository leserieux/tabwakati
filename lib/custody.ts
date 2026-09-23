import { getSupabaseAdmin } from "@/lib/data";
import { getNativeBalance, getTokenBalance, getBtcBalance, getNativeBalances, getTokenBalances, getBtcBalances } from "@/lib/chain";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

export interface CustodyAssetInput {
  symbol: string;
  network: string;
  contract_address: string | null;
  decimals: number | null;
}

export interface CustodyLine {
  treasury: number | null; // solde sur l'adresse trésor elle-même
  users: number; // somme encore sur les adresses individuelles des utilisateurs (pas encore balayées)
  usersFailed: number; // adresses utilisateur dont la lecture a échoué
  total: number | null; // treasury + users — la vraie custody actuelle, null si la lecture trésor a échoué
  error?: string;
}

/**
 * Lit la custody on-chain réelle : adresse trésor + adresses de dépôt individuelles des utilisateurs
 * (les dépôts arrivent d'abord sur des adresses par utilisateur, puis sont balayés vers le trésor —
 * donc ignorer les adresses utilisateurs sous-estime largement ce que la plateforme détient vraiment).
 * Ignore les actifs "Fiat" (pas de lecture on-chain possible).
 */
export async function loadOnchainCustody(assets: CustodyAssetInput[]): Promise<Map<string, CustodyLine>> {
  const db = getSupabaseAdmin();
  const { data: userAddrs } = await db.from("user_addresses").select("asset_symbol, address").eq("is_active", true);

  const treasuryLower = new Set([TREASURY_EVM_ADDRESS, TREASURY_BTC_ADDRESS].filter(Boolean).map((a) => a.toLowerCase()));
  const addrMap = new Map<string, string[]>();
  for (const a of userAddrs || []) {
    if (!a.address || treasuryLower.has(String(a.address).toLowerCase())) continue;
    const list = addrMap.get(a.asset_symbol) || [];
    if (!list.includes(a.address)) list.push(a.address);
    addrMap.set(a.asset_symbol, list);
  }

  const result = new Map<string, CustodyLine>();

  await Promise.all(
    assets
      .filter((a) => a.network !== "Fiat")
      .map(async (asset) => {
        const addresses = addrMap.get(asset.symbol) || [];
        const network = asset.network.toLowerCase();
        const decimals = asset.decimals || 18;

        let treasury: number | null = null;
        let users = 0;
        let usersFailed = 0;
        let error: string | undefined;

        await Promise.all([
          (async () => {
            try {
              if (asset.symbol === "BTC") {
                if (!TREASURY_BTC_ADDRESS) throw new Error("TREASURY_BTC_ADDRESS non configurée");
                treasury = await getBtcBalance(TREASURY_BTC_ADDRESS);
              } else {
                if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
                treasury = asset.contract_address
                  ? await getTokenBalance(network, asset.contract_address, TREASURY_EVM_ADDRESS, decimals)
                  : await getNativeBalance(network, TREASURY_EVM_ADDRESS);
              }
            } catch (e: any) {
              error = e?.message || "Erreur inconnue";
            }
          })(),
          (async () => {
            try {
              const r =
                asset.symbol === "BTC"
                  ? await getBtcBalances(addresses)
                  : asset.contract_address
                    ? await getTokenBalances(network, asset.contract_address, addresses, decimals)
                    : await getNativeBalances(network, addresses);
              users = r.total;
              usersFailed = r.failed;
            } catch {
              usersFailed = addresses.length;
            }
          })()
        ]);

        result.set(asset.symbol, {
          treasury,
          users,
          usersFailed,
          total: treasury !== null ? treasury + users : null,
          error
        });
      })
  );

  return result;
}
