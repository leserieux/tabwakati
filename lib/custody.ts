import { getSupabaseAdmin } from "@/lib/data";
import { getNativeBalance, getTokenBalance, getBtcBalance, getNativeBalances, getTokenBalances, getBtcBalances } from "@/lib/chain";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";
// Coffre (stockage à l'abri, « froid ») : optionnel. Tant qu'il n'est pas configuré, tout se comporte comme avant.
// Les fonds du coffre comptent dans ce que la plateforme détient (sinon les mettre à l'abri ferait croire à un manque).
const VAULT_EVM_ADDRESS = process.env.VAULT_EVM_ADDRESS || "";
const VAULT_BTC_ADDRESS = process.env.VAULT_BTC_ADDRESS || "";
export const VAULT_CONFIGURED = Boolean(VAULT_EVM_ADDRESS || VAULT_BTC_ADDRESS);

export interface CustodyAssetInput {
  symbol: string;
  network: string;
  contract_address: string | null;
  decimals: number | null;
}

export interface CustodyLine {
  treasury: number | null; // solde sur l'adresse trésor elle-même (le portefeuille de retrait)
  vault: number; // solde dans le coffre (0 si aucun coffre n'est configuré)
  users: number; // somme encore sur les adresses individuelles des utilisateurs (pas encore balayées)
  usersFailed: number; // adresses utilisateur dont la lecture a échoué
  total: number | null; // treasury + vault + users — la vraie custody actuelle, null si une lecture a échoué
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

  const treasuryLower = new Set(
    [TREASURY_EVM_ADDRESS, TREASURY_BTC_ADDRESS, VAULT_EVM_ADDRESS, VAULT_BTC_ADDRESS].filter(Boolean).map((a) => a.toLowerCase())
  );
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
        let vault = 0;
        let vaultFailed = false;
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
              if (asset.symbol === "BTC") {
                if (VAULT_BTC_ADDRESS) vault = await getBtcBalance(VAULT_BTC_ADDRESS);
              } else if (VAULT_EVM_ADDRESS) {
                vault = asset.contract_address
                  ? await getTokenBalance(network, asset.contract_address, VAULT_EVM_ADDRESS, decimals)
                  : await getNativeBalance(network, VAULT_EVM_ADDRESS);
              }
            } catch (e: any) {
              vaultFailed = true;
              error = error || `Lecture du coffre impossible : ${e?.message || "erreur inconnue"}`;
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
          vault,
          users,
          usersFailed,
          total: treasury !== null && !vaultFailed ? treasury + vault + users : null,
          error
        });
      })
  );

  return result;
}
