import { getSupabaseAdmin, loadPrices } from "@/lib/data";
import { futuresTodos } from "@/lib/futures";
import { computeCoverage } from "@/lib/valuation";
import { loadSolvencyLines } from "@/lib/solvency";
import { buildPlans, ensureTodaySnapshot } from "@/lib/custody-policy";
import { summarize as summarizeCustody } from "@/lib/custody-plan";
import { loadPnl } from "@/lib/pnl";
import { loadControls } from "@/lib/controls";
import { NAV } from "@/lib/nav-config";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatNumber, formatUsd, formatPct } from "@/lib/format";
import { PageHeader, Section, Icon, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const EPS = 0.00000001;

type Todo = { tone: Tone; text: string; href: string };
const ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

/** Regroupe les alertes par page d'action et niveau pour éviter de répéter la même destination. */
function addTodo(list: Todo[], item: Todo) {
  const existing = list.find((t) => t.href === item.href && t.tone === item.tone);
  if (!existing) return void list.push(item);
  if (!existing.text.includes(item.text)) existing.text = `${existing.text} · ${item.text}`;
}

export default async function TodayPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since24h = new Date(now - DAY).toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const [usersTotal, usersActive, usersNew, volume, credit, recon, pending, stuck, failed, sweepFails, paused, pnl30, controls, prices] = await Promise.all([
    db.from("admin_users_overview").select("id", { count: "exact", head: true }),
    db.from("admin_users_overview").select("id", { count: "exact", head: true }).gte("last_activity_at", since7d),
    db.from("admin_users_overview").select("id", { count: "exact", head: true }).gte("created_at", since7d),
    db.rpc("admin_volume_daily", { p_days: 7 }),
    db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque").maybeSingle(),
    db.rpc("get_admin_reconciliation"),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]).lt("created_at", stuckBefore),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    db.from("sweep_log").select("id", { count: "exact", head: true }).neq("status", "swept").eq("dry_run", false).gte("created_at", since7d),
    db.from("supported_assets").select("symbol").eq("can_be_deposited", false),
    loadPnl(30).catch(() => null),
    loadControls(),
    loadPrices()
  ]);

  const sol = await loadSolvencyLines(prices);
  const lines = [...sol.crypto, ...sol.mobile];
  const cov = computeCoverage(lines.filter((l) => l.have !== null).map((l) => ({ asset: l.asset, owed: l.owe, held: l.have as number, price: l.priceUsd })));
  const unreadable = lines.filter((l) => l.have === null).map((l) => l.asset);
  const coveragePct = sol.error || Number.isNaN(cov.coveragePct) ? null : cov.coveragePct;
  const volume7d = (((volume.data as any[]) || []) as any[]).filter((r) => r.category !== "game").reduce((s, r) => s + Number(r.volume_usd || 0), 0);
  const atRisk = Number((credit.data as any)?.loans_a_risque || 0) + Number((credit.data as any)?.score_loans_a_risque || 0);
  const pendingCount = pending.count || 0;
  const stuckCount = stuck.count || 0;
  const failedCount = failed.count || 0;
  const sweepFailCount = sweepFails.count || 0;

  let custodySummary: ReturnType<typeof summarizeCustody> | null = null;
  try {
    const { plans } = await buildPlans(sol);
    custodySummary = summarizeCustody(plans);
    await ensureTodaySnapshot(plans);
  } catch (e) {
    console.error("[accueil] réserve de retrait non calculée:", e);
  }

  const todo: Todo[] = [];
  if (custodySummary?.danger.length) addTodo(todo, { tone: "bad", text: `Retrait important potentiellement bloqué : ${custodySummary.danger.map((p) => p.asset).join(", ")}. Recharger les portefeuilles concernés.`, href: "/dashboard/treasury" });
  if (custodySummary?.refill.length) addTodo(todo, { tone: "warn", text: `Portefeuilles de retrait à réapprovisionner bientôt : ${custodySummary.refill.map((p) => p.asset).join(", ")}.`, href: "/dashboard/treasury" });
  if (cov.missingUsd > 0.01) addTodo(todo, { tone: "bad", text: `Déficit de couverture estimé : ${formatUsd(cov.missingUsd)}.`, href: "/dashboard/treasury" });
  if (sol.error) addTodo(todo, { tone: "bad", text: `Couverture non calculable : ${sol.error}.`, href: "/dashboard/treasury" });
  if (unreadable.length) addTodo(todo, { tone: "warn", text: `Soldes réels illisibles (exclus de la couverture) : ${unreadable.join(", ")}.`, href: "/dashboard/treasury" });
  if (cov.unpriced.length) addTodo(todo, { tone: "warn", text: `Cours manquants ou invalides : ${cov.unpriced.join(", ")}.`, href: "/dashboard/treasury" });

  const reconBad: string[] = [];
  const reconWarn: string[] = [];
  for (const row of ((recon.data as any[]) || [])) {
    if (Math.abs(Number(row.liability_diff || 0)) > EPS) reconBad.push(`${row.asset_symbol} : écart de rapprochement ${formatNumber(Number(row.liability_diff))}`);
    if (Number(row.negative_rows || 0) > 0) reconBad.push(`${row.asset_symbol} : ${row.negative_rows} solde(s) négatif(s)`);
    if (Math.abs(Number(row.staking_orphan || 0)) > EPS) reconWarn.push(`${row.asset_symbol} : ${formatNumber(Number(row.staking_orphan))} en staking sans stake correspondant`);
  }
  if (reconBad.length) addTodo(todo, { tone: "bad", text: reconBad.join(" · "), href: "/dashboard/controls" });
  if (reconWarn.length) addTodo(todo, { tone: "warn", text: reconWarn.join(" · "), href: "/dashboard/controls" });

  const badControls = controls.controls.filter((c) => c.status === "bad");
  const warnControls = controls.controls.filter((c) => c.status === "warn");
  if (badControls.length) addTodo(todo, { tone: "bad", text: `${badControls.length} contrôle(s) en échec : ${badControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (warnControls.length) addTodo(todo, { tone: "warn", text: `${warnControls.length} contrôle(s) à surveiller : ${warnControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (controls.error) addTodo(todo, { tone: "warn", text: `Contrôles automatiques non exécutés : ${controls.error}.`, href: "/dashboard/controls" });
  if (atRisk > 0) addTodo(todo, { tone: "bad", text: `${atRisk} prêt(s) à surveiller (risque LTV ou échéance dépassée).`, href: "/dashboard/credit" });
  if (pendingCount > 0) addTodo(todo, { tone: "warn", text: `${pendingCount} transaction(s) en attente${stuckCount > 0 ? `, dont ${stuckCount} depuis plus d'une heure` : ""}.`, href: "/dashboard/transactions" });
  if (failedCount > 0) addTodo(todo, { tone: "warn", text: `${failedCount} transaction(s) en échec ces dernières 24 heures.`, href: "/dashboard/transactions?status=failed" });
  if (sweepFailCount > 0) addTodo(todo, { tone: "warn", text: `${sweepFailCount} balayage(s) en échec cette semaine.`, href: "/dashboard/sweep" });
  if (pnl30 && pnl30.current.net < -0.005) addTodo(todo, { tone: "warn", text: `Résultat net négatif sur 30 jours : ${formatUsd(pnl30.current.net)}.`, href: "/dashboard/pnl" });
  const pausedRows = ((paused.data as any[]) || []) as any[];
  if (pausedRows.length) addTodo(todo, { tone: "info", text: `Dépôts suspendus : ${pausedRows.map((p) => p.symbol).join(", ")}.`, href: "/dashboard/settings" });
  for (const item of await futuresTodos()) addTodo(todo, item);
  todo.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);

  const nBad = todo.filter((t) => t.tone === "bad").length;
  const nWarn = todo.filter((t) => t.tone === "warn").length;
  const tone: "ok" | "warn" | "bad" = nBad > 0 ? "bad" : nWarn > 0 ? "warn" : "ok";
  const net30 = pnl30?.current.net ?? null;
  const queryErrors = [usersTotal.error?.message, usersActive.error?.message, usersNew.error?.message, volume.error?.message, credit.error?.message, recon.error?.message].filter(Boolean).join(" · ");
  const shortcuts = ["money", "users", "products", "wakati", "system"].map((key) => NAV.find((entry) => entry.key === key)).filter((entry) => entry && entry.tabs);

  return (
    <div className="wk-exchange-dashboard">
      <PageHeader title="Vue d’ensemble" subtitle="Performance, activité et santé opérationnelle de la plateforme." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={queryErrors ? `Certaines données sont indisponibles : ${queryErrors}` : null} />

      <div className={`wk-exchange-status wk-exchange-status-${tone}`}>
        <div className="wk-exchange-status-copy">
          <span className="wk-exchange-status-indicator" />
          <div>
            <div className="wk-exchange-eyebrow">ÉTAT DE LA PLATEFORME</div>
            <h2>{tone === "ok" ? "Opérations nominales" : tone === "bad" ? "Action prioritaire requise" : "Surveillance recommandée"}</h2>
            <p>{tone === "ok" ? "Aucune alerte prioritaire détectée dans les contrôles suivis." : `${nBad} priorité(s) · ${nWarn} alerte(s) à surveiller. Consultez la file d’actions ci-dessous.`}</p>
          </div>
        </div>
        <div className="wk-exchange-status-meta">Mis à jour {formatDateTime(new Date())}</div>
      </div>

      <Section title="Indicateurs clés" hint="Repères de pilotage sur des périodes définies. Les montants sont des estimations au cours courant.">
        <div className="wk-exchange-kpis">
          <Kpi label="Volume traité · 7 j" value={formatCompactUsd(volume7d)} detail="Hors mises de jeux" href="/dashboard/transactions" />
          <Kpi label="Résultat net · 30 j" value={net30 === null ? "—" : formatCompactUsd(net30)} detail="Revenus moins coûts suivis" href="/dashboard/pnl" tone={net30 === null ? "neutral" : net30 >= 0 ? "positive" : "negative"} />
          <Kpi label="Utilisateurs actifs · 7 j" value={formatCompactNumber(usersActive.count || 0)} detail={`${formatCompactNumber(usersTotal.count || 0)} au total · +${formatCompactNumber(usersNew.count || 0)} nouveaux`} href="/dashboard/users" />
          <Kpi label="Couverture des passifs" value={coveragePct === null ? "—" : formatPct(coveragePct)} detail="Réserves comparées aux soldes dus" href="/dashboard/treasury" tone={coveragePct === null ? "neutral" : coveragePct >= 100 ? "positive" : "negative"} />
        </div>
      </Section>

      <div className="wk-exchange-lower">
        <section className="wk-exchange-panel wk-exchange-actions">
          <div className="wk-exchange-panel-head">
            <div><div className="wk-exchange-eyebrow">CENTRE DE CONTRÔLE</div><h2>Actions requises</h2></div>
            <span className={`wk-exchange-count wk-exchange-count-${tone}`}>{nBad + nWarn} à traiter</span>
          </div>
          {todo.length ? (
            <ul className="wk-exchange-todo">
              {todo.map((t, i) => <li key={`${t.href}-${t.tone}-${i}`} className={`wk-exchange-todo-item wk-exchange-todo-${t.tone}`}>
                <span className="wk-exchange-todo-marker" />
                <span className="wk-exchange-todo-text">{t.text}</span>
                <a href={t.href} aria-label={`Ouvrir ${t.href}`}>Voir →</a>
              </li>)}
            </ul>
          ) : <div className="wk-exchange-empty"><span>✓</span><div><strong>Rien à traiter</strong><p>Les contrôles disponibles ne signalent aucune action urgente.</p></div></div>}
        </section>

        <section className="wk-exchange-panel wk-exchange-shortcuts">
          <div className="wk-exchange-panel-head"><div><div className="wk-exchange-eyebrow">ACCÈS RAPIDE</div><h2>Espaces de pilotage</h2></div></div>
          <div className="wk-exchange-links">
            {shortcuts.map((entry) => entry && <article key={entry.key} className="wk-exchange-link-card">
              <a href={entry.href}><span className="wk-exchange-link-icon"><Icon name={entry.icon} size={17} /></span><strong>{entry.label}</strong><span aria-hidden="true">↗</span></a>
              <div>{entry.tabs!.slice(0, 3).map((tab) => <a key={tab.href} href={tab.href}>{tab.label}</a>)}</div>
            </article>)}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, detail, href, tone = "neutral" }: { label: string; value: string; detail: string; href: string; tone?: "neutral" | "positive" | "negative" }) {
  return <a className={`wk-exchange-kpi wk-exchange-kpi-${tone}`} href={href}>
    <span className="wk-exchange-kpi-label">{label}</span>
    <strong className="wk-exchange-kpi-value">{value}</strong>
    <span className="wk-exchange-kpi-detail">{detail}</span>
    <span className="wk-exchange-kpi-arrow" aria-hidden="true">↗</span>
  </a>;
}
