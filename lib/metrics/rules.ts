/**
 * Règles métier partagées par toute la couche metrics.
 * Une règle = un seul endroit : ne jamais recopier ces filtres dans une page.
 */

/**
 * Types de frais exclus des « frais » du dashboard :
 * - game_house_edge : marge des jeux, déjà comprise dans les mises (sinon double comptage) ;
 * - game_net_loss   : signal de crédit, pas un revenu.
 * Les lignes is_test = true sont toujours exclues.
 */
export const EXCLUDED_FEE_TYPES = ["game_house_edge", "game_net_loss"] as const;

/** Valeur à passer à PostgREST : .not("fee_type", "in", FEE_TYPE_EXCLUSION_FILTER) */
export const FEE_TYPE_EXCLUSION_FILTER = `(${EXCLUDED_FEE_TYPES.join(",")})`;

export function isCountedFee(row: { is_test?: boolean | null; fee_type?: string | null }): boolean {
  return !row.is_test && !(EXCLUDED_FEE_TYPES as readonly string[]).includes(String(row.fee_type ?? ""));
}
