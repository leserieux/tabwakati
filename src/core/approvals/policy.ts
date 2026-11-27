/**
 * Double validation (« quatre yeux ») : quelles actions sont sensibles, et fonctions pures associées
 * (motif, conversion formulaire ⇄ demande, lecture d'une redirection Next). Rien ici ne touche la base.
 */

export const SENSITIVE_ACTIONS = {
  "futures.force_close_all": "Fermer toutes les positions futures",
  "futures.config": "Changer les réglages futures (frais, marges, plafonds)",
  "wakati.burn_now": "Lancer un passage de burn maintenant",
  "wakati.burn_settings": "Changer les réglages du burn",
  "wakati.reserve_settings": "Changer la caisse et le prix du WAKATI",
  "sweep.real": "Balayage réel des dépôts (transactions on-chain)",
  "balance.adjust": "Corriger le solde d'un utilisateur (crédit ou débit manuel)"
} as const;

export type SensitiveType = keyof typeof SENSITIVE_ACTIONS;

export function isSensitiveType(value: string): value is SensitiveType {
  return Object.prototype.hasOwnProperty.call(SENSITIVE_ACTIONS, value);
}

export const MIN_REASON = 5;
export const MAX_REASON = 300;

/** Message d'erreur si le motif est inutilisable, sinon null. */
export function reasonProblem(reason: string | null | undefined): string | null {
  const r = (reason ?? "").trim();
  if (r.length < MIN_REASON) return `Motif obligatoire (${MIN_REASON} caractères minimum) : pourquoi cette action ?`;
  if (r.length > MAX_REASON) return `Motif trop long (${MAX_REASON} caractères maximum).`;
  return null;
}

/** La double validation est active seulement si ADMIN_DUAL_CONTROL=on. Sans cela, le motif reste obligatoire mais l'action s'exécute tout de suite. */
export function dualControlEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADMIN_DUAL_CONTROL === "on";
}

/**
 * Valeurs d'un formulaire à garder dans la demande. On écarte le motif (stocké à part), les champs techniques
 * que Next ajoute aux actions serveur (« $ACTION_… ») et les fichiers.
 */
export function formToPayload(fd: { entries(): Iterable<[string, FormDataEntryValue]> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (key === "reason" || key.startsWith("$ACTION") || typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

export function payloadToFormData(payload: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (typeof value === "string") fd.append(key, value);
  }
  return fd;
}

/** Destination d'une redirection Next (l'erreur lancée par redirect()), ou null si ce n'en est pas une. */
export function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? null;
}
