"use server";

import { revalidatePath } from "next/cache";
import { clearCache } from "@/core/cache";

/** Bouton « Actualiser » : vide le cache court des rapports puis recharge la page en cours. */
export async function refreshData(): Promise<void> {
  clearCache();
  revalidatePath("/dashboard", "layout");
}
