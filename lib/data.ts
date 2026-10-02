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

/** Map symbole -> prix USD valide (> 0) depuis asset_prices. Les prix à 0 sont exclus : actif "non valorisé". */
export async function loadPrices(): Promise<Map<string, number>> {
  const { rows } = await q<{ asset_symbol: string; price_usd: number }>(
    getSupabaseAdmin().from("asset_prices").select("asset_symbol, price_usd")
  );
  const map = new Map<string, number>();
  for (const r of rows) { const p = Number(r.price_usd); if (isValidPrice(p)) map.set(r.asset_symbol, p); }
  return map;
}
