import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";

export interface Burn { id: string; asset_symbol: string; amount: number; reason: string | null; status: string; tx_hash: string | null; source: string; created_at: string }

export interface BurnsReport {
  burns: Burn[];
  totalBurned: number;          // WAKATI brûlés (comptable)
  pendingAmount: number;        // WAKATI en attente d'envoi on-chain
  pendingCount: number;
  oldestPendingDays: number | null;
  burnedLast30: number;
  pool: { amount: number; asset: string; contributionPct: number; wakatiEquivalent: number | null; usd: number | null } | null;
  treasuryWakati: number | null;
  error?: string;
}

export async function loadBurns(now = Date.now()): Promise<BurnsReport> {
  const db = getSupabaseAdmin();
  const [burnRes, cfgRes, walletRes, prices] = await Promise.all([
    q<any>(db.from("token_burns").select("id, asset_symbol, amount, reason, status, tx_hash, source, created_at").eq("asset_symbol", "WAKATI").order("created_at", { ascending: false }).limit(300)),
    q<any>(db.from("wheel_config").select("jackpot_current_amount, jackpot_asset_symbol, jackpot_contribution_pct").eq("id", 1)),
    q<any>(db.from("treasury_wallets").select("balance").eq("asset_symbol", "WAKATI")),
    loadPrices()
  ]);
  const burns: Burn[] = burnRes.rows.map((b) => ({ id: String(b.id), asset_symbol: String(b.asset_symbol), amount: Number(b.amount), reason: b.reason ?? null, status: String(b.status), tx_hash: b.tx_hash ?? null, source: String(b.source), created_at: String(b.created_at) }));
  const pending = burns.filter((b) => b.status === "pending_onchain");
  const oldest = pending.length ? Math.max(...pending.map((b) => (now - new Date(b.created_at).getTime()) / 86_400_000)) : null;
  const c = cfgRes.rows[0];
  let pool: BurnsReport["pool"] = null;
  if (c) {
    const amount = Number(c.jackpot_current_amount || 0); const asset = String(c.jackpot_asset_symbol);
    const pp = prices.get(asset); const wp = prices.get("WAKATI");
    const usd = asset === "WAKATI" ? (wp ? amount * wp : null) : pp ? amount * pp : null;
    pool = { amount, asset, contributionPct: Number(c.jackpot_contribution_pct || 0), usd, wakatiEquivalent: asset === "WAKATI" ? amount : usd !== null && wp ? usd / wp : null };
  }
  return {
    burns,
    totalBurned: burns.reduce((s, b) => s + b.amount, 0),
    pendingAmount: pending.reduce((s, b) => s + b.amount, 0),
    pendingCount: pending.length,
    oldestPendingDays: oldest,
    burnedLast30: burns.filter((b) => now - new Date(b.created_at).getTime() <= 30 * 86_400_000).reduce((s, b) => s + b.amount, 0),
    pool,
    treasuryWakati: walletRes.rows[0] ? Number(walletRes.rows[0].balance) : null,
    error: [burnRes.error, cfgRes.error, walletRes.error].filter(Boolean).join(" · ") || undefined
  };
}
