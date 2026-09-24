import { getSupabaseAdmin, q } from "@/lib/data";
import { formatCompactNumber, formatDateTime, formatNumber, formatToken, shortId } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const DAY = 24 * 3600 * 1000;

type UserRow = {
  id: string;
  username: string | null;
  email: string | null;
  created_at: string | null;
  last_activity_at: string | null;
};

export default async function UsersPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const db = getSupabaseAdmin();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const term = (searchParams.q || "").trim();

  let query = db
    .from("admin_users_overview")
    .select("id, username, email, created_at, last_activity_at", { count: "exact" })
    .order("last_activity_at", { ascending: false })
    .range(from, to);

  if (term) {
    query = query.or(`username.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const [usersRes, balancesRes] = await Promise.all([
    query,
    q<{ user_id: string; available_balance: number; staking_balance: number; pending_balance: number }>(
      db.from("user_balances").select("user_id, available_balance, staking_balance, pending_balance").eq("asset_symbol", "WAKATI")
    )
  ]);

  const rows = (usersRes.data || []) as UserRow[];
  const total = usersRes.count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const balanceByUser = new Map<string, number>();
  for (const row of balancesRes.rows) {
    const userId = String(row.user_id || "");
    const current = balanceByUser.get(userId) || 0;
    const totalBalance = Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0);
    balanceByUser.set(userId, current + totalBalance);
  }

  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const active7d = rows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const new7d = rows.filter((u) => u.created_at && u.created_at >= since7d).length;
  const totalWakati = [...balanceByUser.values()].reduce((sum, v) => sum + v, 0);
  const holders = [...balanceByUser.values()].filter((v) => v > 0).length;

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/dashboard/users${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <PageHeader title="Utilisateurs" subtitle="Vue d'ensemble des comptes de la plateforme, leurs actifs et leur activité." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={usersRes.error ? `Les utilisateurs n'ont pas pu être lus : ${usersRes.error.message}` : null} />

      <div className="wk-strip">
        <StatCard label="Total comptes" value={formatCompactNumber(total)} sub="Tous les comptes" />
        <StatCard label="Actifs 7j" value={formatCompactNumber(active7d)} sub="Dernière activité récente" />
        <StatCard label="Nouveaux 7j" value={formatCompactNumber(new7d)} sub="Comptes créés récemment" />
        <StatCard label="WAKATI en app" value={formatToken(totalWakati)} sub={`${holders} détenteur(s)`} />
      </div>

      <Section title="Recherche">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label className="wk-label" htmlFor="q">Recherche</label>
            <input id="q" name="q" type="text" defaultValue={term} placeholder="Nom d'utilisateur ou email" className="wk-input" />
          </div>
          <button type="submit" className="wk-btn">Rechercher</button>
          {term && <a href="/dashboard/users" className="wk-link">Réinitialiser</a>}
        </form>
      </Section>

      <Section title="Comptes" hint={`${total} résultat(s) trouvé(s).`}>
        {rows.length === 0 ? (
          <Empty text="Aucun utilisateur trouvé pour ces filtres." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Utilisateur</Th>
                  <Th>Email</Th>
                  <Th>Créé le</Th>
                  <Th>Dernière activité</Th>
                  <Th right>WAKATI</Th>
                  <Th>Statut</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => {
                  const wakati = balanceByUser.get(user.id) || 0;
                  const hasRecentActivity = !!user.last_activity_at && new Date(user.last_activity_at).getTime() > now - 30 * DAY;
                  return (
                    <tr key={user.id}>
                      <Td label="Utilisateur">
                        <div className="wk-asset">{user.username || "Sans pseudo"}</div>
                        <div className="wk-asset-sub">{shortId(user.id)}</div>
                      </Td>
                      <Td label="Email">
                        <span className="wk-asset-sub">{user.email || "—"}</span>
                      </Td>
                      <Td label="Créé le">{user.created_at ? formatDateTime(new Date(user.created_at)) : "—"}</Td>
                      <Td label="Dernière activité">{user.last_activity_at ? formatDateTime(new Date(user.last_activity_at)) : "—"}</Td>
                      <Td right label="WAKATI">{formatToken(wakati)}</Td>
                      <Td label="Statut">
                        {hasRecentActivity ? <Pill tone="ok">Actif</Pill> : <Pill tone="warn">Peu actif</Pill>}
                      </Td>
                    </tr>
                  );
                })}
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

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className="wk-strip-value">{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}



































































































































































































































































{