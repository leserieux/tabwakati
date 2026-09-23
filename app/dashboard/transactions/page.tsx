import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime, formatNumber, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote } from "@/components/ui";
import {
  TX_TYPE_LABELS,
  txTypeLabel,
  txStatusTone,
  txStatusLabel,
  applyTransactionFilters,
  applyTransactionSearch,
  type TxFilters
} from "@/lib/transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

type TxRow = {
  id: string;
  user_id: string;
  type: string;
  asset_symbol: string;
  amount: number;
  fee: number | null;
  status: string | null;
  tx_hash: string | null;
  network: string | null;
  created_at: string;
};

const TYPE_OPTIONS = Object.entries(TX_TYPE_LABELS).sort((a, b) => a[1].localeCompare(b[1], "fr"));

export default async function TransactionsPage({
  searchParams
}: {
  searchParams: TxFilters & { page?: string };
}) {
  const db = getSupabaseAdmin();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from("transactions")
    .select("id, user_id, type, asset_symbol, amount, fee, status, tx_hash, network, created_at", { count: "exact" });
  query = applyTransactionFilters(query as any, searchParams);
  if (searchParams.q) query = await applyTransactionSearch(db, query as any, searchParams.q);
  query = query.order("created_at", { ascending: false }).range(from, to) as any;

  const [{ data, error, count }, assets] = await Promise.all([
    query,
    q<{ symbol: string }>(db.from("supported_assets").select("symbol").order("symbol"))
  ]);

  const rows = (data || []) as TxRow[];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const userIds = [...new Set(rows.map((t) => t.user_id).filter(Boolean))];
  const names = userIds.length
    ? await q<{ id: string; username: string | null }>(db.from("admin_users_overview").select("id, username").in("id", userIds))
    : { rows: [] as { id: string; username: string | null }[] };
  const nameOf = new Map(names.rows.map((u) => [u.id, u.username || ""]));

  function fieldsQS(overrides: Record<string, string | undefined> = {}): URLSearchParams {
    const params = new URLSearchParams();
    const merged = { ...searchParams, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (k === "page") continue;
      if (v) params.set(k, v);
    }
    return params;
  }

  function pageHref(p: number): string {
    const params = fieldsQS();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/dashboard/transactions${qs ? `?${qs}` : ""}`;
  }

  const exportHref = `/api/transactions/export?${fieldsQS().toString()}`;
  const hasFilters = !!(searchParams.q || searchParams.type || searchParams.status || searchParams.asset || searchParams.from || searchParams.to);

  return (
    <div>
      <PageHeader title="Transactions" subtitle="Recherche et filtre sur l'ensemble des transactions de la plateforme." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={error ? `Les transactions n'ont pas pu être lues : ${error.message}` : null} />

      <Section title="Filtrer">
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <label className="wk-label" htmlFor="q">Recherche</label>
            <input id="q" name="q" type="text" defaultValue={searchParams.q || ""} placeholder="Utilisateur, e-mail, ID, hash de transaction…" className="wk-input" />
          </div>
          <div>
            <label className="wk-label" htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue={searchParams.type || ""} className="wk-input" style={{ width: 190 }}>
              <option value="">Tous</option>
              {TYPE_OPTIONS.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="wk-label" htmlFor="status">Statut</label>
            <select id="status" name="status" defaultValue={searchParams.status || ""} className="wk-input" style={{ width: 150 }}>
              <option value="">Tous</option>
              <option value="success">Réussi</option>
              <option value="pending">En attente</option>
              <option value="failed">Échec</option>
            </select>
          </div>
          <div>
            <label className="wk-label" htmlFor="asset">Actif</label>
            <select id="asset" name="asset" defaultValue={searchParams.asset || ""} className="wk-input" style={{ width: 130 }}>
              <option value="">Tous</option>
              {assets.rows.map((a) => (
                <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="wk-label" htmlFor="from">Depuis</label>
            <input id="from" name="from" type="date" defaultValue={searchParams.from || ""} className="wk-input" style={{ width: 155 }} />
          </div>
          <div>
            <label className="wk-label" htmlFor="to">Jusqu'au</label>
            <input id="to" name="to" type="date" defaultValue={searchParams.to || ""} className="wk-input" style={{ width: 155 }} />
          </div>
          <button type="submit" className="wk-btn">Filtrer</button>
          {hasFilters && <a href="/dashboard/transactions" className="wk-link">Réinitialiser</a>}
        </form>
      </Section>

      <Section
        title="Résultats"
        hint={`${total} transaction${total > 1 ? "s" : ""} trouvée${total > 1 ? "s" : ""}.`}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <a href={exportHref} className="wk-link">Exporter en CSV (5 000 lignes max)</a>
        </div>

        {rows.length === 0 ? (
          <Empty text="Aucune transaction pour ces filtres." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Utilisateur</Th>
                  <Th>Type</Th>
                  <Th right>Montant</Th>
                  <Th right hideSm>Frais</Th>
                  <Th>Statut</Th>
                  <Th hideSm>Référence</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <Td label="Date">{formatDateTime(new Date(t.created_at))}</Td>
                    <Td label="Utilisateur">
                      <div className="wk-asset">{nameOf.get(t.user_id) || "Sans pseudo"}</div>
                      <div className="wk-asset-sub">{shortId(t.user_id)}</div>
                    </Td>
                    <Td label="Type">{txTypeLabel(t.type)}</Td>
                    <Td right label="Montant">
                      {formatNumber(Number(t.amount))} <span className="wk-asset-sub">{t.asset_symbol}</span>
                    </Td>
                    <Td right label="Frais" hideSm>
                      {t.fee ? formatNumber(Number(t.fee)) : "—"}
                    </Td>
                    <Td label="Statut">
                      <Pill tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Pill>
                    </Td>
                    <Td label="Référence" hideSm>
                      <span className="wk-asset-sub">{t.tx_hash ? shortId(t.tx_hash) : shortId(t.id)}</span>
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
