import { loadFeeAggregates, feeTotalsByAsset } from "./fee-aggregates";

/**
 * Frais plateforme cumulés par actif (montants natifs), selon la règle unique de ./rules.
 * Remplace l'appel RPC get_platform_fees_totals, qui n'exclut pas game_house_edge.
 * Lit les totaux regroupés par la base (admin_fees_aggregate) : plus de lecture ligne par ligne.
 */
export async function loadFeeTotalsByAsset(): Promise<{ totals: Map<string, number>; error?: string; truncated?: boolean }> {
  const res = await loadFeeAggregates();
  return { totals: feeTotalsByAsset(res.rows), error: res.error, truncated: false };
}
