"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { getCurrentActor, logAdminAction } from "@/lib/audit";

const PATH = "/dashboard/liquidity";

function fail(asset: string, msg: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(asset || "réserve")}&msg=${encodeURIComponent(msg)}`);
}

export async function adjustLiquidity(formData: FormData) {
  const asset = String(formData.get("asset_symbol") || "").trim();
  const direction = String(formData.get("direction") || "").trim();
  const amount = Number(formData.get("amount"));
  const reason = String(formData.get("reason") || "").trim();

  if (!asset) fail(asset, "Choisis un actif.");
  if (direction !== "add" && direction !== "remove") fail(asset, "Sens invalide.");
  if (!Number.isFinite(amount) || amount <= 0) fail(asset, "Le montant doit être un nombre supérieur à 0.");
  if (reason.length < 5) fail(asset, "Indique un motif (5 caractères minimum) : c'est ce qui rendra ce mouvement compréhensible dans 6 mois.");

  const db = getSupabaseAdmin();
  const { data: before, error: beforeError } = await db.from("treasury_wallets").select("*").eq("asset_symbol", asset).maybeSingle();
  if (beforeError) fail(asset, beforeError.message);

  const balanceBefore = Number(before?.balance || 0);
  const totalCollected = Number(before?.total_collected || 0);
  const totalWithdrawn = Number(before?.total_withdrawn || 0);
  const totalBurned = Number(before?.total_burned || 0);

  if (direction === "remove" && amount > balanceBefore) {
    await logAdminAction({
      action: "liquidity.withdraw",
      summary: `Réserve ${asset}`,
      target: `treasury_wallets#${asset}`,
      status: "error",
      errorMessage: `Retrait de ${amount} refusé : réserve actuelle de ${balanceBefore}`
    });
    fail(asset, `Retrait refusé : la réserve ne contient que ${balanceBefore} ${asset}.`);
  }

  const balanceAfter = direction === "add" ? balanceBefore + amount : balanceBefore - amount;
  const actor = getCurrentActor();
  const fullReason = `[Console admin — ${actor}] ${reason}`;

  const { error: upsertError } = await db.from("treasury_wallets").upsert(
    {
      asset_symbol: asset,
      balance: balanceAfter,
      total_collected: direction === "add" ? totalCollected + amount : totalCollected,
      total_withdrawn: direction === "remove" ? totalWithdrawn + amount : totalWithdrawn,
      total_burned: totalBurned,
      updated_at: new Date().toISOString()
    },
    { onConflict: "asset_symbol" }
  );

  if (!upsertError) {
    // Best-effort : l'historique métier (treasury_ledger) ne doit pas faire échouer l'action si son insertion rate.
    const { error: ledgerError } = await db.from("treasury_ledger").insert({
      asset_symbol: asset,
      entry_type: direction === "add" ? "adjustment" : "admin_withdrawal",
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      performed_by: null, // pas de compte utilisateur associé aux admins de la console (voir lib/auth.ts)
      reason: fullReason
    });
    if (ledgerError) console.error("[liquidity] échec d'écriture dans treasury_ledger:", ledgerError.message);
  }

  await logAdminAction({
    action: direction === "add" ? "liquidity.topup" : "liquidity.withdraw",
    summary: `Réserve ${asset}`,
    target: `treasury_wallets#${asset}`,
    changes: [{ field: "balance", before: balanceBefore, after: upsertError ? balanceBefore : balanceAfter }],
    status: upsertError ? "error" : "success",
    errorMessage: upsertError?.message
  });

  revalidatePath(PATH);
  if (upsertError) fail(asset, upsertError.message);
  redirect(`${PATH}?saved=${encodeURIComponent(asset)}`);
}
