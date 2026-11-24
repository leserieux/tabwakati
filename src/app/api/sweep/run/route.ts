import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, unauthorized, forbidden, canWrite, sessionCan } from "@/core/auth/guards";
import { evaluateGate } from "@/core/approvals/gate";
import { runSweep } from "@/core/sweep";

// Le middleware protège aussi cette route (jeton, session, permission finance.read) ; on revérifie ici.
// Elle appelle la fonction edge Supabase `sweep-deposits`, qui SIGNE ET ENVOIE de vraies
// transactions on-chain quand dryRun=false. Voir supabase/functions/sweep-deposits (déployée
// séparément, pas dans ce dépôt) pour la logique de dérivation et d'envoi.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return unauthorized();
  if (!sessionCan(session, "finance.read")) return forbidden("Ton rôle ne permet pas d'accéder à la collecte des dépôts.");

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // dry-run par défaut, comme la fonction edge elle-même
  // Avant : `role !== "admin"` refusait aussi les « super_admin » (comptes nominatifs). Désormais : super_admin ou ancien admin.
  if (!dryRun && !canWrite(session.role)) {
    return forbidden("Compte sans droit d'écriture : la collecte réelle est réservée aux super-administrateurs.");
  }
  const network: string | undefined = body.network || undefined;
  const userAddressId: string | undefined = body.userAddressId || undefined;

  // Collecte réelle : motif obligatoire, et seconde validation si la double validation est active.
  if (!dryRun) {
    const gate = await evaluateGate({
      type: "sweep.real", summary: `Balayage réel des dépôts${network ? ` (${network})` : ""}`,
      reason: String(body.reason ?? ""), payload: { network: network ?? "", userAddressId: userAddressId ?? "" }
    });
    if (gate.kind === "reason_missing" || gate.kind === "error") return NextResponse.json({ error: gate.message }, { status: 400 });
    if (gate.kind === "pending") return NextResponse.json({ pending_approval: gate.approvalId, message: gate.message }, { status: 202 });
  }

  const result = await runSweep({ dryRun, network, userAddressId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.payload);
}
