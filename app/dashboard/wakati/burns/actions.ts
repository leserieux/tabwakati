"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/data";
import { logAdminAction } from "@/lib/audit";

const PATH = "/dashboard/wakati/burns";
const back = (kind: "saved" | "error", msg: string): never => redirect(`${PATH}?${kind}=1&msg=${encodeURIComponent(msg)}`);

/** Confirme qu'un burn comptable a bien été envoyé à l'adresse de burn on-chain (hash de transaction). */
export async function confirmOnchainBurn(formData: FormData) {
  const id = String(formData.get("id") || "");
  const hash = String(formData.get("tx_hash") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("error", "Identifiant de burn invalide.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) back("error", "Hash invalide : il doit commencer par 0x suivi de 64 caractères hexadécimaux.");

  const db = getSupabaseAdmin();
  const { data, error } = await db.from("token_burns").update({ status: "completed", tx_hash: hash }).eq("id", id).eq("status", "pending_onchain").select("id, amount");
  const ok = !error && !!data && data.length === 1;
  await logAdminAction({
    action: "burn.confirm_onchain",
    summary: `Burn ${id.slice(0, 8)} confirmé on-chain`,
    target: `token_burns#${id}`,
    changes: [{ field: "status", before: "pending_onchain", after: ok ? "completed" : "pending_onchain" }, { field: "tx_hash", before: null, after: ok ? hash : null }],
    status: ok ? "success" : "error",
    errorMessage: error?.message ?? (ok ? undefined : "Burn introuvable ou déjà confirmé")
  });
  revalidatePath(PATH);
  if (!ok) back("error", error?.message ?? "Burn introuvable ou déjà confirmé.");
  back("saved", "Burn confirmé on-chain.");
}

/** Déclenche immédiatement le burn de la cagnotte (le même que la tâche quotidienne). */
export async function burnNow() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("fn_daily_jackpot_burn");
  const res = data as { success?: boolean; burned?: number; wakati_burned?: number; message?: string } | null;
  const ok = !error && res?.success === true;
  await logAdminAction({
    action: "burn.jackpot_now",
    summary: "Burn manuel de la cagnotte jackpot",
    target: "wheel_config#1",
    status: ok ? "success" : "error",
    errorMessage: error?.message
  });
  revalidatePath(PATH);
  if (!ok) back("error", error?.message ?? "Le burn a échoué.");
  back("saved", res?.wakati_burned ? `${res.wakati_burned} WAKATI brûlés (en attente d'envoi on-chain).` : res?.message ?? "Rien à brûler.");
}
