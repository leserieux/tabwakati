import { getSupabaseAdmin, q, loadPrices } from "@/lib/data";
import { formatDateTime, formatNumber, formatUsd, shortId } from "@/lib/format";
import { txStatusLabel, txStatusTone, txTypeLabel } from "@/lib/transactions";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type User = { id: string; username: string | null; email: string | null; created_at: string | null; last_activity_at: string | null };
type Balance = { asset_symbol: string; available_balance: number; staking_balance: number; pending_balance: number };
type Tx = { id: string; type: string; asset_symbol: string; amount: number; fee: number | null; status: string | null; created_at: string; tx_hash: string | null };
type AssetBalance = { asset: string; available: number; staking: number; pending: number; total: number; priceUsd: number | null; valueUsd: number | null };

export default async function UserDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { asset?: string } }) {
  const db = getSupabaseAdmin();
  const selectedAsset = (searchParams.asset || "").trim();
  const [userRes, balances, transactions, prices] = await Promise.all([
    db.from("admin_users_overview").select("id, username, email, created_at, last_activity_at").eq("id", params.id).maybeSingle(),
    q<Balance>(db.from("user_balances").select("asset_symbol, available_balance, staking_balance, pending_balance").eq("user_id", params.id).order("asset_symbol")),
    q<Tx>(db.from("transactions").select("id, type, asset_symbol, amount, fee, status, created_at, tx_hash").eq("user_id", params.id).order("created_at", { ascending: false }).limit(100)),
    loadPrices()
  ]);

  if (userRes.error || !userRes.data) return <div><PageHeader title="Utilisateur introuvable" /><ErrorNote text={userRes.error?.message || "Ce compte n'existe pas ou n'est plus disponible."} /><p><a className="wk-link" href="/dashboard/users">← Retour aux utilisateurs</a></p></div>;
  const user = userRes.data as User;
  const assetBalances = new Map<string, { available: number; staking: number; pending: number }>();
  for (const row of balances.rows) {
    const current = assetBalances.get(row.asset_symbol) || { available: 0, staking: 0, pending: 0 };
    current.available += Number(row.available_balance || 0); current.staking += Number(row.staking_balance || 0); current.pending += Number(row.pending_balance || 0);
    assetBalances.set(row.asset_symbol, current);
  }
  const assets: AssetBalance[] = [...assetBalances.entries()].map(([asset, value]) => {
    const total = value.available + value.staking + value.pending; const priceUsd = prices.get(asset) ?? null;
    return { asset, ...value, total, priceUsd, valueUsd: priceUsd === null ? null : total * priceUsd };
  }).sort((a, b) => b.total - a.total);
  const visibleTransactions = selectedAsset ? transactions.rows.filter((row) => row.asset_symbol === selectedAsset) : transactions.rows;
  const totalUsd = assets.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);
  const failed = visibleTransactions.filter((row) => row.status === "failed").length;
  const assetHref = (asset?: string) => asset ? `/dashboard/users/${params.id}?asset=${encodeURIComponent(asset)}` : `/dashboard/users/${params.id}`;
  const exportHref = `/api/users/${params.id}/transactions/export${selectedAsset ? `?asset=${encodeURIComponent(selectedAsset)}` : ""}`;

  return <div>
    <PageHeader title={user.username || "Utilisateur"} subtitle={`Compte ${shortId(user.id)} · détail multi-actifs et historique`} updatedAt={formatDateTime(new Date())} />
    <p><a className="wk-link" href="/dashboard/users">← Retour aux utilisateurs</a></p>
    <ErrorNote text={balances.error || transactions.error ? `Certaines données sont indisponibles : ${[balances.error, transactions.error].filter(Boolean).join(" · ")}` : null} />
    <div className="wk-panel" style={{ marginBottom: 18 }}><div className="wk-asset">{user.email || "Email non renseigné"}</div><div className="wk-asset-sub">ID : {user.id}</div><div className="wk-asset-sub">Créé le : {user.created_at ? formatDateTime(new Date(user.created_at)) : "—"} · Dernière activité : {user.last_activity_at ? formatDateTime(new Date(user.last_activity_at)) : "—"}</div></div>
    <div className="wk-strip"><StatCard label="Solde total" value={formatUsd(totalUsd)} sub="Valorisation USD" /><StatCard label="Actifs détenus" value={String(assets.filter((row) => row.total > 0).length)} sub="Catégories actives" /><StatCard label="Transactions" value={String(visibleTransactions.length)} sub={selectedAsset ? `Actif : ${selectedAsset}` : "Dernières 100 opérations"} /><StatCard label="Échecs" value={String(failed)} sub="Dans le filtre courant" tone={failed > 0 ? "bad" : "ok"} /></div>
    <Section title="Soldes par actif" hint="Sélectionnez un actif pour filtrer son historique.">{assets.length === 0 ? <Empty text="Aucun solde pour cet utilisateur." /> : <TableWrap><thead><tr><Th>Actif</Th><Th right>Prix</Th><Th right>Disponible</Th><Th right>Staking</Th><Th right>En attente</Th><Th right>Total</Th><Th right>Valeur USD</Th></tr></thead><tbody>{assets.map((row) => <tr key={row.asset}><Td label="Actif"><a className="wk-link" href={assetHref(row.asset)}><span className="wk-asset">{row.asset}</span></a></Td><Td right label="Prix">{row.priceUsd === null ? "—" : formatUsd(row.priceUsd)}</Td><Td right label="Disponible">{formatNumber(row.available)}</Td><Td right label="Staking">{formatNumber(row.staking)}</Td><Td right label="En attente">{formatNumber(row.pending)}</Td><Td right label="Total">{formatNumber(row.total)}</Td><Td right label="Valeur USD">{row.valueUsd === null ? "—" : formatUsd(row.valueUsd)}</Td></tr>)}</tbody></TableWrap>}</Section>
    <Section title="Transactions récentes" hint={`${visibleTransactions.length} opération(s) affichée(s)${selectedAsset ? ` · ${selectedAsset}` : ""}`}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>{selectedAsset ? <a className="wk-link" href={assetHref()}>Afficher tous les actifs</a> : <span />}{<a className="wk-link" href={exportHref}>Exporter en CSV</a>}</div>{visibleTransactions.length === 0 ? <Empty text="Aucune transaction pour ce filtre." /> : <TableWrap><thead><tr><Th>Date</Th><Th>Type</Th><Th>Actif</Th><Th right>Montant</Th><Th>Statut</Th><Th hideSm>Référence</Th></tr></thead><tbody>{visibleTransactions.map((row) => <tr key={row.id}><Td label="Date">{formatDateTime(new Date(row.created_at))}</Td><Td label="Type">{txTypeLabel(row.type)}</Td><Td label="Actif">{row.asset_symbol}</Td><Td right label="Montant">{formatNumber(Number(row.amount))}{row.fee ? <div className="wk-asset-sub">Frais : {formatNumber(Number(row.fee))}</div> : null}</Td><Td label="Statut"><Pill tone={txStatusTone(row.status)}>{txStatusLabel(row.status)}</Pill></Td><Td hideSm label="Référence"><span className="wk-asset-sub">{shortId(row.tx_hash || row.id)}</span></Td></tr>)}</tbody></TableWrap>}</Section>
  </div>;
}
function StatCard({ label, value, sub, tone = "ok" }: { label: string; value: string; sub: string; tone?: "ok" | "bad" | "warn" | "info" }) { return <div className="wk-strip-item"><div className="wk-strip-label">{label}</div><div className={`wk-strip-value wk-${tone}`}>{value}</div><div className="wk-strip-sub">{sub}</div></div>; }
