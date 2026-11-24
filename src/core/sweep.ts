/** Balayage des dépôts : appel de la fonction edge `sweep-deposits` (qui signe et envoie de vraies transactions quand dryRun=false) + journal d'audit. */
import { logAdminAction } from "@/core/audit";

export type SweepResult = {
  user_address_id: string;
  asset_symbol: string;
  network: string;
  from_address: string;
  amount: string;
  status: "would_sweep" | "swept" | "skipped" | "error" | "gas_topped_up";
  tx_hash?: string;
  error?: string;
};

export type SweepPayload = { dry_run: boolean; treasuries: Record<string, string>; results: SweepResult[] };

export async function runSweep(p: { dryRun: boolean; network?: string; userAddressId?: string }): Promise<{ ok: true; payload: SweepPayload; summary: string } | { ok: false; error: string }> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants" };

  const fnUrl = new URL(`${url}/functions/v1/sweep-deposits`);
  fnUrl.searchParams.set("dry_run", String(p.dryRun));
  if (p.network) fnUrl.searchParams.set("network", p.network);
  if (p.userAddressId) fnUrl.searchParams.set("user_address_id", p.userAddressId);

  let payload: SweepPayload | null = null;
  let errorMessage: string | null = null;
  try {
    const res = await fetch(fnUrl.toString(), { method: "POST", headers: { Authorization: `Bearer ${serviceKey}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || `Échec HTTP ${res.status}`);
    payload = json;
  } catch (e) {
    errorMessage = (e as Error).message;
  }

  const results = payload?.results ?? [];
  const summary = p.dryRun
    ? `Aperçu (dry-run) : ${results.length} adresse(s) analysée(s), ${results.filter((r) => r.status === "would_sweep").length} à balayer.`
    : `Balayage RÉEL exécuté : ${results.filter((r) => r.status === "swept").length} transaction(s) envoyée(s), ${results.filter((r) => r.status === "error").length} erreur(s).`;

  await logAdminAction({
    action: p.dryRun ? "sweep.dry_run" : "sweep.execute",
    summary,
    target: p.userAddressId ? `user_addresses#${p.userAddressId}` : p.network ? `network#${p.network}` : "all_networks",
    status: errorMessage ? "error" : "success",
    errorMessage: errorMessage ?? undefined
  });

  if (errorMessage || !payload) return { ok: false, error: errorMessage ?? "Réponse vide" };
  return { ok: true, payload, summary };
}
