import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

// Cette route n'est pas sous /dashboard : le middleware ne la protège pas, on vérifie la session ici.
// Elle appelle la fonction edge Supabase `sweep-deposits`, qui SIGNE ET ENVOIE de vraies
// transactions on-chain quand dryRun=false. Voir supabase/functions/sweep-deposits (déployée
// séparément, pas dans ce dépôt) pour la logique de dérivation et d'envoi.
export const runtime = "nodejs";
export const maxDuration = 60;

type SweepResult = {
  user_address_id: string;
  asset_symbol: string;
  network: string;
  from_address: string;
  amount: string;
  status: "would_sweep" | "swept" | "skipped" | "error" | "gas_topped_up";
  tx_hash?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // dry-run par défaut, comme la fonction edge elle-même
  const network: string | undefined = body.network || undefined;
  const userAddressId: string | undefined = body.userAddressId || undefined;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants" }, { status: 500 });
  }

  const fnUrl = new URL(`${url}/functions/v1/sweep-deposits`);
  fnUrl.searchParams.set("dry_run", String(dryRun));
  if (network) fnUrl.searchParams.set("network", network);
  if (userAddressId) fnUrl.searchParams.set("user_address_id", userAddressId);

  let payload: { dry_run: boolean; treasuries: Record<string, string>; results: SweepResult[] } | null = null;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(fnUrl.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `Échec HTTP ${res.status}`);
    payload = json;
  } catch (e) {
    errorMessage = (e as Error).message;
  }

  const results = payload?.results ?? [];
  const summary = dryRun
    ? `Aperçu (dry-run) : ${results.length} adresse(s) analysée(s), ${results.filter((r) => r.status === "would_sweep").length} à balayer.`
    : `Balayage RÉEL exécuté : ${results.filter((r) => r.status === "swept").length} transaction(s) envoyée(s), ${results.filter((r) => r.status === "error").length} erreur(s).`;

  await logAdminAction({
    action: dryRun ? "sweep.dry_run" : "sweep.execute",
    summary,
    target: userAddressId ? `user_addresses#${userAddressId}` : network ? `network#${network}` : "all_networks",
    status: errorMessage ? "error" : "success",
    errorMessage: errorMessage ?? undefined
  });

  if (errorMessage) {
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
  return NextResponse.json(payload);
}
