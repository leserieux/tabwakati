import { getSupabaseAdmin } from "@/lib/data";
import type { Line } from "@/lib/solvency";
import { formatNumber } from "@/lib/format";

/**
 * Dernière valeur connue d'un actif dont la lecture en direct a échoué : d'abord la dernière lecture complète de cette instance serveur
 * (`Line.lastKnown`), sinon le dernier relevé quotidien de la Réserve de retrait (table custody_snapshots).
 * Information seulement : elle n'entre jamais dans un calcul de couverture ou d'approvisionnement.
 */
export interface LastKnown {
  have: number;
  label: string; // « il y a 12 min » ou « relevé du 2026-11-21 »
  source: "live" | "snapshot";
}

export function ageLabel(ms: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return "il y a moins d'une minute";
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
}

export async function loadLastKnown(lines: Line[]): Promise<Map<string, LastKnown>> {
  const out = new Map<string, LastKnown>();
  const missing: Line[] = [];
  for (const l of lines) {
    if (l.have !== null) continue;
    if (l.lastKnown) out.set(l.label, { have: l.lastKnown.have, label: ageLabel(l.lastKnown.at), source: "live" });
    else missing.push(l);
  }
  if (missing.length === 0) return out;
  try {
    const symbols = [...new Set(missing.map((l) => l.asset))];
    const { data } = await getSupabaseAdmin()
      .from("custody_snapshots")
      .select("snapshot_date, asset_symbol, have")
      .in("asset_symbol", symbols)
      .not("have", "is", null)
      .order("snapshot_date", { ascending: false })
      .limit(symbols.length * 4);
    const firstBySymbol = new Map<string, { snapshot_date: string; have: number }>();
    for (const r of (data as any[]) || []) if (!firstBySymbol.has(r.asset_symbol)) firstBySymbol.set(r.asset_symbol, { snapshot_date: r.snapshot_date, have: Number(r.have) });
    for (const l of missing) {
      const r = firstBySymbol.get(l.asset);
      if (r && Number.isFinite(r.have)) out.set(l.label, { have: r.have, label: `relevé du ${r.snapshot_date}`, source: "snapshot" });
    }
  } catch {
    // information facultative : on n'affiche simplement rien
  }
  return out;
}

/** « Dernière valeur connue : 1 250 USDC (il y a 12 min). Ne sert à aucun calcul. » */
export function lastKnownText(l: Line, k: LastKnown | undefined): string | null {
  if (!k) return null;
  const pct = l.owe > 1e-8 ? ` soit environ ${Math.round((k.have / l.owe) * 100)} % du dû` : "";
  return `Dernière valeur connue : ${formatNumber(k.have)} ${l.asset} (${k.label})${pct}. Information seulement.`;
}
