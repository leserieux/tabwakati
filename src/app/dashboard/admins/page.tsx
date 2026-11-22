import { getSupabaseAdmin, q } from "@/core/db/data";
import { can } from "@/core/auth/session";
import { ROLE_LABELS } from "@/core/auth/permissions";
import { formatDateTime } from "@/core/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { createAdmin, setAdminActive, resetAdminPassword } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = { username: string; display_name: string | null; role: string; is_active: boolean; last_login_at: string | null; locked_until: string | null; created_by: string | null; created_at: string };

export default async function AdminsPage({ searchParams }: { searchParams?: { saved?: string; error?: string } }) {
  if (!can("admins.manage")) {
    return (
      <div>
        <PageHeader title="Administrateurs" />
        <Empty text="Cette page est réservée aux super-administrateurs." />
      </div>
    );
  }
  const res = await q<Admin>(getSupabaseAdmin().from("admin_users").select("username, display_name, role, is_active, last_login_at, locked_until, created_by, created_at").order("created_at"));

  return (
    <div>
      <PageHeader title="Administrateurs" subtitle="Un compte par personne, un rôle par compte. Chaque action du journal d'audit est rattachée à son auteur." updatedAt={formatDateTime(new Date())} />
      {searchParams?.saved && <div className="wk-alert-ok">{searchParams.saved}</div>}
      <ErrorNote text={searchParams?.error || res.error} />

      <Section title="Comptes" hint="Après avoir créé les comptes nominatifs, mets ADMIN_LEGACY_LOGIN=off sur Vercel pour couper l'ancien mot de passe partagé.">
        {res.rows.length === 0 ? <Empty text="Aucun compte nominatif : l'ancien mot de passe partagé est toujours le seul accès." /> : (
          <TableWrap>
            <thead><tr><Th>Identifiant</Th><Th>Rôle</Th><Th>État</Th><Th hideSm>Dernière connexion</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {res.rows.map((a) => {
                const locked = a.locked_until && new Date(a.locked_until).getTime() > Date.now();
                return (
                  <tr key={a.username}>
                    <Td label="Identifiant">{a.username}</Td>
                    <Td label="Rôle">{ROLE_LABELS[a.role] ?? a.role}</Td>
                    <Td label="État"><Pill tone={!a.is_active ? "bad" : locked ? "warn" : "ok"}>{!a.is_active ? "Désactivé" : locked ? "Verrouillé" : "Actif"}</Pill></Td>
                    <Td hideSm label="Dernière connexion">{a.last_login_at ? formatDateTime(new Date(a.last_login_at)) : "Jamais"}</Td>
                    <Td label="Actions">
                      <form action={setAdminActive} style={{ display: "inline" }}>
                        <input type="hidden" name="username" value={a.username} />
                        <input type="hidden" name="active" value={a.is_active ? "false" : "true"} />
                        <button type="submit" className="wk-submit-sm">{a.is_active ? "Désactiver" : "Réactiver"}</button>
                      </form>
                      <form action={resetAdminPassword} style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
                        <input type="hidden" name="username" value={a.username} />
                        <input type="password" name="password" className="wk-input" placeholder="Nouveau mot de passe" autoComplete="new-password" style={{ width: 170 }} />
                        <button type="submit" className="wk-submit-sm">Réinitialiser</button>
                      </form>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Nouveau compte">
        <form action={createAdmin} className="wk-panel" style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <label className="wk-label" htmlFor="ad-user">Identifiant</label>
          <input id="ad-user" name="username" className="wk-input" placeholder="ex : aicha" autoComplete="off" />
          <label className="wk-label" htmlFor="ad-name">Nom affiché (optionnel)</label>
          <input id="ad-name" name="display_name" className="wk-input" />
          <label className="wk-label" htmlFor="ad-role">Rôle</label>
          <select id="ad-role" name="role" className="wk-input" defaultValue="viewer">
            <option value="viewer">Lecture seule</option>
            <option value="support">Support</option>
            <option value="finance">Finance</option>
            <option value="risk">Risque &amp; conformité</option>
            <option value="super_admin">Super-admin</option>
          </select>
          <label className="wk-label" htmlFor="ad-pass">Mot de passe initial (12 caractères min., lettres et chiffres)</label>
          <input id="ad-pass" name="password" type="password" className="wk-input" autoComplete="new-password" />
          <button type="submit" className="wk-submit-sm">Créer le compte</button>
        </form>
      </Section>
    </div>
  );
}
