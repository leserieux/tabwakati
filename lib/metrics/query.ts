import { fetchAll, getSupabaseAdmin, loadPrices, q } from "@/lib/data";

/**
 * Couche de requêtes / adapatation pour le dashboard.
 * Centralise les appels Supabase et les règles de pagination.
 */
export async function fetchPaged<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 200_000
): Promise<{ rows: T[]; error?: string; truncated?: boolean }> {
  return fetchAll<T>(page, maxRows);
}

export async function loadPriceMap(): Promise<Map<string, number>> {
  return loadPrices();
}

export async function loadUserAssetRows() {
  const db = getSupabaseAdmin();
  return fetchPaged<any>((from, to) =>
    db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance").order("id").range(from, to)
  );
}

export async function loadSupportedAssets() {
  const db = getSupabaseAdmin();
  return q<{ symbol: string }>(db.from("supported_assets").select("symbol").eq("is_active", true));
}
