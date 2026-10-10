import { getSupabaseAdmin, q } from "@/lib/data";

export interface Burn { id: string; asset_symbol: string; amount: number; reason: string | null; status: string; tx_hash: string | null; source: string; created_at: string }
export interface BurnRun { id: string; run_at: string; status: string; priceUsd: number | null; newDueUsd: number; burnWakati: number; carriedOutUsd: number; note: string | null }

/** Règle : tant que le WAKATI vaut moins que le seuil (en FCFA), aucun burn et tout va dans la caisse. */
export interface BurnRule {
  enabled: boolean;
  active: boolean;             // burn déclenché (activé ET prix >= seuil)
  priceFcfa: number | null;
  priceUsd: number | null;
  thresholdFcfa: number;
  progressPct: number | null;  // prix actuel / seuil, plafonné à 100
  sharePct: number;            // part du bénéfice net brûlée une fois le seuil atteint
  maxTreasuryPctPerDay: number | null;
  maxDailyBurnWakati: number | null;
  minBurnWakati: number;
  minTreasuryKeepWakati: number;
  carryDueUsd: number;
  fcfaUsd: number | null;      // valeur d'1 FCFA en dollars (pour afficher le seuil en $)
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Réglages de la caisse et du prix (wakati_reserve_state). */
export interface ReserveSettings {
  reserveUsd: number;
  profitSharePct: number;
  maxDailyChangePct: number;
  priceFloorUsd: number;
  isActive: boolean;
  lastComputedAt: string | null;
}

export interface BurnsReport {
  burns: Burn[];
  runs: BurnRun[];
  rule: BurnRule | null;
  reserve: ReserveSettings | null;
  reserveUsd: number | null;    // la caisse
  totalBurned: number;          // WAKATI brûlés (comptable)
  pendingAmount: number;        // WAKATI en attente d'envoi on-chain
  pendingCount: number;
  oldestPendingDays: number | null;
  burnedLast30: number;
  treasuryWakati: number | null;
  error?: string;
}

export async function loadBurns(now = Date.now()): Promise<BurnsReport> {
  const db = getSupabaseAdmin();
  const [burnRes, runRes, setRes, resRes, walletRes, statusRes] = await Promise.all([
    q<any>(db.from("token_burns").select("id, asset_symbol, amount, reason, status, tx_hash, source, created_at").eq("asset_symbol", "WAKATI").order("created_at", { ascending: false }).limit(300)),
    q<any>(db.from("burn_runs").select("id, run_at, status, wakati_price_usd, new_due_usd, burn_wakati, carried_out_usd, note").order("run_at", { ascending: false }).limit(15)),
    q<any>(db.from("burn_settings").select("enabled, burn_start_price_fcfa, burn_share_pct, max_treasury_pct_per_day, max_daily_burn_wakati, min_burn_wakati, min_treasury_keep_wakati, carry_due_usd, updated_at, updated_by").eq("id", 1)),
    q<any>(db.from("wakati_reserve_state").select("reserve_usd, profit_share_pct, max_daily_change_pct, price_floor_usd, is_active, last_computed_at").eq("id", 1)),
    q<any>(db.from("treasury_wallets").select("balance").eq("asset_symbol", "WAKATI")),
    db.rpc("fn_wakati_burn_status")
  ]);

  const burns: Burn[] = burnRes.rows.map((b) => ({ id: String(b.id), asset_symbol: String(b.asset_symbol), amount: Number(b.amount), reason: b.reason ?? null, status: String(b.status), tx_hash: b.tx_hash ?? null, source: String(b.source), created_at: String(b.created_at) }));
  const runs: BurnRun[] = runRes.rows.map((r) => ({ id: String(r.id), run_at: String(r.run_at), status: String(r.status), priceUsd: r.wakati_price_usd == null ? null : Number(r.wakati_price_usd), newDueUsd: Number(r.new_due_usd || 0), burnWakati: Number(r.burn_wakati || 0), carriedOutUsd: Number(r.carried_out_usd || 0), note: r.note ?? null }));
  const pending = burns.filter((b) => b.status === "pending_onchain");
  const oldest = pending.length ? Math.max(...pending.map((b) => (now - new Date(b.created_at).getTime()) / 86_400_000)) : null;

  const s = setRes.rows[0];
  const st = (statusRes.data ?? null) as { active?: boolean; wakati_price_fcfa?: number | null; wakati_price_usd?: number | string | null; fcfa_price_usd?: number | string | null } | null;
  let rule: BurnRule | null = null;
  if (s) {
    const threshold = Number(s.burn_start_price_fcfa);
    const priceFcfa = st?.wakati_price_fcfa == null ? null : Number(st.wakati_price_fcfa);
    rule = {
      enabled: !!s.enabled,
      active: !!st?.active,
      priceFcfa,
      priceUsd: st?.wakati_price_usd == null ? null : Number(st.wakati_price_usd),
      thresholdFcfa: threshold,
      progressPct: priceFcfa === null || !(threshold > 0) ? null : Math.min(100, (priceFcfa / threshold) * 100),
      sharePct: Number(s.burn_share_pct),
      maxTreasuryPctPerDay: s.max_treasury_pct_per_day == null ? null : Number(s.max_treasury_pct_per_day),
      maxDailyBurnWakati: s.max_daily_burn_wakati == null ? null : Number(s.max_daily_burn_wakati),
      minBurnWakati: Number(s.min_burn_wakati || 0),
      minTreasuryKeepWakati: Number(s.min_treasury_keep_wakati || 0),
      carryDueUsd: Number(s.carry_due_usd || 0),
      fcfaUsd: st?.fcfa_price_usd == null ? null : Number(st.fcfa_price_usd),
      updatedAt: s.updated_at ?? null,
      updatedBy: s.updated_by ?? null
    };
  }
  const rs = resRes.rows[0];
  const reserve: ReserveSettings | null = rs ? { reserveUsd: Number(rs.reserve_usd), profitSharePct: Number(rs.profit_share_pct), maxDailyChangePct: Number(rs.max_daily_change_pct), priceFloorUsd: Number(rs.price_floor_usd), isActive: !!rs.is_active, lastComputedAt: rs.last_computed_at ?? null } : null;

  return {
    burns,
    runs,
    rule,
    reserve,
    reserveUsd: resRes.rows[0] ? Number(resRes.rows[0].reserve_usd) : null,
    totalBurned: burns.reduce((sum, b) => sum + b.amount, 0),
    pendingAmount: pending.reduce((sum, b) => sum + b.amount, 0),
    pendingCount: pending.length,
    oldestPendingDays: oldest,
    burnedLast30: burns.filter((b) => now - new Date(b.created_at).getTime() <= 30 * 86_400_000).reduce((sum, b) => sum + b.amount, 0),
    treasuryWakati: walletRes.rows[0] ? Number(walletRes.rows[0].balance) : null,
    error: [burnRes.error, runRes.error, setRes.error, resRes.error, walletRes.error, statusRes.error?.message].filter(Boolean).join(" · ") || undefined
  };
}
