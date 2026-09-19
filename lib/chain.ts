// Lecture on-chain en LECTURE SEULE via des RPC.
// Aucune clé privée n'est utilisée ici — uniquement des adresses publiques.
// Les URLs avec clé (Alchemy, etc.) se mettent UNIQUEMENT dans les variables
// d'environnement Vercel, jamais dans le code (le repo est public).

const RPC_URLS: Record<string, string[]> = {
  polygon: [
    process.env.POLYGON_RPC_URL,
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.drpc.org",
    "https://1rpc.io/matic"
  ].filter(Boolean) as string[],
  bsc: [
    process.env.BSC_RPC_URL,
    "https://bsc-dataseed.binance.org",
    "https://bsc-rpc.publicnode.com"
  ].filter(Boolean) as string[],
  ethereum: [
    process.env.ETHEREUM_RPC_URL,
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com"
  ].filter(Boolean) as string[]
};

/** Résultat de la lecture d'un ensemble d'adresses. */
export interface MultiBalance {
  total: number;
  checked: number; // adresses lues avec succès
  failed: number; // adresses dont la lecture a échoué
}

/** POST JSON-RPC avec repli sur les RPC suivants en cas d'échec. */
async function rpcPost(network: string, body: unknown): Promise<any> {
  const urls = RPC_URLS[network];
  if (!urls?.length) throw new Error(`RPC inconnu pour le réseau: ${network}`);

  let lastError = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        lastError = `${new URL(url).host} → ${res.status}`;
        continue;
      }
      return await res.json();
    } catch (e: any) {
      lastError = `${new URL(url).host} → ${e?.message || "erreur réseau"}`;
    }
  }
  throw new Error(`Tous les RPC ${network} ont échoué (${lastError})`);
}

async function rpcCall(network: string, method: string, params: any[]): Promise<any> {
  const data = await rpcPost(network, { jsonrpc: "2.0", id: 1, method, params });
  if (data.error) throw new Error(`RPC ${network} erreur: ${JSON.stringify(data.error)}`);
  return data.result;
}

/**
 * Plusieurs appels JSON-RPC en une requête. Renvoie un tableau aligné sur
 * `calls` : la valeur, ou null si cet appel précis a échoué.
 */
async function rpcBatch(
  network: string,
  calls: { method: string; params: any[] }[]
): Promise<(string | null)[]> {
  const CHUNK = 20;
  const out: (string | null)[] = [];

  for (let i = 0; i < calls.length; i += CHUNK) {
    const slice = calls.slice(i, i + CHUNK);
    const body = slice.map((c, idx) => ({ jsonrpc: "2.0", id: idx, method: c.method, params: c.params }));

    try {
      const data = await rpcPost(network, body);
      if (Array.isArray(data)) {
        const byId = new Map<number, any>(data.map((d: any) => [d.id, d]));
        for (let idx = 0; idx < slice.length; idx++) {
          const item = byId.get(idx);
          out.push(item && !item.error && typeof item.result === "string" ? item.result : null);
        }
        continue;
      }
    } catch {
      // repli individuel ci-dessous
    }

    // Le RPC n'accepte pas les batchs : on fait les appels un par un.
    for (const c of slice) {
      try {
        const r = await rpcCall(network, c.method, c.params);
        out.push(typeof r === "string" ? r : null);
      } catch {
        out.push(null);
      }
    }
  }
  return out;
}

function hexToBigInt(hex: string): bigint {
  return BigInt(hex === "0x" ? "0x0" : hex);
}

function formatUnits(value: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  const fraction = remainder.toString().padStart(decimals, "0").slice(0, 8);
  return Number(`${whole}.${fraction}`);
}

function balanceOfData(ownerAddress: string): string {
  // Sélecteur balanceOf(address) = 0x70a08231, suivi de l'adresse paddée sur 32 octets
  return `0x70a08231${ownerAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
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
  const hex = await rpcCall(network, "eth_call", [
    { to: contractAddress, data: balanceOfData(ownerAddress) },
    "latest"
  ]);
  if (!hex || hex === "0x") return 0;
  return formatUnits(hexToBigInt(hex), decimals);
}

/** Somme des soldes natifs de plusieurs adresses. */
export async function getNativeBalances(network: string, addresses: string[]): Promise<MultiBalance> {
  if (!addresses.length) return { total: 0, checked: 0, failed: 0 };
  const results = await rpcBatch(
    network,
    addresses.map((a) => ({ method: "eth_getBalance", params: [a, "latest"] }))
  );
  return sumResults(results, 18);
}

/** Somme des soldes d'un token ERC20 sur plusieurs adresses. */
export async function getTokenBalances(
  network: string,
  contractAddress: string,
  addresses: string[],
  decimals: number
): Promise<MultiBalance> {
  if (!addresses.length) return { total: 0, checked: 0, failed: 0 };
  const results = await rpcBatch(
    network,
    addresses.map((a) => ({
      method: "eth_call",
      params: [{ to: contractAddress, data: balanceOfData(a) }, "latest"]
    }))
  );
  return sumResults(results, decimals);
}

function sumResults(results: (string | null)[], decimals: number): MultiBalance {
  let total = 0;
  let checked = 0;
  let failed = 0;
  for (const r of results) {
    if (r === null) {
      failed++;
      continue;
    }
    checked++;
    total += r === "0x" ? 0 : formatUnits(hexToBigInt(r), decimals);
  }
  return { total, checked, failed };
}

/** Solde BTC (adresse P2PKH classique) via l'API publique Blockstream. */
export async function getBtcBalance(address: string): Promise<number> {
  const res = await fetch(`https://blockstream.info/api/address/${address}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Blockstream a répondu ${res.status}`);
  const data = await res.json();
  const funded = data.chain_stats?.funded_txo_sum ?? 0;
  const spent = data.chain_stats?.spent_txo_sum ?? 0;
  const pendingFunded = data.mempool_stats?.funded_txo_sum ?? 0;
  const pendingSpent = data.mempool_stats?.spent_txo_sum ?? 0;
  return (funded - spent + pendingFunded - pendingSpent) / 1e8;
}

/** Somme des soldes BTC de plusieurs adresses (5 requêtes en parallèle max). */
export async function getBtcBalances(addresses: string[]): Promise<MultiBalance> {
  let total = 0;
  let checked = 0;
  let failed = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const slice = addresses.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((a) => getBtcBalance(a)));
    for (const s of settled) {
      if (s.status === "fulfilled") {
        total += s.value;
        checked++;
      } else {
        failed++;
      }
    }
  }
  return { total, checked, failed };
}
