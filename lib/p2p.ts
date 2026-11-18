import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { valueUsd } from "@/lib/valuation";

/** Transferts P2P entre utilisateurs : volume et frais par actif (fonction SQL admin_p2p_by_asset, migration 20261117) + derniers transferts. */

export interface P2pAssetRow {
  asset_symbol: string; transfers: number; senders: number; receivers: number;
  volume: number; fees: number; last_at: string | null;
  price: number | null; volume_usd: number | null; fees_usd: number | null;
}
export interface P2pTransfer {
  id: string; created_at: string; asset_symbol: string; amount: number; fee: number; net_amount: number | null;
  sender_id: string; sender: string | null; receiver_id: string | null; receiver: string | null;
}
export interface P2pReport {
  d30: P2pAssetRow[]; all: P2pAssetRow[];
  totals: { d30Usd: number; allUsd: number; fees30Usd: number; feesAllUsd: number; transfers30: number; transfersAll: number };
  unpriced: string[]; recent: P2pTransfer[]; error?: string;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function byAsset(from: string | null, prices: Map<string, number>): Promise<{ rows: P2pAssetRow[]; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_p2p_by_asset", { p_from: from });
    if (error) return { rows: [], error: error.message };
    const rows = ((data as any[]) ?? []).map((r): P2pAssetRow => {
      const price = prices.get(String(r.asset_symbol)) ?? null;
      return {
        asset_symbol: String(r.asset_symbol), transfers: n(r.transfers), senders: n(r.senders), receivers: n(r.receivers),
        volume: n(r.volume), fees: n(r.fees), last_at: r.last_at ?? null, price,
        volume_usd: valueUsd(n(r.volume), price), fees_usd: valueUsd(n(r.fees), price)
      };
    });
    return { rows };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Erreur inconnue" };
  }
}

export async function loadP2pReport(): Promise<P2pReport> {
  const prices = await loadPrices();
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [d30, all, rec] = await Promise.all([
    byAsset(since30, prices), byAsset(null, prices),
    q<any>(getSupabaseAdmin().from("transactions").select("id, created_at, asset_symbol, amount, fee, net_amount, user_id, counterparty_id")
      .eq("type", "p2p_transfer").eq("status", "completed").order("created_at", { ascending: false }).limit(25))
  ]);

  const ids = [...new Set(rec.rows.flatMap((r) => [r.user_id, r.counterparty_id]).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const u = await q<any>(getSupabaseAdmin().from("users").select("id, username, email").in("id", ids));
    u.rows.forEach((x) => names.set(x.id, x.username ?? x.email ?? ""));
  }
  const recent: P2pTransfer[] = rec.rows.map((r) => ({
    id: r.id, created_at: r.created_at, asset_symbol: String(r.asset_symbol), amount: n(r.amount), fee: n(r.fee),
    net_amount: r.net_amount == null ? null : n(r.net_amount),
    sender_id: r.user_id, sender: names.get(r.user_id) || null,
    receiver_id: r.counterparty_id ?? null, receiver: r.counterparty_id ? names.get(r.counterparty_id) || null : null
  }));

  const sum = (rows: P2pAssetRow[], k: "volume_usd" | "fees_usd") => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  const unpriced = [...new Set([...d30.rows, ...all.rows].filter((r) => r.price === null).map((r) => r.asset_symbol))];
  return {
    d30: d30.rows, all: all.rows, recent, unpriced,
    totals: {
      d30Usd: sum(d30.rows, "volume_usd"), allUsd: sum(all.rows, "volume_usd"),
      fees30Usd: sum(d30.rows, "fees_usd"), feesAllUsd: sum(all.rows, "fees_usd"),
      transfers30: d30.rows.reduce((s, r) => s + r.transfers, 0), transfersAll: all.rows.reduce((s, r) => s + r.transfers, 0)
    },
    error: [d30.error, all.error, rec.error].filter(Boolean).join(" · ") || undefined
  };
}
