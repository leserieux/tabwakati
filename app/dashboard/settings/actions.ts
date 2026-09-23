"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { diffFields, getCurrentActor, logAdminAction, type AuditChange } from "@/lib/audit";

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

/** Lit une ligne existante avant modification, pour pouvoir calculer un avant/après dans le journal d'audit. */
async function fetchOne(table: string, column: string, value: string | number): Promise<Record<string, any> | null> {
  const { data } = await getSupabaseAdmin().from(table).select("*").eq(column, value).maybeSingle();
  return data;
}

/**
 * Exécute la mise à jour, écrit une ligne dans le journal d'audit (succès ou échec),
 * puis redirige vers /dashboard/settings avec un message.
 *  - `summary` est le texte affiché à l'utilisateur (ex: "Staking", "Cameroun (CM)")
 *  - `changes` est la liste des champs modifiés, déjà calculée par l'appelant (diffFields ou construite à la main)
 */
async function apply(opts: {
  action: string;
  summary: string;
  target: string;
  changes?: AuditChange[];
  run: () => PromiseLike<{ error: { message: string } | null }>;
}) {
  const { error } = await opts.run();

  await logAdminAction({
    action: opts.action,
    summary: opts.summary,
    target: opts.target,
    changes: opts.changes,
    status: error ? "error" : "success",
    errorMessage: error?.message
  });

  revalidatePath(PATH);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(opts.summary)}&msg=${encodeURIComponent(error.message)}`);
  redirect(`${PATH}?saved=${encodeURIComponent(opts.summary)}`);
}

export async function updateStakingPool(formData: FormData) {
  const id = str(formData, "id");
  const label = str(formData, "label") || id;
  const stakingType = str(formData, "staking_type") || "flexible";
  const lockPeriodDays = stakingType === "locked" ? num(formData, "lock_period_days") : 0;
  const apr = num(formData, "base_apy");
  const isActive = bool(formData, "is_active");

  const patch = {
    name: str(formData, "name"),
    base_apy: apr,
    min_stake: num(formData, "min_stake"),
    max_stake: numOrNull(formData, "max_stake"),
    max_pool_capacity: numOrNull(formData, "max_pool_capacity"),
    staking_type: stakingType,
    lock_period_days: lockPeriodDays,
    instant_unstake_enabled: bool(formData, "instant_unstake_enabled"),
    instant_unstake_fee_percent: numOrNull(formData, "instant_unstake_fee_percent"),
    is_active: isActive,
    sort_order: num(formData, "sort_order") || 100,
    description: str(formData, "description") || null
  };
  const before = await fetchOne("staking_pools", "id", id);

  await apply({
    action: "settings.staking_pool.update",
    summary: label,
    target: `staking_pools#${id}`,
    changes: diffFields(before, patch),
    run: async () => {
      const db = getSupabaseAdmin();
      const { error } = await db
        .from("staking_pools")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);

      // staking_config est une table historique encore lue par get_my_staking() (affichage
      // de l'ancien écran simple) : on la garde alignée pour le plan flexible d'origine.
      // Le calcul réel des récompenses (fn_stake/fn_unstake) lit directement staking_pools.
      if (!error && stakingType === "flexible") {
        await db
          .from("staking_config")
          .update({ apr, is_active: isActive, updated_at: new Date().toISOString(), updated_by: getCurrentActor() })
          .eq("id", 1);
      }
      return { error };
    }
  });
}

export async function addStakingPool(formData: FormData) {
  const name = str(formData, "name");
  const assetSymbol = str(formData, "asset_symbol");
  const stakingType = str(formData, "staking_type") || "flexible";
  const lockPeriodDays = stakingType === "locked" ? num(formData, "lock_period_days") : 0;
  const insertRow = {
    name,
    asset_symbol: assetSymbol,
    base_apy: num(formData, "base_apy"),
    min_stake: num(formData, "min_stake"),
    max_stake: numOrNull(formData, "max_stake"),
    max_pool_capacity: numOrNull(formData, "max_pool_capacity"),
    staking_type: stakingType,
    lock_period_days: lockPeriodDays,
    instant_unstake_enabled: bool(formData, "instant_unstake_enabled"),
    instant_unstake_fee_percent: numOrNull(formData, "instant_unstake_fee_percent"),
    is_active: bool(formData, "is_active"),
    sort_order: num(formData, "sort_order") || 100,
    description: str(formData, "description") || null
  };
  await apply({
    action: "settings.staking_pool.create",
    summary: `${name || assetSymbol} (ajouté)`,
    target: `staking_pools#${assetSymbol}`,
    changes: diffFields(null, insertRow),
    run: () => getSupabaseAdmin().from("staking_pools").insert(insertRow)
  });
}

export async function deleteStakingPool(formData: FormData) {
  const id = str(formData, "id");
  const label = str(formData, "label") || id;
  await apply({
    action: "settings.staking_pool.delete",
    summary: `${label} supprimé`,
    target: `staking_pools#${id}`,
    run: () => getSupabaseAdmin().from("staking_pools").delete().eq("id", id)
  });
}

export async function updateWakatiReserveState(formData: FormData) {
  const patch = {
    profit_share_pct: num(formData, "profit_share_pct"),
    max_daily_change_pct: num(formData, "max_daily_change_pct"),
    price_floor_usd: num(formData, "price_floor_usd"),
    is_active: bool(formData, "is_active")
  };
  const before = await fetchOne("wakati_reserve_state", "id", 1);
  await apply({
    action: "settings.wakati_reserve_state.update",
    summary: "Prix WAKATI",
    target: "wakati_reserve_state#1",
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("wakati_reserve_state")
        .update(patch)
        .eq("id", 1)
  });
}

export async function updateWheelConfig(formData: FormData) {
  const patch = {
    free_spins_daily: num(formData, "free_spins_daily"),
    paid_spin_cost_amount: num(formData, "paid_spin_cost_amount"),
    paid_spin_cost_asset: str(formData, "paid_spin_cost_asset"),
    jackpot_contribution_pct: num(formData, "jackpot_contribution_pct"),
    jackpot_asset_symbol: str(formData, "jackpot_asset_symbol"),
    streak_bonus_free_spins: num(formData, "streak_bonus_free_spins"),
    streak_bonus_interval: num(formData, "streak_bonus_interval"),
    is_active: bool(formData, "is_active")
  };
  const before = await fetchOne("wheel_config", "id", 1);
  await apply({
    action: "settings.wheel.update",
    summary: "Roue de la fortune",
    target: "wheel_config#1",
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("wheel_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1)
  });
}

export async function updatePredictionConfig(formData: FormData) {
  const patch = {
    bet_amount: num(formData, "bet_amount"),
    bet_min: num(formData, "bet_min"),
    bet_max: num(formData, "bet_max"),
    win_multiplier: num(formData, "win_multiplier"),
    duration_seconds: num(formData, "duration_seconds"),
    max_bets_per_day: num(formData, "max_bets_per_day"),
    cooldown_seconds: num(formData, "cooldown_seconds"),
    is_active: bool(formData, "is_active")
  };
  const before = await fetchOne("prediction_config", "id", 1);
  await apply({
    action: "settings.prediction.update",
    summary: "Prédictions",
    target: "prediction_config#1",
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("prediction_config")
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: getCurrentActor() })
        .eq("id", 1)
  });
}

export async function updateScoreCreditConfig(formData: FormData) {
  const patch = {
    conversion_rate_base_pct: num(formData, "conversion_rate_base_pct"),
    conversion_rate_max_pct: num(formData, "conversion_rate_max_pct"),
    min_fees_required_usd: num(formData, "min_fees_required_usd"),
    min_account_age_days: num(formData, "min_account_age_days"),
    first_loan_cap_usd: num(formData, "first_loan_cap_usd"),
    max_absolute_cap_usd: num(formData, "max_absolute_cap_usd"),
    loan_duration_days: num(formData, "loan_duration_days"),
    grace_period_hours: num(formData, "grace_period_hours"),
    is_active: bool(formData, "is_active")
  };
  const before = await fetchOne("score_credit_config", "id", 1);
  await apply({
    action: "settings.score_credit.update",
    summary: "Prêts sur score de crédit",
    target: "score_credit_config#1",
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("score_credit_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1)
  });
}

export async function updatePaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code");
  const label = str(formData, "label") || iso;
  const patch = {
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
    is_active: bool(formData, "is_active")
  };
  const before = await fetchOne("payment_countries", "iso_code", iso);
  await apply({
    action: "settings.payment_country.update",
    summary: label,
    target: `payment_countries#${iso}`,
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("payment_countries")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("iso_code", iso)
  });
}

export async function addPaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code").toUpperCase();
  const name = str(formData, "name");
  const insertRow = {
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
  };
  await apply({
    action: "settings.payment_country.create",
    summary: `${name || iso} (ajouté)`,
    target: `payment_countries#${iso}`,
    changes: diffFields(null, insertRow),
    run: () => getSupabaseAdmin().from("payment_countries").insert(insertRow)
  });
}

export async function deletePaymentCountry(formData: FormData) {
  const iso = str(formData, "iso_code");
  const label = str(formData, "label") || iso;
  await apply({
    action: "settings.payment_country.delete",
    summary: `${label} supprimé`,
    target: `payment_countries#${iso}`,
    run: () => getSupabaseAdmin().from("payment_countries").delete().eq("iso_code", iso)
  });
}

export async function updateCampayConfig(formData: FormData) {
  const patch = {
    sandbox_min_deposit: num(formData, "sandbox_min_deposit"),
    sandbox_max_deposit: numOrNull(formData, "sandbox_max_deposit"),
    production_min_deposit: num(formData, "production_min_deposit"),
    production_max_deposit: numOrNull(formData, "production_max_deposit")
  };
  const before = await fetchOne("campay_config", "id", 1);
  await apply({
    action: "settings.campay.update",
    summary: "Campay (secours)",
    target: "campay_config#1",
    changes: diffFields(before, patch),
    run: () =>
      getSupabaseAdmin()
        .from("campay_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1)
  });
}
