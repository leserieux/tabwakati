import { getSupabaseAdmin, q } from "@/core/db/data";
import { summarizeRefusals, type RefusalRow, type RefusalsReport, type ShortageFlag } from "./refusals-core";

export * from "./refusals-core";

/**
 * Swaps / ventes / achats refusés faute de liquidité sur les 30 derniers jours + actifs actuellement bloqués.
 * Ne lève jamais d'exception : en cas d'erreur de lecture, `error` est renseigné (l'accueil ne doit pas tomber pour ça).
 */
export async function loadRefusals(now = Date.now(), days = 30): Promise<RefusalsReport> {
  const db = getSupabaseAdmin();
  const since = new Date(now - days * 86_400_000).toISOString();
  const [events, state] = await Promise.all([
    q<RefusalRow>(
      db.from("asset_liquidity_events")
        .select("id, asset_symbol, user_id, from_asset, from_amount, requested_amount, reserve_amount, shortfall_amount, requested_usd, shortfall_usd, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500)
    ),
    q<ShortageFlag>(db.from("asset_liquidity_state").select("asset_symbol, liquidity_shortage_since").eq("liquidity_shortage", true))
  ]);
  const report = summarizeRefusals(events.rows, state.rows, now, days);
  const error = [events.error, state.error].filter(Boolean).join(" · ");
  return error ? { ...report, error } : report;
}
