import { getSupabaseAdmin } from "@/lib/supabase";
import { isValidPrice } from "@/lib/valuation";

export { getSupabaseAdmin };

/** Exécute une requête Supabase et renvoie toujours un résultat (jamais d'exception). */
export async function q<T = any>(
  builder: PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ rows: T[]; error?: string }> {
  try {
    const { data, error } = await builder;
    if (error) return { rows: [], error: error.message };
    return { rows: data || [] };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Erreur inconnue" };
  }
}

const PAGE = 1000;

/**
 * Lit TOUTES les lignes d'une requête. PostgREST plafonne chaque réponse à 1000 lignes :
 * sans pagination, une page qui lit `transactions` ou `platform_fees` travaille sur un
 * échantillon tronqué et affiche des totaux faux sans aucune erreur.
 * Usage : fetchAll((from, to) => db.from("transactions").select("...").order("id").range(from, to))
 */
export async function fetchAll<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 200_000
): Promise<{ rows: T[]; error?: string; truncated?: boolean }> {
  const rows: T[] = [];
  try {
    for (let from = 0; from < maxRows; from += PAGE) {
      const { data, error } = await page(from, from + PAGE - 1);
      if (error) return { rows, error: error.message };
      const chunk = data || [];
      rows.push(...chunk);
      if (chunk.length < PAGE) return { rows };
    }
    return { rows, truncated: true };
  } catch (e: any) {
    return { rows, error: e?.message || "Erreur inconnue" };
  }
}

export interface PriceRow {
  asset_symbol: string;
  ledger_symbol: string;
  network: string;
  is_active: boolean;
  price_usd: number | null; // null = absent ou <= 0 (jamais 0)
  change_24h: number | null;
  market_cap: number | null;
  updated_at: string | null;
}

/**
 * Prix par symbole technique (USDC-BSC, USDC-POL...), résolus via ledger_symbol.
 * coingecko-price écrit sous le ledger_symbol (USDC) ; lire asset_prices avec le symbole technique
 * ratait USDC-ETH et USDC-POL et lisait un vieux prix pour USDC-BSC.
 */
export async function loadPriceRows(): Promise<{ rows: PriceRow[]; error?: string }> {
  const res = await q<any>(
    getSupabaseAdmin().from("asset_prices_resolved").select("asset_symbol, ledger_symbol, network, is_active, price_usd, change_24h, market_cap, updated_at")
  );
  const rows: PriceRow[] = res.rows.map((r) => ({
    asset_symbol: String(r.asset_symbol),
    ledger_symbol: String(r.ledger_symbol),
    network: String(r.network),
    is_active: !!r.is_active,
    price_usd: isValidPrice(Number(r.price_usd)) ? Number(r.price_usd) : null,
    change_24h: r.change_24h === null || r.change_24h === undefined ? null : Number(r.change_24h),
    market_cap: r.market_cap === null || r.market_cap === undefined ? null : Number(r.market_cap),
    updated_at: r.updated_at ?? null
  }));
  return { rows, error: res.error };
}

/** Map symbole technique -> prix USD valide (> 0). Un actif sans prix valide est absent de la map. */
export async function loadPrices(): Promise<Map<string, number>> {
  const { rows } = await loadPriceRows();
  const map = new Map<string, number>();
  for (const r of rows) if (r.price_usd !== null) map.set(r.asset_symbol, r.price_usd);
  return map;
}
