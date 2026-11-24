/** Exécution d'une demande validée : rejoue l'action d'origine avec les valeurs enregistrées, dans le contexte « rejeu » de la barrière. */
import { runAsApproved } from "@/core/approvals/gate";
import { isSensitiveType, payloadToFormData, redirectTarget, type SensitiveType } from "@/core/approvals/policy";

export type ApprovedAction = { id: string; action_type: string; reason: string; payload: Record<string, unknown> };
export type Handlers = Record<SensitiveType, (formData: FormData) => Promise<unknown>>;

/**
 * Les actions se terminent par un redirect() (qui lève une erreur spéciale) : on lit sa destination pour savoir si
 * elle a réussi (`?saved=`, `?pending=` ne devrait pas arriver ici) ou échoué (`?error=`).
 */
export async function executeApproved(a: ApprovedAction, handlers: Handlers): Promise<{ ok: boolean; message: string }> {
  if (!isSensitiveType(a.action_type)) return { ok: false, message: `Type d'action inconnu : ${a.action_type}` };
  try {
    await runAsApproved({ approvalId: a.id, reason: a.reason }, () => handlers[a.action_type as SensitiveType](payloadToFormData(a.payload)));
    return { ok: true, message: "Exécutée" };
  } catch (e) {
    const target = redirectTarget(e);
    if (target) {
      const params = new URL(target, "http://local").searchParams;
      const failure = params.get("error");
      if (failure) return { ok: false, message: params.get("msg") || failure };
      return { ok: true, message: params.get("saved") || params.get("msg") || "Exécutée" };
    }
    return { ok: false, message: (e as Error).message };
  }
}
