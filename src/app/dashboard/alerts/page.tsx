import { getSupabaseAdmin, q } from "@/core/db/data";
import { can } from "@/core/auth/session";
import { formatDateTime } from "@/core/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th, type Tone } from "@/components/ui";
import { acknowledgeAlert, resolveAlert } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Alert = {
  id: number; category: string; severity: string; title: string; details: Record<string, unknown>; status: string;
  occurrences: number; first_seen_at: string; last_seen_at: string;
  acknowledged_by: string | null; acknowledged_at: string | null; resolved_by: string | null; resolved_at: string | null; resolution_note: string | null;
};

const SEVERITY: Record<string, { label: string; tone: Tone; rank: number }> = {
  critical: { label: "Critique", tone: "bad", rank: 0 }, high: { label: "Élevée", tone: "bad", rank: 1 },
  medium: { label: "Moyenne", tone: "warn", rank: 2 }, low: { label: "Faible", tone: "info", rank: 3 }, info: { label: "Info", tone: "info", rank: 4 }
};
const CATEGORY: Record<string, string> = {
  ledger: "Grand livre", assets: "Soldes par actif", data: "Lecture de données", risk: "Risque utilisateurs", price_feed: "Flux de prix", security: "Sécurité", audit: "Journal d'audit"
};

function detailLine(d: Record<string, unknown>): string {
  return Object.entries(d ?? {}).filter(([k, v]) => k !== "sample" && typeof v !== "object" && String(v) !== "").map(([k, v]) => `${k} = ${String(v)}`).join(" · ");
}

export default async function AlertsPage({ searchParams }: { searchParams?: { saved?: string; error?: string } }) {
  const db = getSupabaseAdmin();
  const [active, resolved] = await Promise.all([
    q<Alert>(db.from("admin_alerts").select("*").in("status", ["open", "acknowledged"]).order("last_seen_at", { ascending: false }).limit(200)),
    q<Alert>(db.from("admin_alerts").select("*").eq("status", "resolved").order("resolved_at", { ascending: false }).limit(20))
  ]);
  const rows = [...active.rows].sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9));
  const critical = rows.filter((a) => a.severity === "critical").length;
  const canHandle = can("alerts.handle");

  return (
    <div>
      <PageHeader title="Alertes" subtitle="Contrôles automatiques toutes les 10 minutes : grand livre, soldes par actif, risque, prix, sécurité et intégrité du journal d'audit. Une alerte se ferme toute seule quand le problème disparaît." updatedAt={formatDateTime(new Date())} />
      {searchParams?.saved && <div className="wk-alert-ok">{searchParams.saved}</div>}
      <ErrorNote text={searchParams?.error || active.error || resolved.error} />
      {rows.length === 0 && !active.error && <div className="wk-alert-ok">Aucune alerte active : tous les contrôles automatiques sont au vert.</div>}
      {critical > 0 && <div className="wk-alert-bad">{critical} alerte(s) critique(s) : à traiter en priorité.</div>}

      <Section title={`Alertes actives (${rows.length})`} hint="Prendre en charge = tu t'en occupes (elle reste visible). Résoudre = clôturer avec une note ; si le problème persiste, elle revient au contrôle suivant.">
        {rows.length === 0 ? <Empty text="Rien à traiter." /> : (
          <TableWrap>
            <thead><tr><Th>Gravité</Th><Th>Alerte</Th><Th hideSm>Depuis</Th><Th>Action</Th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const sev = SEVERITY[a.severity] ?? { label: a.severity, tone: "info" as Tone, rank: 9 };
                return (
                  <tr key={a.id}>
                    <Td label="Gravité"><Pill tone={sev.tone}>{sev.label}</Pill></Td>
                    <Td label="Alerte">
                      <strong>{a.title}</strong>
                      <div className="wk-asset-sub">{CATEGORY[a.category] ?? a.category}{a.occurrences > 1 ? ` · vue ${a.occurrences} fois` : ""}</div>
                      <div className="wk-asset-sub">{detailLine(a.details)}</div>
                      {a.status === "acknowledged" && <div className="wk-asset-sub">Prise en charge par {a.acknowledged_by}{a.acknowledged_at ? ` le ${formatDateTime(new Date(a.acknowledged_at))}` : ""}</div>}
                    </Td>
                    <Td hideSm label="Depuis">{formatDateTime(new Date(a.first_seen_at))}<div className="wk-asset-sub">dernier contrôle : {formatDateTime(new Date(a.last_seen_at))}</div></Td>
                    <Td label="Action">
                      {canHandle ? (
                        <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                          {a.status === "open" && (
                            <form action={acknowledgeAlert}>
                              <input type="hidden" name="id" value={a.id} />
                              <button type="submit" className="wk-submit-sm">Prendre en charge</button>
                            </form>
                          )}
                          <form action={resolveAlert} style={{ display: "grid", gap: 6 }}>
                            <input type="hidden" name="id" value={a.id} />
                            <input name="note" required minLength={5} maxLength={300} className="wk-input" placeholder="Note de résolution (obligatoire)" />
                            <button type="submit" className="wk-submit-sm">Résoudre</button>
                          </form>
                        </div>
                      ) : <span className="wk-asset-sub">Lecture seule</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Résolues récemment" hint="Les 20 dernières. « système » = la condition a disparu d'elle-même.">
        {resolved.rows.length === 0 ? <Empty text="Aucune alerte résolue pour le moment." /> : (
          <TableWrap>
            <thead><tr><Th>Alerte</Th><Th>Résolue</Th><Th hideSm>Note</Th></tr></thead>
            <tbody>
              {resolved.rows.map((a) => (
                <tr key={a.id}>
                  <Td label="Alerte">{a.title}<div className="wk-asset-sub">{CATEGORY[a.category] ?? a.category}</div></Td>
                  <Td label="Résolue">{a.resolved_at ? formatDateTime(new Date(a.resolved_at)) : "—"}<div className="wk-asset-sub">par {a.resolved_by ?? "—"}</div></Td>
                  <Td hideSm label="Note"><span className="wk-asset-sub">{a.resolution_note ?? "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
