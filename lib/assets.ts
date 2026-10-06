import { loadAssetsMetrics } from "@/lib/metrics/assets";

/**
 * @deprecated Adaptateur de compatibilité : la logique vit dans lib/metrics/assets.ts (loadAssetsMetrics).
 * Conservé uniquement pour app/dashboard/users et app/dashboard/markets ; à supprimer quand ces pages
 * appelleront directement loadAssetsMetrics().
 */
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

export async function loadUserAssetSummaries(): Promise<{ rows: UserAssetSummary[]; error?: string }> {
  const m = await loadAssetsMetrics();
  return {
    rows: m.userAssets.map((a) => ({
      asset: a.asset,
      users: a.users,
      total: a.totalNative,
      available: a.availableNative,
      staking: a.stakingNative,
      pending: a.pendingNative,
      priceUsd: a.priceUsd,
      valueUsd: a.valueUsd,
    })),
    error: m.error,
  };
}
