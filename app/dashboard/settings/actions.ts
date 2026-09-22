"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";

const PATH = "/dashboard/settings";

function num(fd: FormData, key: string): number {
  const n = Number(fd.get(key));
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

async function apply(section: string, update: () => Promise<{ error: { message: string } | null }>) {
  const { error } = await update();
  revalidatePath(PATH);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(section)}&msg=${encodeURIComponent(error.message)}`);
  redirect(`${PATH}?saved=${encodeURIComponent(section)}`);
}

export async function updateStakingConfig(formData: FormData) {
  await apply("staking", () =>
    getSupabaseAdmin()
      .from("staking_config")
      .update({
        apr: num(formData, "apr"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString(),
        updated_by: "admin"
      })
      .eq("id", 1)
  );
}

export async function updateWheelConfig(formData: FormData) {
  await apply("wheel", () =>
    getSupabaseAdmin()
      .from("wheel_config")
      .update({
        free_spins_daily: num(formData, "free_spins_daily"),
        paid_spin_cost_amount: num(formData, "paid_spin_cost_amount"),
        jackpot_contribution_pct: num(formData, "jackpot_contribution_pct"),
        streak_bonus_free_spins: num(formData, "streak_bonus_free_spins"),
        streak_bonus_interval: num(formData, "streak_bonus_interval"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
  );
}

export async function updatePredictionConfig(formData: FormData) {
  await apply("prediction", () =>
    getSupabaseAdmin()
      .from("prediction_config")
      .update({
        bet_amount: num(formData, "bet_amount"),
        bet_min: num(formData, "bet_min"),
        bet_max: num(formData, "bet_max"),
        win_multiplier: num(formData, "win_multiplier"),
        duration_seconds: num(formData, "duration_seconds"),
        max_bets_per_day: num(formData, "max_bets_per_day"),
        cooldown_seconds: num(formData, "cooldown_seconds"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString(),
        updated_by: "admin"
      })
      .eq("id", 1)
  );
}

export async function updateScoreCreditConfig(formData: FormData) {
  await apply("score_credit", () =>
    getSupabaseAdmin()
      .from("score_credit_config")
      .update({
        conversion_rate_base_pct: num(formData, "conversion_rate_base_pct"),
        conversion_rate_max_pct: num(formData, "conversion_rate_max_pct"),
        min_fees_required_usd: num(formData, "min_fees_required_usd"),
        min_account_age_days: num(formData, "min_account_age_days"),
        first_loan_cap_usd: num(formData, "first_loan_cap_usd"),
        max_absolute_cap_usd: num(formData, "max_absolute_cap_usd"),
        loan_duration_days: num(formData, "loan_duration_days"),
        grace_period_hours: num(formData, "grace_period_hours"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
  );
}

export async function updateCampayConfig(formData: FormData) {
  await apply("campay", () =>
    getSupabaseAdmin()
      .from("campay_config")
      .update({
        sandbox_min_deposit: num(formData, "sandbox_min_deposit"),
        sandbox_max_deposit: numOrNull(formData, "sandbox_max_deposit"),
        production_min_deposit: num(formData, "production_min_deposit"),
        production_max_deposit: numOrNull(formData, "production_max_deposit"),
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
  );
}
