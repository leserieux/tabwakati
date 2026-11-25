import { getSupabaseAdmin } from "@/core/db/data";
import { EXCLUDED_FEE_TYPES } from "./rules";

/**
 * Frais plateforme déjà regroupés par la base (fonction SQL admin_fees_aggregate) : par actif, type et mois UTC,
 * avec les fenêtres 30 j / 7 j / aujourd'hui. Quelques dizaines de lignes au lieu de toute la table, donc aucune
 * troncature possible quand la table grossit. Les règles métier (types exclus, valorisation) restent dans le code.
 */
export type FeeAggRow = {
  asset_symbol: string;
  fee_type: string;
  month: string;
  cnt: number | string;
  amount_sum: number | string;
  amount_30d: number | string;
  amount_7d: number | string;
  amount_today: number | string;
  has_positive: boolean;
};

export async function loadFeeAggregates(now = Date.now()): Promise<{ rows: FeeAggRow[]; error?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("admin_fees_aggregate", { p_now: new Date(now).toISOString() });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as FeeAggRow[] };
}

/** Frais cumulés par actif (montants natifs), hors types exclus (game_house_edge, game_net_loss, futures_settlement). */
export function feeTotalsByAsset(rows: FeeAggRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if ((EXCLUDED_FEE_TYPES as readonly string[]).includes(r.fee_type)) continue;
    const amount = Number(r.amount_sum ?? 0);
    if (!Number.isFinite(amount)) continue;
    totals.set(r.asset_symbol, (totals.get(r.asset_symbol) ?? 0) + amount);
  }
  return totals;
}
