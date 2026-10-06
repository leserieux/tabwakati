import { cookies, headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/data";
import { getSessionActor, SESSION_COOKIE_NAME } from "@/lib/auth";

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Nom de l'admin actuellement connecté (server-only : lit le cookie de session). */
export function getCurrentActor(): string {
  return getSessionActor(cookies().get(SESSION_COOKIE_NAME)?.value) || "admin";
}

/** Adresse IP du visiteur, du mieux qu'on peut la déduire des en-têtes de proxy (Vercel). */
function getClientIp(): string | undefined {
  const h = headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || undefined;
}

/**
 * Calcule la liste des champs qui changent entre l'état avant et le patch envoyé.
 * Ignore les champs techniques (updated_at, updated_by...) qui ne sont pas des décisions admin.
 */
export function diffFields(
  before: Record<string, any> | null | undefined,
  patch: Record<string, any>,
  ignore: string[] = ["updated_at", "updated_by", "created_at"]
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of Object.keys(patch)) {
    if (ignore.includes(field)) continue;
    const beforeVal = before ? before[field] : undefined;
    const afterVal = patch[field];
    // Comparaison normalisée : évite de logger un "changement" 12 -> "12".
    const same = String(beforeVal ?? "") === String(afterVal ?? "") || (beforeVal ?? null) === (afterVal ?? null);
    if (!same) changes.push({ field, before: beforeVal ?? null, after: afterVal });
  }
  return changes;
}

/**
 * Écrit une ligne dans admin_audit_log. Ne lève jamais d'exception : un échec d'écriture
 * du journal ne doit jamais empêcher ou faire échouer l'action admin elle-même.
 */
export async function logAdminAction(params: {
  actor?: string;
  action: string;
  summary: string;
  target?: string;
  changes?: AuditChange[];
  status: "success" | "error";
  errorMessage?: string;
}): Promise<void> {
  try {
    const actor = params.actor || getCurrentActor();
    await getSupabaseAdmin()
      .from("admin_audit_log")
      .insert({
        actor,
        action: params.action,
        summary: params.summary,
        target: params.target ?? null,
        changes: params.changes && params.changes.length > 0 ? params.changes : null,
        status: params.status,
        error_message: params.errorMessage ?? null,
        ip: getClientIp() ?? null,
        user_agent: headers().get("user-agent") ?? null
      });
  } catch (e) {
    // On log côté serveur (Vercel) mais on ne bloque jamais l'action admin pour ça.
    console.error("[audit] échec d'écriture dans admin_audit_log:", e);
  }
}
