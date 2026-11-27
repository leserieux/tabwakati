"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertCan } from "@/core/auth/session";
import { getSupabaseAdmin } from "@/core/db/data";
import { getCurrentActor, logAdminAction } from "@/core/audit";
import { gateForm } from "@/core/approvals/gate";
import { safeReturnPath, validateAdjustment } from "@/modules/operations/balance-adjust";

type AdjustResult = { success?: boolean; error?: string; balance_before?: number | string; balance_after?: number | string; transaction_id?: string };

function go(path: string, key: "saved" | "error" | "pending", message: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

/**
 * Créditer ou débiter manuellement un solde (ex. dépôt mobile money en échec, vérifié ensuite chez le fournisseur).
 * Passe par la barrière des actions sensibles : motif obligatoire, et double validation si ADMIN_DUAL_CONTROL=on.
 */
export async function adjustBalance(formData: FormData) {
  assertCan("finance.write");
  const returnTo = safeReturnPath(String(formData.get("return_to") ?? ""));

  const parsed = validateAdjustment({
    user_id: String(formData.get("user_id") ?? ""),
    asset_symbol: String(formData.get("asset_symbol") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    deposit_tx_id: String(formData.get("deposit_tx_id") ?? ""),
    notify: String(formData.get("notify") ?? "")
  });
  if (!parsed.ok) go(returnTo, "error", parsed.error);
  const req = parsed.value;

  const verb = req.direction === "credit" ? "Crédit" : "Débit";
  const gate = await gateForm("balance.adjust", formData, `${verb} manuel de ${req.amount} ${req.asset} sur ${req.userId}`);
  if (gate.kind === "pending") go(returnTo, "pending", gate.message);
  if (gate.kind !== "proceed") go(returnTo, "error", gate.message);

  const actor = getCurrentActor();
  const reason = gate.reason;
  const { data, error } = await getSupabaseAdmin().rpc("fn_admin_adjust_balance", {
    p_user_id: req.userId,
    p_asset_symbol: req.asset,
    p_direction: req.direction,
    p_amount: req.amount,
    p_reason: reason,
    p_actor: actor,
    p_deposit_tx_id: req.depositTxId,
    p_notify: req.notify
  });
  const res = (data ?? null) as AdjustResult | null;
  const failure = error?.message || (!res || res.success !== true ? res?.error || "Réponse inattendue de la base." : null);

  await logAdminAction({
    action: req.depositTxId ? "balance.credit_deposit" : req.direction === "credit" ? "balance.credit" : "balance.debit",
    summary: `${verb} manuel ${req.amount} ${req.asset} (motif : ${reason})`,
    target: req.userId,
    changes: failure ? undefined : [{ field: `available_balance ${req.asset}`, before: res?.balance_before ?? null, after: res?.balance_after ?? null }],
    status: failure ? "error" : "success",
    errorMessage: failure ?? undefined
  });

  revalidatePath(`/dashboard/users/${req.userId}`);
  revalidatePath("/dashboard/deposits");
  if (failure) go(returnTo, "error", failure);
  go(returnTo, "saved", `${verb} de ${req.amount} ${req.asset} enregistré. Nouveau solde disponible : ${res?.balance_after ?? "—"} ${req.asset}.`);
}
