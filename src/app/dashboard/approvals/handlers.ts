import { redirect } from "next/navigation";
import { forceCloseAll, updateFuturesConfig } from "@/app/dashboard/futures/actions";
import { burnNow, updateBurnSettings, updateReserveSettings } from "@/app/dashboard/wakati/burns/actions";
import { adjustBalance } from "@/app/dashboard/balances/actions";
import { runSweep } from "@/core/sweep";
import type { Handlers } from "@/core/approvals/executor";

/**
 * Registre : type de demande → action d'origine, rejouée telle quelle avec les valeurs enregistrées.
 * Ajouter une action sensible = l'ajouter dans core/approvals/policy.ts ET ici (TypeScript refuse sinon).
 */
export const HANDLERS: Handlers = {
  "futures.force_close_all": forceCloseAll,
  "futures.config": updateFuturesConfig,
  "wakati.burn_now": burnNow,
  "wakati.burn_settings": updateBurnSettings,
  "wakati.reserve_settings": updateReserveSettings,
  "balance.adjust": adjustBalance,
  "sweep.real": async (fd) => {
    const result = await runSweep({ dryRun: false, network: String(fd.get("network") ?? "") || undefined, userAddressId: String(fd.get("userAddressId") ?? "") || undefined });
    // Même convention que les autres actions : l'issue est lue dans la redirection.
    if (!result.ok) redirect(`/dashboard/sweep?error=1&msg=${encodeURIComponent(result.error)}`);
    redirect(`/dashboard/sweep?saved=1&msg=${encodeURIComponent(result.summary)}`);
  }
};
