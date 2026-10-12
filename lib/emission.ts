import { getSupabaseAdmin, q } from "@/lib/data";

/** Réglages du plafond d'émission (table emission_settings, ligne id = 1). Tout se règle depuis WAKATI > Offre. */
export interface EmissionSettings {
  enabled: boolean;
  enforce: boolean;
  budgetPctPerMonth: number;
  windowDays: number;
  countGameNet: boolean;
  gateStaking: boolean;
  gateReferral: boolean;
  referralBonusReferred: number;
  referralBonusReferrer: number;
  priceStepWakati: number;
  runwayWindowDays: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EmissionStatus {
  treasury: number;
  budget: number;          // budget de la fenêtre (trésorerie × % mensuel × jours / 30)
  windowDays: number;
  incentivesUsed: number;  // staking + parrainage journalisés
  gameNetUsed: number;     // gains - mises des jeux (compté, jamais bloqué)
  used: number;
  remaining: number;
  usagePct: number | null;
}

export interface EmissionLogRow { id: number; at: string; source: string; requested: number; allowed: number }

export interface EmissionReport {
  settings: EmissionSettings;
  status: EmissionStatus | null;
  log: EmissionLogRow[];
  error?: string;
}

/** Valeurs de repli si la ligne de réglages est absente (la page reste lisible). */
const DEFAULTS: EmissionSettings = {
  enabled: true, enforce: true, budgetPctPerMonth: 0.5, windowDays: 30, countGameNet: true, gateStaking: true, gateReferral: true,
  referralBonusReferred: 300, referralBonusReferrer: 200, priceStepWakati: 10000, runwayWindowDays: 90, updatedAt: null, updatedBy: null
};

export async function loadEmission(): Promise<EmissionReport> {
  const db = getSupabaseAdmin();
  const [setRes, logRes, stRes] = await Promise.all([
    q<any>(db.from("emission_settings").select("*").eq("id", 1)),
    q<any>(db.from("emission_log").select("id, logged_at, source, requested, allowed").order("id", { ascending: false }).limit(15)),
    db.rpc("fn_emission_status")
  ]);

  const s = setRes.rows[0];
  const settings: EmissionSettings = s
    ? {
        enabled: !!s.enabled, enforce: !!s.enforce,
        budgetPctPerMonth: Number(s.budget_pct_per_month), windowDays: Number(s.window_days),
        countGameNet: !!s.count_game_net, gateStaking: !!s.gate_staking, gateReferral: !!s.gate_referral,
        referralBonusReferred: Number(s.referral_bonus_referred), referralBonusReferrer: Number(s.referral_bonus_referrer),
        priceStepWakati: Number(s.price_step_wakati), runwayWindowDays: Number(s.runway_window_days),
        updatedAt: s.updated_at ?? null, updatedBy: s.updated_by ?? null
      }
    : DEFAULTS;

  const st = (stRes.data ?? null) as Record<string, any> | null;
  const status: EmissionStatus | null = st && st.configured
    ? { treasury: Number(st.treasury), budget: Number(st.budget), windowDays: Number(st.window_days), incentivesUsed: Number(st.incentives_used), gameNetUsed: Number(st.game_net_used), used: Number(st.used), remaining: Number(st.remaining), usagePct: st.usage_pct == null ? null : Number(st.usage_pct) }
    : null;

  return {
    settings,
    status,
    log: logRes.rows.map((r) => ({ id: Number(r.id), at: String(r.logged_at), source: String(r.source), requested: Number(r.requested), allowed: Number(r.allowed) })),
    error: [setRes.error, logRes.error, stRes.error?.message].filter(Boolean).join(" · ") || undefined
  };
}
