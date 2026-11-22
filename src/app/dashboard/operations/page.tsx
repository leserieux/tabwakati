import { getSupabaseAdmin, q } from "@/core/db/data";
import { formatDateTime, formatDate, formatNumber, shortId } from "@/core/format";
import { PENDING_STATUSES, txTypeLabel, txStatusTone, txStatusLabel } from "@/modules/operations/transactions";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIST_LIMIT = 50;

type TxRow = { id: string; user_id: string; type: string; asset_symbol: string; amount: number; status: string | null; network: string | null; created_at: string };

function ageLabel(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

/**
 * File d'attente : tout ce qu'un admin doit traiter à la main, au même endroit.
 * Transactions bloquées ou échouées (avec les lignes réelles), prêts à surveiller, collectes en échec, dépôts suspendus.
 * Chaque bloc renvoie vers la page où l'on agit.
 */
export default async function OperationsPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since24h = new Date(now - DAY).toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const stuckBefore = new Date(now - HOUR).toISOString();
  const cols = "id, user_id, type, asset_symbol, amount, status, network, created_at";

  const [pending, failed, credit, sweepFails, paused] = await Promise.all([
    q<TxRow>(db.from("transactions").select(cols).in("status", PENDING_STATUSES).order("created_at", { ascending: true }).limit(LIST_LIMIT)),
    q<TxRow>(db.from("transactions").select(cols).eq("status", "failed").gte("created_at", since24h).order("created_at", { ascending: false }).limit(LIST_LIMIT)),
    db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque").maybeSingle(),
    db.from("sweep_log").select("id", { count: "exact", head: true }).neq("status", "swept").eq("dry_run", false).gte("created_at", since7d),
    q<{ symbol: string }>(db.from("supported_assets").select("symbol").eq("can_be_deposited", false))
  ]);

  const stuck = pending.rows.filter((t) => t.created_at < stuckBefore);
  const loansAtRisk = Number((credit.data as any)?.loans_a_risque || 0) + Number((credit.data as any)?.score_loans_a_risque || 0);
  const sweepFailCount = sweepFails.count || 0;
  const pausedAssets = paused.rows.map((p) => p.symbol);

  const userIds = [...new Set([...pending.rows, ...failed.rows].map((t) => t.user_id).filter(Boolean))];
  const names = userIds.length ? await q<{ id: string; username: string | null }>(db.from("admin_users_overview").select("id, username").in("id", userIds)) : { rows: [] as { id: string; username: string | null }[] };
  const nameOf = new Map(names.rows.map((u) => [u.id, u.username || ""]));

  const errors = [pending.error, failed.error, credit.error?.message, sweepFails.error?.message, paused.error].filter(Boolean).join(" · ");
  const total = stuck.length + failed.rows.length + loansAtRisk + sweepFailCount;

  const kpi = (label: string, value: number, detail: string, href: string, bad: boolean) => (
    <a className={`wk-exchange-kpi ${value > 0 ? (bad ? "wk-exchange-kpi-negative" : "") : "wk-exchange-kpi-positive"}`} href={href}>
      <span className="wk-exchange-kpi-arrow">→</span>
      <span className="wk-exchange-kpi-label">{label}</span>
      <span className="wk-exchange-kpi-value">{formatNumber(value, 0)}</span>
      <span className="wk-exchange-kpi-detail">{detail}</span>
    </a>
  );

  const txTable = (rows: TxRow[], withAge: boolean) => (
    <TableWrap>
      <thead><tr><Th>Date</Th>{withAge && <Th right>Attend depuis</Th>}<Th>Utilisateur</Th><Th>Type</Th><Th>Actif</Th><Th right>Montant</Th><Th>Statut</Th></tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <Td label="Date">{formatDate(t.created_at)}</Td>
            {withAge && <Td right label="Attend depuis">{ageLabel(t.created_at, now)}</Td>}
            <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${t.user_id}`}>{nameOf.get(t.user_id) || shortId(t.user_id)}</a></Td>
            <Td label="Type">{txTypeLabel(t.type)}{t.network ? <div className="wk-asset-sub">{t.network}</div> : null}</Td>
            <Td label="Actif"><a className="wk-link" href={`/dashboard/assets/${encodeURIComponent(t.asset_symbol)}`}>{t.asset_symbol}</a></Td>
            <Td right label="Montant">{formatNumber(Number(t.amount))}</Td>
            <Td label="Statut"><Pill tone={txStatusTone(t.status)}>{txStatusLabel(t.status)}</Pill></Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );

  return (
    <div>
      <PageHeader title="File d'attente" subtitle="Tout ce qui demande une action de ta part, au même endroit. Une ligne disparaît dès que le problème est réglé." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données sont indisponibles : ${errors}` : null} />

      <div className="wk-exchange-kpis">
        {kpi("Bloquées depuis plus d'1 h", stuck.length, `${pending.rows.length} en attente au total`, "#bloquees", true)}
        {kpi("Échecs (24 h)", failed.rows.length, "transactions échouées", "#echecs", true)}
        {kpi("Prêts à surveiller", loansAtRisk, "marge faible ou échéance dépassée", "/dashboard/credit", true)}
        {kpi("Collectes en échec (7 j)", sweepFailCount, "dépôts non ramassés", "/dashboard/sweep", true)}
      </div>

      {total === 0 && pausedAssets.length === 0 && !errors && (
        <div className="wk-exchange-empty" style={{ marginTop: 20 }}><span>✓</span><div><strong>Rien à traiter</strong><p>Aucune transaction bloquée ou échouée, aucun prêt ni aucune collecte en difficulté.</p></div></div>
      )}

      <div id="bloquees" />
      <Section title="Transactions en attente" hint={`Les plus anciennes d'abord. ${stuck.length > 0 ? `${stuck.length} attendent depuis plus d'une heure : à vérifier en priorité.` : "Aucune n'attend depuis plus d'une heure."}${pending.rows.length === LIST_LIMIT ? ` Seules les ${LIST_LIMIT} plus anciennes sont affichées.` : ""}`}>
        {pending.rows.length === 0 ? <Empty text="Aucune transaction en attente." /> : txTable(pending.rows, true)}
        <p className="wk-hint" style={{ marginTop: 10 }}><a className="wk-link" href="/dashboard/transactions?status=pending">Voir toutes les transactions en attente →</a></p>
      </Section>

      <div id="echecs" />
      <Section title="Transactions échouées (24 h)" hint={`Les plus récentes d'abord.${failed.rows.length === LIST_LIMIT ? ` Seules les ${LIST_LIMIT} plus récentes sont affichées.` : ""}`}>
        {failed.rows.length === 0 ? <Empty text="Aucun échec ces dernières 24 heures." /> : txTable(failed.rows, false)}
        <p className="wk-hint" style={{ marginTop: 10 }}><a className="wk-link" href="/dashboard/transactions?status=failed">Voir tous les échecs →</a></p>
      </Section>

      {pausedAssets.length > 0 && (
        <Section title="Dépôts suspendus" hint="Information : les dépôts sont désactivés pour ces actifs. Ils se réactivent dans Système › Paramètres.">
          <p style={{ margin: 0 }}>{pausedAssets.map((s) => <a key={s} className="wk-link" style={{ marginRight: 14 }} href={`/dashboard/assets/${encodeURIComponent(s)}`}>{s}</a>)}</p>
        </Section>
      )}
    </div>
  );
}
