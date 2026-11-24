import { getSupabaseAdmin, q } from "@/core/db/data";
import { getCurrentActor } from "@/core/audit";
import { dualControlEnabled, SENSITIVE_ACTIONS, isSensitiveType } from "@/core/approvals/policy";
import { formatDateTime } from "@/core/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th, type Tone } from "@/components/ui";
import { approveRequest, rejectRequest, cancelRequest } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Approval = {
  id: string; action_type: string; summary: string; reason: string; payload: Record<string, unknown>;
  requested_by: string; requested_at: string; expires_at: string; status: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; result: string | null;
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "En attente", tone: "warn" }, approved: { label: "Validée", tone: "info" }, executing: { label: "En cours", tone: "info" },
  executed: { label: "Exécutée", tone: "ok" }, failed: { label: "Échec", tone: "bad" }, rejected: { label: "Refusée", tone: "bad" },
  cancelled: { label: "Annulée", tone: "info" }, expired: { label: "Expirée", tone: "info" }
};

function payloadLine(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload ?? {}).filter(([, v]) => String(v) !== "").map(([k, v]) => `${k} = ${String(v)}`);
  return parts.length ? parts.join(" · ") : "—";
}

export default async function ApprovalsPage({ searchParams }: { searchParams?: { saved?: string; error?: string } }) {
  const db = getSupabaseAdmin();
  const me = getCurrentActor().toLowerCase();
  const [pending, history, admins] = await Promise.all([
    q<Approval>(db.from("admin_approvals").select("*").eq("status", "pending").gt("expires_at", new Date().toISOString()).order("requested_at")),
    q<Approval>(db.from("admin_approvals").select("*").neq("status", "pending").order("requested_at", { ascending: false }).limit(30)),
    q<{ username: string }>(db.from("admin_users").select("username").eq("role", "super_admin").eq("is_active", true))
  ]);
  const on = dualControlEnabled();
  const approvers = admins.rows.length;

  return (
    <div>
      <PageHeader title="Validations" subtitle="Les actions sensibles demandées par un super-admin doivent être validées par un second, avant d'être exécutées." updatedAt={formatDateTime(new Date())} />
      {searchParams?.saved && <div className="wk-alert-ok">{searchParams.saved}</div>}
      <ErrorNote text={searchParams?.error || pending.error || history.error || admins.error} />

      <div className={on ? "wk-alert-ok" : "wk-alert-bad"}>
        {on
          ? `Double validation ACTIVE. Super-admins nominatifs actifs : ${approvers}${approvers < 2 ? " : il en faut au moins 2, sinon aucune action sensible ne peut être exécutée." : "."}`
          : `Double validation DÉSACTIVÉE (ADMIN_DUAL_CONTROL n'est pas à « on »). Le motif reste obligatoire et tracé, mais l'action s'exécute tout de suite. Super-admins nominatifs actifs : ${approvers}.`}
      </div>

      <Section title="À valider" hint={`Actions concernées : ${Object.values(SENSITIVE_ACTIONS).join(" ; ")}. Une demande expire au bout de 24 h.`}>
        {pending.rows.length === 0 ? <Empty text="Aucune demande en attente." /> : (
          <TableWrap>
            <thead><tr><Th>Action</Th><Th>Demandeur et motif</Th><Th hideSm>Valeurs</Th><Th>Décision</Th></tr></thead>
            <tbody>
              {pending.rows.map((a) => {
                const mine = a.requested_by === me;
                return (
                  <tr key={a.id}>
                    <Td label="Action"><strong>{isSensitiveType(a.action_type) ? SENSITIVE_ACTIONS[a.action_type] : a.action_type}</strong><div className="wk-asset-sub">{a.summary}</div></Td>
                    <Td label="Demandeur et motif">{a.requested_by} · {formatDateTime(new Date(a.requested_at))}<div className="wk-asset-sub">« {a.reason} »</div><div className="wk-asset-sub">Expire le {formatDateTime(new Date(a.expires_at))}</div></Td>
                    <Td hideSm label="Valeurs"><span className="wk-asset-sub">{payloadLine(a.payload)}</span></Td>
                    <Td label="Décision">
                      {mine ? (
                        <form action={cancelRequest}>
                          <input type="hidden" name="id" value={a.id} />
                          <div className="wk-asset-sub" style={{ marginBottom: 6 }}>C'est ta demande : une autre personne doit la valider.</div>
                          <button type="submit" className="wk-submit-sm">Annuler ma demande</button>
                        </form>
                      ) : (
                        <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                          <form action={approveRequest} style={{ display: "grid", gap: 6 }}>
                            <input type="hidden" name="id" value={a.id} />
                            <input name="note" className="wk-input" maxLength={300} placeholder="Note (optionnelle)" />
                            <button type="submit" className="wk-submit-sm">Valider et exécuter</button>
                          </form>
                          <form action={rejectRequest} style={{ display: "grid", gap: 6 }}>
                            <input type="hidden" name="id" value={a.id} />
                            <input name="note" required minLength={5} maxLength={300} className="wk-input" placeholder="Motif du refus (obligatoire)" />
                            <button type="submit" className="wk-submit-sm" style={{ background: "var(--bad)" }}>Refuser</button>
                          </form>
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Historique" hint="Les 30 dernières demandes traitées.">
        {history.rows.length === 0 ? <Empty text="Aucune demande traitée." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Action</Th><Th>Demandé par</Th><Th hideSm>Décidé par</Th><Th>Statut</Th><Th hideSm>Détail</Th></tr></thead>
            <tbody>
              {history.rows.map((a) => {
                const st = STATUS[a.status] ?? { label: a.status, tone: "info" as Tone };
                return (
                  <tr key={a.id}>
                    <Td label="Date">{formatDateTime(new Date(a.requested_at))}</Td>
                    <Td label="Action">{isSensitiveType(a.action_type) ? SENSITIVE_ACTIONS[a.action_type] : a.action_type}</Td>
                    <Td label="Demandé par">{a.requested_by}</Td>
                    <Td hideSm label="Décidé par">{a.decided_by ?? "—"}</Td>
                    <Td label="Statut"><Pill tone={st.tone}>{st.label}</Pill></Td>
                    <Td hideSm label="Détail"><span className="wk-asset-sub">{a.result || a.decision_note || `« ${a.reason} »`}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
