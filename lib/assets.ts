import { getSupabaseAdmin, q } from "@/lib/data";

export type UserAssetSummary = {
  asset: string;
  users: number;
  total: number;
  available: number;
  staking: number;
  pending: number;
  priceUsd: number | null;
  valueUsd: number | null;
};

/**
 * Agrège les soldes utilisateurs pour tous les actifs actifs.
 * Les écrans génériques ne doivent jamais filtrer un symbole particulier.
 */
export async function loadUserAssetSummaries(): Promise<{ rows: UserAssetSummary[]; error?: string }> {
  const db = getSupabaseAdmin();
  const [assets, balances, prices] = await Promise.all([
    q<{ symbol: string }>(db.from("supported_assets").select("symbol").eq("is_active", true)),
    q<any>(db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance")),
    q<any>(db.from("asset_prices").select("asset_symbol, price_usd"))
  ]);

  const priceOf = new Map(prices.rows.map((row) => [String(row.asset_symbol), Number(row.price_usd)]));
  const byAsset = new Map<string, UserAssetSummary>();

  for (const asset of assets.rows) {
    const symbol = String(asset.symbol);
    const price = priceOf.has(symbol) ? priceOf.get(symbol)! : null;
    byAsset.set(symbol, { asset: symbol, users: 0, total: 0, available: 0, staking: 0, pending: 0, priceUsd: price, valueUsd: null });
  }

  const usersByAsset = new Map<string, Set<string>>();
  for (const row of balances.rows) {
    const symbol = String(row.asset_symbol || "");
    if (!symbol) continue;
    const current = byAsset.get(symbol) || { asset: symbol, users: 0, total: 0, available: 0, staking: 0, pending: 0, priceUsd: priceOf.has(symbol) ? priceOf.get(symbol)! : null, valueUsd: null };
    const users = usersByAsset.get(symbol) || new Set<string>();
    const available = Number(row.available_balance || 0);
    const staking = Number(row.staking_balance || 0);
    const pending = Number(row.pending_balance || 0);
    current.available += available;
    current.staking += staking;
    current.pending += pending;
    current.total += available + staking + pending;
    if (row.user_id && available + staking + pending > 0) users.add(String(row.user_id));
    usersByAsset.set(symbol, users);
    byAsset.set(symbol, current);
  }

  const rows = [...byAsset.values()].map((row) => ({
    ...row,
    users: usersByAsset.get(row.asset)?.size || 0,
    valueUsd: row.priceUsd === null ? null : row.total * row.priceUsd
  })).filter((row) => row.total > 0 || row.users > 0).sort((a, b) => a.asset.localeCompare(b.asset));

  const error = [assets.error, balances.error, prices.error].filter(Boolean).join(" · ") || undefined;
  return { rows, error };
}
