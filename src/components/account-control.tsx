import { getSupabaseAdmin, q } from "@/core/db/data";
import { can } from "@/core/auth/session";
import { formatDateTime } from "@/core/format";
import { setAccountStatus, addUserNote } from "@/app/dashboard/users/[id]/actions";
import { Empty, Pill, Section, type Tone } from "@/components/ui";

type Control = { status: string; reason: string | null; set_by: string | null; set_at: string | null };
type Hist = { id: number; previous_status: string | null; new_status: string; reason: string | null; actor: string; created_at: string };
type Note = { id: number; author: string; note: string; created_at: string };

const LABEL: Record<string, string> = { active: "Actif", withdrawals_blocked: "Retraits bloqués", frozen: "Gelé" };
const TONE: Record<string, Tone> = { active: "ok", withdrawals_blocked: "warn", frozen: "bad" };

/** Contrôle du compte : statut courant, actions (gel / blocage des retraits / réactivation), historique et notes internes. */
export default async function AccountControl({ userId, saved, error }: { userId: string; saved?: string; error?: string }) {
  const db = getSupabaseAdmin();
  const [control, history, notes] = await Promise.all([
    q<Control>(db.from("user_account_controls").select("status, reason, set_by, set_at").eq("user_id", userId).limit(1)),
    q<Hist>(db.from("user_account_control_history").select("id, previous_status, new_status, reason, actor, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10)),
    q<Note>(db.from("user_internal_notes").select("id, author, note, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20))
  ]);
  const current = control.rows[0]?.status ?? "active";
  const canFreeze = can("users.freeze");
  const canNote = can("users.notes");

  return (
    <Section title="Contrôle du compte" hint="Un gel bloque réellement les retraits, envois P2P, achats de crédit et, pour « Gelé », les échanges, paris, stakings et emprunts. Les dépôts restent crédités.">
      {saved && <div className="wk-alert-ok">{saved}</div>}
      {error && <div className="wk-alert-bad">{error}</div>}
      <div className="wk-grid-2">
        <div className="wk-panel">
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <Pill tone={TONE[current] ?? "info"}>{LABEL[current] ?? current}</Pill>
            {control.rows[0]?.set_at && <span className="wk-asset-sub">depuis le {formatDateTime(new Date(control.rows[0].set_at))} par {control.rows[0].set_by}</span>}
          </div>
          {control.rows[0]?.reason && current !== "active" && <p><strong>Motif :</strong> {control.rows[0].reason}</p>}
          {canFreeze ? (
            <form action={setAccountStatus} style={{ display: "grid", gap: 8 }}>
              <input type="hidden" name="user_id" value={userId} />
              <label className="wk-label" htmlFor="ac-status">Nouveau statut</label>
              <select id="ac-status" name="status" className="wk-input" defaultValue={current === "active" ? "withdrawals_blocked" : "active"}>
                <option value="active">Actif (levée des restrictions)</option>
                <option value="withdrawals_blocked">Retraits bloqués</option>
                <option value="frozen">Gelé</option>
              </select>
              <label className="wk-label" htmlFor="ac-reason">Motif (obligatoire sauf réactivation)</label>
              <input id="ac-reason" name="reason" className="wk-input" maxLength={300} placeholder="Ex : activité suspecte signalée, vérification en cours" />
              <button type="submit" className="wk-submit-sm">Appliquer</button>
            </form>
          ) : <p className="wk-asset-sub">Ton rôle ne permet pas de modifier le statut d'un compte.</p>}
        </div>
        <div className="wk-panel">
          <strong>Historique du statut</strong>
          {history.rows.length === 0 ? <Empty text="Aucun changement de statut." /> : (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {history.rows.map((h) => (
                <li key={h.id}>{formatDateTime(new Date(h.created_at))} · {LABEL[h.previous_status ?? "active"] ?? h.previous_status} → <strong>{LABEL[h.new_status] ?? h.new_status}</strong> · {h.actor}{h.reason ? ` · ${h.reason}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="wk-panel" style={{ marginTop: 12 }}>
        <strong>Notes internes</strong>
        {canNote && (
          <form action={addUserNote} style={{ display: "grid", gap: 8, margin: "8px 0" }}>
            <input type="hidden" name="user_id" value={userId} />
            <textarea name="note" className="wk-input" rows={2} maxLength={2000} placeholder="Contexte utile pour l'équipe (visible uniquement des administrateurs)" />
            <button type="submit" className="wk-submit-sm">Ajouter la note</button>
          </form>
        )}
        {notes.rows.length === 0 ? <Empty text="Aucune note." /> : (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {notes.rows.map((n) => <li key={n.id}><span className="wk-asset-sub">{formatDateTime(new Date(n.created_at))} · {n.author}</span><br />{n.note}</li>)}
          </ul>
        )}
      </div>
    </Section>
  );
}
