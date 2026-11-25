import Link from "next/link";
import { getSupabaseAdmin } from "@/core/db/supabase";
import { hasPermission } from "@/core/auth/permissions";

/** Bandeau affiché sur toutes les pages quand des alertes critiques ou élevées sont actives (rôles autorisés seulement). Silencieux en cas d'erreur. */
export default async function AlertBanner({ role }: { role: string | null }) {
  if (!hasPermission(role, "alerts.read")) return null;
  try {
    const { data } = await getSupabaseAdmin().from("admin_alerts").select("severity").in("status", ["open", "acknowledged"]).in("severity", ["critical", "high"]).limit(200);
    const rows = (data ?? []) as Array<{ severity: string }>;
    if (rows.length === 0) return null;
    const critical = rows.filter((r) => r.severity === "critical").length;
    return (
      <div className="wk-alert-bad" role="alert">
        <strong>{rows.length} alerte(s) active(s)</strong>{critical > 0 ? ` dont ${critical} critique(s)` : ""} : <Link href="/dashboard/alerts">voir les alertes</Link>
      </div>
    );
  } catch {
    return null;
  }
}
