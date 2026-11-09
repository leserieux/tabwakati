/**
 * Règles métier partagées par toute la couche metrics.
 * Une règle = un seul endroit : ne jamais recopier ces filtres dans une page.
 */

/**
 * Frais écrits dans platform_fees par le trading futures (conservation de l'offre côté trésorerie).
 * Leur montant est déjà compris dans le résultat réalisé des positions (futures_positions.realized_pnl),
 * que le P&L intègre : les compter aussi comme « frais » serait un double comptage.
 */
export const FUTURES_FEE_TYPES = ["futures_open_fee", "futures_settlement"] as const;

/**
 * Types de frais exclus des « frais » du dashboard :
 * - game_house_edge : marge des jeux, déjà comprise dans les mises (sinon double comptage) ;
 * - game_net_loss   : signal de crédit, pas un revenu ;
 * - futures_*       : déjà compris dans le résultat réalisé des positions futures (voir FUTURES_FEE_TYPES).
 * Les lignes is_test = true sont toujours exclues.
 */
export const EXCLUDED_FEE_TYPES = ["game_house_edge", "game_net_loss", ...FUTURES_FEE_TYPES] as const;

/** Valeur à passer à PostgREST : .not("fee_type", "in", FEE_TYPE_EXCLUSION_FILTER) */
export const FEE_TYPE_EXCLUSION_FILTER = `(${EXCLUDED_FEE_TYPES.join(",")})`;

export function isCountedFee(row: { is_test?: boolean | null; fee_type?: string | null }): boolean {
  return !row.is_test && !(EXCLUDED_FEE_TYPES as readonly string[]).includes(String(row.fee_type ?? ""));
}
