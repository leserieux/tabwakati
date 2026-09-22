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
function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Exécute la mise à jour puis redirige vers /dashboard/settings avec un message.
 *  `label` est déjà le texte affiché à l'utilisateur (ex: "Staking", "Cameroun (CM)"). */
async function apply(label: string, update: () => PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await update();
  revalidatePath(PATH);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(label)}&msg=${encodeURIComponent(error.message)}`);
  redirect(`${PATH}?saved=${encodeURIComponent(label)}`);
}

export async function updateStakingConfig(formData: FormData) {
  await apply("Staking", () =>
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
  await apply("Roue de la fortune", () =>
    getSupabaseAdmin()
      .from("wheel_config")
      .update({
        free_spins_daily: num(formData, "free_spins_daily"),
        paid_spin_cost_amount: num(formData, "paid_spin_cost_amount"),
        paid_spin_cost_asset: str(formData, "paid_spin_cost_asset"),
        jackpot_contribution_pct: num(formData, "jackpot_contribution_pct"),
        jackpot_asset_symbol: str(formData, "jackpot_asset_symbol"),
        streak_bonus_free_spins: num(formData, "streak_bonus_free_spins"),
        streak_bonus_interval: num(formData, "streak_bonus_interval"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
  );
}

export async function updatePredictionConfig(formData: FormData) {
  await apply("Prédictions", () =>
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
  await apply("Prêts sur score de crédit", () =>
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

export async function updatePaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code");
  const label = str(formData, "label") || iso;
  await apply(label, () =>
    getSupabaseAdmin()
      .from("payment_countries")
      .update({
        currency_code: str(formData, "currency_code").toUpperCase(),
        wallet_asset_symbol: str(formData, "wallet_asset_symbol") || null,
        provider_code: str(formData, "provider_code"),
        fallback_provider_code: str(formData, "fallback_provider_code") || null,
        min_deposit: numOrNull(formData, "min_deposit"),
        max_deposit: numOrNull(formData, "max_deposit"),
        min_withdraw: numOrNull(formData, "min_withdraw"),
        max_withdraw: numOrNull(formData, "max_withdraw"),
        withdraw_fee: num(formData, "withdraw_fee"),
        withdraw_fee_percentage: numOrNull(formData, "withdraw_fee_percentage"),
        deposit_enabled: bool(formData, "deposit_enabled"),
        withdraw_enabled: bool(formData, "withdraw_enabled"),
        is_active: bool(formData, "is_active"),
        updated_at: new Date().toISOString()
      })
      .eq("iso_code", iso)
  );
}

export async function addPaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code").toUpperCase();
  const name = str(formData, "name");
  await apply(`${name || iso} (ajouté)`, () =>
    getSupabaseAdmin()
      .from("payment_countries")
      .insert({
        iso_code: iso,
        name,
        dial_code: str(formData, "dial_code"),
        currency_code: str(formData, "currency_code").toUpperCase(),
        provider_code: str(formData, "provider_code"),
        fallback_provider_code: str(formData, "fallback_provider_code") || null,
        wallet_asset_symbol: str(formData, "wallet_asset_symbol") || null,
        phone_digits_min: num(formData, "phone_digits_min") || 8,
        phone_digits_max: num(formData, "phone_digits_max") || 9,
        min_deposit: numOrNull(formData, "min_deposit"),
        max_deposit: numOrNull(formData, "max_deposit"),
        min_withdraw: numOrNull(formData, "min_withdraw"),
        max_withdraw: numOrNull(formData, "max_withdraw"),
        withdraw_fee: num(formData, "withdraw_fee"),
        withdraw_fee_percentage: numOrNull(formData, "withdraw_fee_percentage"),
        deposit_enabled: bool(formData, "deposit_enabled"),
        withdraw_enabled: bool(formData, "withdraw_enabled"),
        is_active: bool(formData, "is_active"),
        sort_order: num(formData, "sort_order") || 100
      })
  );
}

export async function deletePaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code");
  const label = str(formData, "label") || iso;
  await apply(`${label} supprimé`, () =>
    getSupabaseAdmin().from("payment_countries").delete().eq("iso_code", iso)
  );
}

export async function updateCampayConfig(formData: FormData) {
  await apply("Campay (secours)", () =>
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
