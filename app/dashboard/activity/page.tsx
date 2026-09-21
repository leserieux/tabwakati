import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatDate, formatDateTime } from "@/lib/format";
import { PageHeader, TableWrap, Th, Td, Pill, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;

const TYPE_LABELS: Record<string, string> = {
  deposit: "Dépôt",
  withdrawal: "Retrait",
  swap_debit: "Échange (débit)",
  swap_credit: "Échange (crédit)",
  staking_lock: "Verrouillage staking",
  unstake: "Déblocage staking",
  unstake_request: "Demande de déblocage",
  staking_reward: "Récompense staking",
  game_win: "Gain au jeu",
  loan_disbursement: "Prêt versé",
  loan_repayment: "Remboursement de prêt"
};

const SUCCESS_STATUSES = new Set(["completed", "succeeded", "success", "successful"]);

function statusPill(status: string) {
  if (SUCCESS_STATUSES.has(status)) return <Pill tone="ok">Réussi</Pill>;
  if (status === "failed") return <Pill tone="bad">Échec</Pill>;
  if (status === "cancelled" || status === "canceled") return <Pill tone="bad">Annulé</Pill>;
  return <Pill tone="warn">En attente</Pill>;
}

export default async function ActivityPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const since24h = new Date(now - DAY).toISOString();
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const [users, volume, stuck, failed24h, recent] = await Promise.all([
    q<any>(db.from("admin_users_overview").select("last_activity_at, created_at")),
    q<any>(
      db
        .from("admin_transactions_overview")
        .select("day, transaction_count, total_amount_usd")
        .gte("day", new Date(now - 6 * DAY).toISOString().slice(0, 10))
    ),
    q<any>(db.from("transactions").select("id").in("status", ["pending", "processing"]).lt("created_at", stuckBefore)),
    q<any>(db.from("transactions").select("id").eq("status", "failed").gte("created_at", since24h)),
    q<any>(
      db
        .from("transactions")
        .select("id, type, status, asset_symbol, amount, created_at")
        // Include completed deposits as well as transactions requiring attention.
        .or(`status.in.(pending,processing),and(status.in.(completed,failed),created_at.gte.${since7d})`)
        .order("created_at", { ascending: false })
        .limit(15)
    )
  ]);

  const totalUsers = users.rows.length;
  const newUsers = users.rows.filter((u) => u.created_at >= since7d).length;
  const active = users.rows.filter((u) => u.last_activity_at && u.last_activity_at >= since7d).length;
  const volume7d = volume.rows.reduce((sum, row) => sum + Number(row.total_amount_usd || 0), 0);
  const count7d = volume.rows.reduce((sum, row) => sum + Number(row.transaction_count || 0), 0);
  const queryErrors = [users.error, volume.error, recent.error].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader
        title="Activité"
        subtitle="Les transactions récentes, les utilisateurs et les points d'attention de la plateforme."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={queryErrors ? `Certaines données n'ont pas pu être lues : ${queryErrors}` : null} />

      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Utilisateurs</div>
          <div className="wk-strip-value">{totalUsers}</div>
          <div className="wk-strip-sub">{newUsers} nouveau{newUsers > 1 ? "x" : ""} cette semaine</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Actifs cette semaine</div>
          <div className="wk-strip-value">{active}</div>
          <div className="wk-strip-sub">{totalUsers ? `${Math.round((active / totalUsers) * 100)} % des utilisateurs` : "—"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Volume sur 7 jours</div>
          <div className="wk-strip-value">{volume7d.toFixed(2)} $</div>
          <div className="wk-strip-sub">{count7d} transaction{count7d > 1 ? "s" : ""}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">À surveiller</div>
          <div className="wk-strip-value">{stuck.rows.length + failed24h.rows.length}</div>
          <div className="wk-strip-sub">en attente ou en échec</div>
        </div>
      </div>

      <div className="wk-section">
        <div className="wk-section-head">
          <h2 className="wk-h2">Transactions récentes</h2>
          <p className="wk-hint">Les dépôts réussis sont maintenant affichés avec les transactions en attente et en échec.</p>
        </div>
        {recent.rows.length === 0 ? (
          <Empty text="Aucune transaction récente." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th right>Montant</Th>
                <Th>Statut</Th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((transaction) => (
                <tr key={transaction.id}>
                  <Td label="Date">{formatDate(transaction.created_at)}</Td>
                  <Td label="Type">{TYPE_LABELS[transaction.type] || transaction.type}</Td>
                  <Td right label="Montant">
                    {formatNumber(Number(transaction.amount))} <span className="wk-asset-sub">{transaction.asset_symbol}</span>
                  </Td>
                  <Td label="Statut">{statusPill(transaction.status)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </div>
  );
}
