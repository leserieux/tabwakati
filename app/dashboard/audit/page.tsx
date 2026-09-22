import { getSupabaseAdmin } from "@/lib/data";
import { formatDateTime, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type AuditRow = {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  summary: string;
  target: string | null;
  changes: { field: string; before: unknown; after: unknown }[] | null;
  status: "success" | "error";
  error_message: string | null;
  ip: string | null;
};

/** Rend une valeur de champ audité de façon lisible (booléens, null, objets...). */
function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function AuditPage({
  searchParams
}: {
  searchParams: { actor?: string; status?: string; page?: string };
}) {
  const db = getSupabaseAdmin();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (searchParams.actor) query = query.ilike("actor", `%${searchParams.actor}%`);
  if (searchParams.status === "success" || searchParams.status === "error") query = query.eq("status", searchParams.status);

  const { data, error, count } = await query;
  const rows = (data || []) as AuditRow[];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (searchParams.actor) params.set("actor", searchParams.actor);
    if (searchParams.status) params.set("status", searchParams.status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/dashboard/audit${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <PageHeader
        title="Journal d'audit"
        subtitle="Toutes les actions effectuées depuis la console admin : qui, quoi, quand, et ce qui a changé."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={error ? `Le journal n'a pas pu être lu : ${error.message}. Vérifie que la table admin_audit_log existe (voir supabase/migrations).` : null} />

      <Section title="Filtrer">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="wk-label" htmlFor="actor">Admin</label>
            <input id="actor" name="actor" type="text" defaultValue={searchParams.actor || ""} placeholder="Ex : Yannick" className="wk-input" style={{ width: 200 }} />
          </div>
          <div>
            <label className="wk-label" htmlFor="status">Statut</label>
            <select id="status" name="status" defaultValue={searchParams.status || ""} className="wk-input" style={{ width: 160 }}>
              <option value="">Tous</option>
              <option value="success">Réussi</option>
              <option value="error">Échec</option>
            </select>
          </div>
          <button type="submit" className="wk-btn">Filtrer</button>
          {(searchParams.actor || searchParams.status) && <a href="/dashboard/audit" className="wk-link">Réinitialiser</a>}
        </form>
      </Section>

      <Section title="Actions" hint={`${total} action${total > 1 ? "s" : ""} enregistrée${total > 1 ? "s" : ""}.`}>
        {rows.length === 0 ? (
          <Empty text="Aucune action trouvée pour ces filtres." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Admin</Th>
                  <Th>Action</Th>
                  <Th>Détail</Th>
                  <Th>Statut</Th>
                  <Th hideSm>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td label="Date">{formatDateTime(new Date(r.created_at))}</Td>
                    <Td label="Admin">{r.actor}</Td>
                    <Td label="Action">
                      <div className="wk-asset">{r.summary}</div>
                      <div className="wk-asset-sub">{r.action}{r.target ? ` · ${r.target}` : ""}</div>
                    </Td>
                    <Td label="Détail">
                      {r.status === "error" ? (
                        <span style={{ color: "var(--bad)" }}>{r.error_message || "Erreur inconnue"}</span>
                      ) : r.changes && r.changes.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13.5 }}>
                          {r.changes.map((c, i) => (
                            <li key={i}>
                              <strong>{c.field}</strong> : {renderValue(c.before)} → {renderValue(c.after)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="wk-asset-sub">—</span>
                      )}
                    </Td>
                    <Td label="Statut">
                      {r.status === "error" ? <Pill tone="bad">Échec</Pill> : <Pill tone="ok">Réussi</Pill>}
                    </Td>
                    <Td label="IP" hideSm>
                      <span className="wk-asset-sub">{r.ip || "—"}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <span className="wk-asset-sub">Page {page} sur {totalPages}</span>
                <div style={{ display: "flex", gap: 10 }}>
                  {page > 1 && <a href={pageHref(page - 1)} className="wk-link">← Précédent</a>}
                  {page < totalPages && <a href={pageHref(page + 1)} className="wk-link">Suivant →</a>}
                </div>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
