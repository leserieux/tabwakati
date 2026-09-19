// Lecture on-chain en LECTURE SEULE via des RPC publics.
// Aucune clé privée n'est utilisée ici — uniquement des adresses publiques.

const RPC_URLS: Record<string, string> = {
  polygon: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
  bsc: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
  ethereum: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com"
};

async function rpcCall(network: string, method: string, params: any[]): Promise<any> {
  const url = RPC_URLS[network];
  if (!url) throw new Error(`RPC inconnu pour le réseau: ${network}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store"
  });

  if (!res.ok) throw new Error(`RPC ${network} a répondu ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`RPC ${network} erreur: ${JSON.stringify(data.error)}`);
  return data.result;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

function formatUnits(value: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  const fraction = remainder.toString().padStart(decimals, "0").slice(0, 8);
  return Number(`${whole}.${fraction}`);
}

/** Solde natif (MATIC, BNB, ETH) d'une adresse, en unité "humaine". */
export async function getNativeBalance(network: string, address: string): Promise<number> {
  const hex = await rpcCall(network, "eth_getBalance", [address, "latest"]);
  return formatUnits(hexToBigInt(hex), 18);
}

/** Solde d'un token ERC20 (balanceOf) via eth_call, sans ABI externe. */
export async function getTokenBalance(
  network: string,
  contractAddress: string,
  ownerAddress: string,
  decimals: number
): Promise<number> {
  // Sélecteur de fonction balanceOf(address) = 0x70a08231, suivi de l'adresse paddée sur 32 octets
  const paddedAddress = ownerAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const data = `0x70a08231${paddedAddress}`;

  const hex = await rpcCall(network, "eth_call", [{ to: contractAddress, data }, "latest"]);
  if (!hex || hex === "0x") return 0;
  return formatUnits(hexToBigInt(hex), decimals);
}

/** Solde BTC (adresse P2PKH classique) via l'API publique Blockstream. */
export async function getBtcBalance(address: string): Promise<number> {
  const res = await fetch(`https://blockstream.info/api/address/${address}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Blockstream a répondu ${res.status}`);
  const data = await res.json();
  const funded = data.chain_stats?.funded_txo_sum ?? 0;
  const spent = data.chain_stats?.spent_txo_sum ?? 0;
  const pendingFunded = data.mempool_stats?.funded_txo_sum ?? 0;
  const pendingSpent = data.mempool_stats?.spent_txo_sum ?? 0;
  const satoshis = funded - spent + pendingFunded - pendingSpent;
  return satoshis / 1e8;
}
