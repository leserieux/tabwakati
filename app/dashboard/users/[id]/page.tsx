import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime, formatNumber, formatUsd, shortId } from "@/lib/format";
import { txStatusLabel, txStatusTone, txTypeLabel } from "@/lib/transactions";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type User = { id: string; username: string | null; email: string | null; created_at: string | null; last_activity_at: string | null };
type Balance = { asset_symbol: string; available_balance: number; staking_balance: number; pending_balance: number };
type Tx = { id: string; type: string; asset_symbol: string; amount: number; fee: number | null; status: string | null; created_at: string; tx_hash: string | null };

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const db = getSupabaseAdmin();
  const [userRes, balances, transactions] = await Promise.all([
    db.from("admin_users_overview").select("id, username, email, created_at, last_activity_at").eq("id", params.id).maybeSingle(),
    q<Balance>(db.from("user_balances").select("asset_symbol, available_balance, staking_balance, pending_balance").eq("user_id", params.id).order("asset_symbol")),
    q<Tx>(db.from("transactions").select("id, type, asset_symbol, amount, fee, status, created_at, tx_hash").eq("user_id", params.id).order("created_at", { ascending: false }).limit(30))
  ]);

  if (userRes.error || !userRes.data) return <div><PageHeader title="Utilisateur introuvable" /><ErrorNote text={userRes.error?.message || "Ce compte n'existe pas ou n'est plus disponible."} /><p><a className="wk-link" href="/dashboard/users">← Retour aux utilisateurs</a></p></div>;
  const user = userRes.data as User;
  const totalByAsset = new Map<string, { available: number; staking: number; pending: number }>();
  for (const row of balances.rows) { const current = totalByAsset.get(row.asset_symbol) || { available: 0, staking: 0, pending: 0 }; current.available += Number(row.available_balance || 0); current.staking += Number(row.staking_balance || 0); current.pending += Number(row.pending_balance || 0); totalByAsset.set(row.asset_symbol, current); }
  const failed = transactions.rows.filter((row) => row.status === "failed").length;
  return <div>
    <PageHeader title={user.username || "Utilisateur"} subtitle={`Compte ${shortId(user.id)} · détail multi-actifs et historique`} updatedAt={formatDateTime(new Date())} />
    <p><a className="wk-link" href="/dashboard/users">← Retour aux utilisateurs</a></p>
    <ErrorNote text={balances.error || transactions.error ? `Certaines données sont indisponibles : ${[balances.error, transactions.error].filter(Boolean).join(" · ")}` : null} />
    <div className="wk-panel"><div className="wk-asset">{user.email || "Email non renseigné"}</div><div className="wk-asset-sub">ID : {user.id}</div><div className="wk-asset-sub">Créé le : {user.created_at ? formatDateTime(new Date(user.created_at)) : "—"} · Dernière activité : {user.last_activity_at ? formatDateTime(new Date(user.last_activity_at)) : "—"}</div></div>
    <Section title="Soldes par actif" hint="Aucune quantité de différents actifs n'est additionnée.">{totalByAsset.size === 0 ? <Empty text="Aucun solde pour cet utilisateur." /> : <TableWrap><thead><tr><Th>Actif</Th><Th right>Disponible</Th><Th right>Staking</Th><Th right>En attente</Th><Th right>Total</Th></tr></thead><tbody>{[...totalByAsset.entries()].map(([asset, value]) => <tr key={asset}><Td label="Actif"><span className="wk-asset">{asset}</span></Td><Td right label="Disponible">{formatNumber(value.available)}</Td><Td right label="Staking">{formatNumber(value.staking)}</Td><Td right label="En attente">{formatNumber(value.pending)}</Td><Td right label="Total">{formatNumber(value.available + value.staking + value.pending)}</Td></tr>)}</tbody></TableWrap>}</Section>
    <Section title="Transactions récentes" hint={`${transactions.rows.length} opération(s) affichée(s)${failed ? ` · ${failed} échec(s)` : ""}`}>
      {transactions.rows.length === 0 ? <Empty text="Aucune transaction pour cet utilisateur." /> : <TableWrap><thead><tr><Th>Date</Th><Th>Type</Th><Th>Actif</Th><Th right>Montant</Th><Th>Statut</Th><Th hideSm>Référence</Th></tr></thead><tbody>{transactions.rows.map((row) => <tr key={row.id}><Td label="Date">{formatDateTime(new Date(row.created_at))}</Td><Td label="Type">{txTypeLabel(row.type)}</Td><Td label="Actif">{row.asset_symbol}</Td><Td right label="Montant">{formatNumber(Number(row.amount))}{row.fee ? <div className="wk-usd">Frais : {formatNumber(Number(row.fee))}</div> : null}</Td><Td label="Statut"><Pill tone={txStatusTone(row.status)}>{txStatusLabel(row.status)}</Pill></Td><Td hideSm label="Référence"><span className="wk-asset-sub">{shortId(row.tx_hash || row.id)}</span></Td></tr>)}</tbody></TableWrap>}
    </Section>
  </div>;
}
