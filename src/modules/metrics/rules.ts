/**
 * Règles métier partagées par toute la couche metrics.
 * Une règle = un seul endroit : ne jamais recopier ces filtres dans une page.
 */

/**
 * Trading futures — lignes écrites dans platform_fees par la trésorerie (conservation de l'offre) :
 *   futures_open_fee, futures_funding_fee, futures_close_fee  = VRAIS FRAIS (revenu) → comptés comme frais ;
 *   futures_settlement = PERTE DE TRADING des joueurs (transfert zéro-somme, pas un frais) → exclue des frais :
 *   le P&L l'intègre via les positions clôturées (marge − somme versée − frais), avec les gains payés, une seule fois.
 */
export const FUTURES_PNL_FEE_TYPES = ["futures_settlement"] as const;

/**
 * Types de frais exclus des « frais » du dashboard :
 * - game_house_edge : marge des jeux, déjà comprise dans les mises (sinon double comptage) ;
 * - game_net_loss   : signal de crédit, pas un revenu ;
 * - futures_settlement : PNL de trading des joueurs, intégré au P&L via les positions (voir FUTURES_PNL_FEE_TYPES).
 * Les lignes is_test = true sont toujours exclues.
 */
export const EXCLUDED_FEE_TYPES = ["game_house_edge", "game_net_loss", ...FUTURES_PNL_FEE_TYPES] as const;

/** Valeur à passer à PostgREST : .not("fee_type", "in", FEE_TYPE_EXCLUSION_FILTER) */
export const FEE_TYPE_EXCLUSION_FILTER = `(${EXCLUDED_FEE_TYPES.join(",")})`;

export function isCountedFee(row: { is_test?: boolean | null; fee_type?: string | null }): boolean {
  return !row.is_test && !(EXCLUDED_FEE_TYPES as readonly string[]).includes(String(row.fee_type ?? ""));
}
