import { fetchAll, getSupabaseAdmin } from "@/lib/data";
import { FEE_TYPE_EXCLUSION_FILTER } from "./rules";

/**
 * Frais plateforme cumulés par actif (montants natifs), selon la règle unique de ./rules.
 * Remplace l'appel RPC get_platform_fees_totals, qui n'exclut pas game_house_edge.
 */
export async function loadFeeTotalsByAsset(): Promise<{ totals: Map<string, number>; error?: string; truncated?: boolean }> {
  const db = getSupabaseAdmin();
  const res = await fetchAll<any>((a, b) =>
    db
      .from("platform_fees")
      .select("asset_symbol, amount")
      .eq("is_test", false)
      .not("fee_type", "in", FEE_TYPE_EXCLUSION_FILTER)
      .order("id")
      .range(a, b)
  );
  const totals = new Map<string, number>();
  for (const r of res.rows) {
    const amount = Number(r.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const asset = String(r.asset_symbol);
    totals.set(asset, (totals.get(asset) ?? 0) + amount);
  }
  return { totals, error: res.error, truncated: res.truncated };
}
