import { getSupabaseAdmin } from "@/lib/data";
import { loadOnchainCustody } from "@/lib/custody";
import { fetchPawapayWallets } from "@/lib/pawapay";
import { formatNumber } from "@/lib/format";

/**
 * Solvabilité réelle : ce que la plateforme DÉTIENT vraiment (on-chain + PawaPay)
 * face à ce qu'elle DOIT aux utilisateurs. Source unique partagée par la page Solvabilité
 * et la Vue d'ensemble, pour que les deux affichent les mêmes chiffres.
 */
// Tokens gérés en interne : aucune réserve à couvrir ici
const INTERNAL_ONLY_ASSETS = new Set(["WAKATI"]);
export const EPS = 0.00000001;

export type Liab = { total: number; count: number };
export type Status = "covered" | "minor" | "short" | "sweep" | "error";

/** Une ligne = un actif : ce que j'ai, ce que je dois, le résultat. */
export interface Line {
  asset: string;
  label: string; // ex. "BNB (BSC)"
  have: number | null;
  owe: number;
  note?: string; // ex. "dont 2 sur les adresses des utilisateurs"
  status: Status;
  priceUsd: number | null;
  error?: string;
  details?: { label: string; value: number }[];
}

// ─────────────────────────── Chargement des données ───────────────────────────

export async function loadLiabilities(): Promise<Map<string, Liab>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_asset_liabilities");
  if (error) throw new Error(`Impossible de lire ce qui est dû aux utilisateurs (${error.message})`);
  const map = new Map<string, Liab>();
  for (const l of (data as any[]) || []) {
    map.set(l.asset_symbol, { total: Number(l.total_liability), count: Number(l.user_count) });
  }
  return map;
}

function computeStatus(have: number | null, owe: number, treasuryOnly: number | null): Status {
  if (have === null) return "error";
  if (have < owe - EPS) return "short";
  if (treasuryOnly !== null && treasuryOnly < owe - EPS) return "sweep";
  return "covered";
}

export async function loadCrypto(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[] }> {
  const db = getSupabaseAdmin();
  const { data: assets, error: assetsError } = await db
    .from("supported_assets")
    .select("symbol, network, contract_address, decimals")
    .neq("network", "Fiat")
    .eq("is_active", true);
  if (assetsError) throw new Error(`Impossible de lire les actifs (${assetsError.message})`);

  const toRead = (assets || []).filter((a) => {
    const l = liab.get(a.symbol) || { total: 0, count: 0 };
    if (INTERNAL_ONLY_ASSETS.has(a.symbol)) return false; // WAKATI : section dédiée plus bas
    return !(l.total === 0 && l.count === 0);
  });

  const custody = await loadOnchainCustody(toRead);

  const lines: Line[] = toRead.map((asset) => {
    const owe = liab.get(asset.symbol)?.total ?? 0;
    const c = custody.get(asset.symbol);
    const treasury = c?.treasury ?? null;
    const users = c?.users ?? 0;
    const usersFailed = c?.usersFailed ?? 0;
    const have = c?.total ?? null;

    const noteParts: string[] = [];
    if (users > EPS) noteParts.push(`dont ${formatNumber(users)} encore sur les adresses des utilisateurs`);
    if (usersFailed > 0) noteParts.push(`${usersFailed} adresse(s) non lue(s)`);

    return {
      asset: asset.symbol,
      label: `${asset.symbol} (${asset.network})`,
      have,
      owe,
      note: noteParts.join(" · ") || undefined,
      status: computeStatus(have, owe, treasury),
      priceUsd: prices.get(asset.symbol) ?? null,
      error: c?.error
    };
  });

  lines.sort((a, b) => a.asset.localeCompare(b.asset));

  return { lines };
}

export async function loadMobileMoney(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[]; error?: string }> {
  const { data: countries, error } = await getSupabaseAdmin()
    .from("payment_countries")
    .select("iso_code, currency_code, wallet_asset_symbol")
    .eq("is_active", true);
  if (error) throw new Error(`Impossible de lire les pays (${error.message})`);

  const { wallets, error: pawapayError } = await fetchPawapayWallets();

  const byAsset = new Map<string, { iso: string; currency: string }[]>();
  for (const c of countries || []) {
    const list = byAsset.get(c.wallet_asset_symbol) || [];
    list.push({ iso: String(c.iso_code).toUpperCase(), currency: c.currency_code });
    byAsset.set(c.wallet_asset_symbol, list);
  }

  const lines: Line[] = [];
  for (const [asset, list] of byAsset) {
    const owe = liab.get(asset)?.total ?? 0;
    const details = list.map((c) => ({
      label: `${c.iso} (${c.currency})`,
      value: wallets.filter((w) => w.country === c.iso).reduce((n, w) => n + w.balance, 0)
    }));
    const have = pawapayError ? null : details.reduce((n, d) => n + d.value, 0);
    lines.push({
      asset,
      label: `${asset} (PawaPay)`,
      have,
      owe,
      status: computeStatus(have, owe, null),
      priceUsd: prices.get(asset) ?? null,
      error: pawapayError,
      details
    });
  }
  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  // On masque un actif sans rien de dû ni de détenu (ex. un pays pas encore utilisé)
  return { lines: lines.filter((l) => l.owe > EPS || (l.have ?? 0) > EPS), error: pawapayError };
}

export const MINOR_USD = 1; // en dessous, un manque est signalé « mineur » (poussière)

function gapOf(l: Line): number | null {
  return l.have === null ? null : l.have - l.owe;
}

/** Un manque de moins de MINOR_USD $ est « mineur » et ne déclenche pas l'alerte rouge. */
export function classifyMinor(l: Line): Line {
  const g = gapOf(l);
  if (l.status === "short" && g !== null && l.priceUsd !== null && Math.abs(g * l.priceUsd) < MINOR_USD) return { ...l, status: "minor" };
  return l;
}

/** Charge toutes les lignes (crypto + argent mobile) avec leur statut. Ne lève jamais : l'erreur est renvoyée. */
export async function loadSolvencyLines(prices: Map<string, number>): Promise<{ crypto: Line[]; mobile: Line[]; error: string | null }> {
  try {
    const liab = await loadLiabilities();
    const [c, m] = await Promise.all([loadCrypto(liab, prices), loadMobileMoney(liab, prices)]);
    return { crypto: c.lines.map(classifyMinor), mobile: m.lines.map(classifyMinor), error: null };
  } catch (e: any) {
    return { crypto: [], mobile: [], error: e?.message || "Erreur de chargement" };
  }
}
