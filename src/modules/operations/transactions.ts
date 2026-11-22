export const SUCCESS_STATUSES = ["completed", "succeeded", "success", "successful"];
export const PENDING_STATUSES = ["pending", "processing"];

export type TxTone = "ok" | "bad" | "warn";

export function txStatusTone(status: string | null | undefined): TxTone {
  if (!status) return "warn";
  if (status === "failed" || status === "cancelled" || status === "canceled") return "bad";
  if (SUCCESS_STATUSES.includes(status)) return "ok";
  return "warn";
}

export function txStatusLabel(status: string | null | undefined): string {
  if (!status) return "Inconnu";
  if (status === "failed") return "Échec";
  if (status === "cancelled" || status === "canceled") return "Annulé";
  if (SUCCESS_STATUSES.includes(status)) return "Réussi";
  if (PENDING_STATUSES.includes(status)) return "En attente";
  return status;
}

export interface TxFilters {
  q?: string;
  type?: string;
  status?: string;
  asset?: string;
  from?: string;
  to?: string;
}

/** Applique les filtres type/statut/actif/dates à une requête Supabase sur `transactions`. Ne gère pas la recherche texte (voir applyTransactionSearch). */
export function applyTransactionFilters<T extends { eq: any; in: any; gte: any; lte: any }>(builder: T, filters: TxFilters): T {
  let b: any = builder;
  if (filters.type) b = b.eq("type", filters.type);
  if (filters.status === "failed") b = b.eq("status", "failed");
  else if (filters.status === "success") b = b.in("status", SUCCESS_STATUSES);
  else if (filters.status === "pending") b = b.in("status", PENDING_STATUSES);
  if (filters.asset) b = b.eq("asset_symbol", filters.asset);
  if (filters.from) b = b.gte("created_at", filters.from);
  if (filters.to) b = b.lte("created_at", `${filters.to}T23:59:59.999`);
  return b;
}

/**
 * Applique la recherche texte libre : UUID exact (id ou utilisateur), sinon nom d'utilisateur/email
 * (résolu via admin_users_overview) ou hash de transaction (ilike).
 */
export async function applyTransactionSearch<T extends { or: any; ilike: any }>(db: any, builder: T, term: string): Promise<T> {
  const q = term.trim();
  if (!q) return builder;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  if (isUuid) {
    return (builder as any).or(`id.eq.${q},user_id.eq.${q}`);
  }

  const { data: users } = await db
    .from("admin_users_overview")
    .select("id")
    .or(`username.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(50);
  const ids = ((users || []) as { id: string }[]).map((u) => u.id);

  if (ids.length > 0) {
    return (builder as any).or(`user_id.in.(${ids.join(",")}),tx_hash.ilike.%${q}%`);
  }
  return (builder as any).ilike("tx_hash", `%${q}%`);
}

/** Libellé en français pour chaque type de transaction observé en base. */
export const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "Dépôt",
  withdrawal: "Retrait",
  swap_debit: "Échange (débit)",
  swap_credit: "Échange (crédit)",
  staking_lock: "Verrouillage staking",
  staking: "Mise en staking",
  stake: "Mise en staking",
  unstake: "Déblocage staking",
  unstake_request: "Demande de déblocage",
  unstake_completed: "Déblocage terminé",
  staking_reward: "Récompense staking",
  game_win: "Gain au jeu",
  game_bet: "Mise au jeu",
  fee: "Frais",
  referral_bonus: "Bonus de parrainage",
  buy_wakati: "Achat de WAKATI",
  wakati_purchase: "Achat de WAKATI",
  score_loan_repaid: "Remboursement (prêt score)",
  score_loan_borrowed: "Prêt accordé (score)",
  score_loan_fee: "Frais de prêt (score)",
  loan_repaid: "Remboursement de prêt",
  loan_borrowed: "Prêt accordé",
  loan_disbursement: "Prêt versé",
  loan_collateral_lock: "Verrouillage garantie",
  loan_collateral_release: "Libération garantie",
  airtime_purchase: "Crédit téléphonique",
  p2p_transfer: "Transfert P2P",
  admin_reclaim: "Récupération admin",
  balance_adjustment: "Ajustement de solde"
};

export function txTypeLabel(type: string): string {
  return TX_TYPE_LABELS[type] || type;
}
