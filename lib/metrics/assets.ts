import { fetchAll, getSupabaseAdmin, loadPrices, q } from "@/lib/data";
import { isValidPrice } from "./pricing";
import type { AssetsMetrics, TreasuryAssetMetrics, UserAssetMetrics } from "./types";

/**
 * Soldes par actif : utilisateurs (dû) et trésorerie (détenu).
 * Chaque actif est agrégé séparément ; aucun mélange de quantités entre actifs.
 * Un actif sans prix valide a valueUsd = null et est listé dans `unpriced` (jamais compté à 0 en silence).
 */
export async function loadAssetsMetrics(prices?: Map<string, number>): Promise<AssetsMetrics> {
  const db = getSupabaseAdmin();
  const [assets, balances, wallets, priceMap] = await Promise.all([
    q<{ symbol: string }>(db.from("supported_assets").select("symbol").eq("is_active", true)),
    fetchAll<any>((from, to) =>
      db.from("user_balances").select("user_id, asset_symbol, available_balance, staking_balance, pending_balance").order("id").range(from, to)
    ),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance")),
    prices ? Promise.resolve(prices) : loadPrices(),
  ]);

  const priceOf = (asset: string): number | null => {
    const p = priceMap.get(asset);
    return isValidPrice(p) ? p : null;
  };

  const acc = new Map<string, UserAssetMetrics>();
  const usersByAsset = new Map<string, Set<string>>();
  const ensure = (symbol: string): UserAssetMetrics => {
    let row = acc.get(symbol);
    if (!row) {
      row = { asset: symbol, users: 0, totalNative: 0, availableNative: 0, stakingNative: 0, pendingNative: 0, priceUsd: priceOf(symbol), valueUsd: null };
      acc.set(symbol, row);
    }
    return row;
  };

  for (const a of assets.rows) ensure(String(a.symbol));

  for (const r of balances.rows) {
    const symbol = String(r.asset_symbol || "");
    if (!symbol) continue;
    const row = ensure(symbol);
    const available = Number(r.available_balance || 0);
    const staking = Number(r.staking_balance || 0);
    const pending = Number(r.pending_balance || 0);
    row.availableNative += available;
    row.stakingNative += staking;
    row.pendingNative += pending;
    row.totalNative += available + staking + pending;
    if (r.user_id && available + staking + pending > 0) {
      const set = usersByAsset.get(symbol) ?? new Set<string>();
      set.add(String(r.user_id));
      usersByAsset.set(symbol, set);
    }
  }

  const userAssets: UserAssetMetrics[] = [...acc.values()]
    .map((row) => ({
      ...row,
      users: usersByAsset.get(row.asset)?.size ?? 0,
      valueUsd: row.priceUsd === null ? null : row.totalNative * row.priceUsd,
    }))
    .filter((row) => row.totalNative > 0 || row.users > 0)
    .sort((a, b) => a.asset.localeCompare(b.asset));

  const treasury: TreasuryAssetMetrics[] = wallets.rows
    .map((w) => {
      const asset = String(w.asset_symbol);
      const balanceNative = Number(w.balance || 0);
      const priceUsd = priceOf(asset);
      return { asset, balanceNative, priceUsd, valueUsd: priceUsd === null ? null : balanceNative * priceUsd };
    })
    .filter((w) => w.balanceNative > 0)
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const unpriced = [
    ...new Set([
      ...userAssets.filter((r) => r.totalNative > 0 && r.priceUsd === null).map((r) => r.asset),
      ...treasury.filter((t) => t.priceUsd === null).map((t) => t.asset),
    ]),
  ];

  return {
    userAssets,
    userTotalUsd: userAssets.reduce((s, r) => s + (r.valueUsd ?? 0), 0),
    treasury,
    treasuryTotalUsd: treasury.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
    unpriced,
    activeAssetCount: assets.rows.length,
    truncated: !!balances.truncated,
    error: [assets.error, balances.error, wallets.error].filter(Boolean).join(" · ") || undefined,
  };
}
