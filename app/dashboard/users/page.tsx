import { getSupabaseAdmin, q } from "@/lib/data";
import { loadUserAssetSummaries } from "@/lib/assets";
import { formatCompactNumber, formatDateTime, shortId } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;
const DAY = 24 * 3600 * 1000;

type UserRow = {
  id: string;
  username: string;
  email: string | null;
  country_code: string | null;
  is_verified: boolean;
  email_confirmed: boolean;
  profile_completed: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type BalanceRow = { user_id: string; available_balance: number; staking_balance: number; pending_balance: number };

export default async function UsersPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const db = getSupabaseAdmin();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const term = (searchParams.q || "").trim();

  let query = db
    .from("users")
    .select("id, username, email, country_code, is_verified, email_confirmed, profile_completed, created_at, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (term) query = query.or(`username.ilike.%${term}%,email.ilike.%${term}%`);

  const [usersRes, balances, assets] = await Promise.all([
    query,
    q<BalanceRow>(db.from("user_balances").select("user_id, available_balance, staking_balance, pending_balance")),
    loadUserAssetSummaries()
  ]);

  const rows = (usersRes.data || []) as UserRow[];
  const total = usersRes.count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const balanceUsers = new Set<string>();
  for (const row of balances.rows) {
    if (Number(row.available_balance || 0) + Number(row.staking_balance || 0) + Number(row.pending_balance || 0) > 0) balanceUsers.add(row.user_id);
  }

  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const active7d = rows.filter((u) => u.updated_at && u.updated_at >= since7d).length;
  const verified = rows.filter((u) => u.is_verified).length;
  const new7d = rows.filter((u) => u.created_at && u.created_at >= since7d).length;

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/dashboard/users${qs ? `?${qs}` : ""}`;
  }

  return (
    <div>
      <PageHeader title="Utilisateurs" subtitle="Comptes, vérification et soldes multi-actifs de la plateforme." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={usersRes.error || balances.error || assets.error ? `Certaines données sont indisponibles : ${[usersRes.error, balances.error, assets.error].filter(Boolean).join(" · ")}` : null} />

      <div className="wk-strip">
        <StatCard label="Total comptes" value={formatCompactNumber(total)} sub="Depuis public.users" />
        <StatCard label="Actifs 7j" value={formatCompactNumber(active7d)} sub="Selon updated_at" />
        <StatCard label="Nouveaux 7j" value={formatCompactNumber(new7d)} sub="Comptes créés" />
        <StatCard label="Vérifiés" value={formatCompactNumber(verified)} sub={`${assets.rows.length} actif(s) configuré(s)`} />
      </div>

      <Section title="Recherche">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label className="wk-label" htmlFor="q">Nom ou email</label>
            <input id="q" name="q" type="text" defaultValue={term} placeholder="Rechercher un utilisateur" className="wk-input" />
          </div>
          <button type="submit" className="wk-btn">Rechercher</button>
          {term && <a href="/dashboard/users" className="wk-link">Réinitialiser</a>}
        </form>
      </Section>

      <Section title="Comptes" hint={`${total} résultat(s).`}>
        {rows.length === 0 ? <Empty text="Aucun utilisateur trouvé." /> : (
          <>
            <TableWrap>
              <thead><tr><Th>Utilisateur</Th><Th>Pays</Th><Th>Créé le</Th><Th>Profil</Th><Th>Solde</Th><Th>Statut</Th></tr></thead>
              <tbody>{rows.map((user) => {
                const recent = !!user.updated_at && new Date(user.updated_at).getTime() >= now - 30 * DAY;
                return <tr key={user.id}>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${user.id}`}><div className="wk-asset">{user.username}</div><div className="wk-asset-sub">{user.email || shortId(user.id)}</div></a></Td>
                  <Td label="Pays">{user.country_code || "—"}</Td>
                  <Td label="Créé le">{user.created_at ? formatDateTime(new Date(user.created_at)) : "—"}</Td>
                  <Td label="Profil"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{user.email_confirmed && <Pill tone="ok">Email</Pill>}{user.profile_completed && <Pill tone="info">Profil</Pill>}{user.is_verified && <Pill tone="ok">Vérifié</Pill>}</div></Td>
                  <Td label="Solde">{balanceUsers.has(user.id) ? <Pill tone="info">Actifs détenus</Pill> : <span className="wk-asset-sub">Aucun solde</span>}</Td>
                  <Td label="Statut">{recent ? <Pill tone="ok">Actif</Pill> : <Pill tone="warn">Inactif récent</Pill>}</Td>
                </tr>;
              })}</tbody>
            </TableWrap>
            {totalPages > 1 && <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}><span className="wk-asset-sub">Page {page} sur {totalPages}</span><div style={{ display: "flex", gap: 10 }}>{page > 1 && <a href={pageHref(page - 1)} className="wk-link">← Précédent</a>}{page < totalPages && <a href={pageHref(page + 1)} className="wk-link">Suivant →</a>}</div></div>}
          </>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="wk-strip-item"><div className="wk-strip-label">{label}</div><div className="wk-strip-value">{value}</div><div className="wk-strip-sub">{sub}</div></div>;
}
