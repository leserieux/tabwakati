import { getSupabaseAdmin, loadPrices } from "@/lib/data";
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

/** Une ligne de la liste « À traiter » : ce qui ne va pas, et la page où le traiter. */
type Todo = { tone: Tone; text: string; href: string };
const ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

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

  // Couverture : custody réelle (on-chain + PawaPay), comme la page Solvabilité.
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

  // ── À traiter : chaque ligne renvoie vers la page où l'on agit ──
  // Réserve de retrait : jamais bloquant pour l'accueil (si ça échoue, on n'affiche simplement pas l'alerte).
  let custodySummary: ReturnType<typeof summarizeCustody> | null = null;
  try {
    const { plans } = await buildPlans(sol);
    custodySummary = summarizeCustody(plans);
    await ensureTodaySnapshot(plans); // relevé quotidien, même si personne n'ouvre la page « Réserve de retrait »
  } catch (e) {
    console.error("[accueil] réserve de retrait non calculée:", e);
  }

  const todo: Todo[] = [];
  if (custodySummary && custodySummary.danger.length) todo.push({ tone: "bad", text: `Un gros retrait pourrait échouer sur : ${custodySummary.danger.map((p) => p.asset).join(", ")}. Ajoute de l'argent dans le portefeuille de retrait.`, href: "/dashboard/custody" });
  if (custodySummary && custodySummary.refill.length) todo.push({ tone: "warn", text: `Portefeuille de retrait à remplir bientôt : ${custodySummary.refill.map((p) => p.asset).join(", ")}.`, href: "/dashboard/custody" });
  if (cov.missingUsd > 0.01) todo.push({ tone: "bad", text: `Il manque environ ${formatUsd(cov.missingUsd)} pour couvrir ce que tu dois aux utilisateurs.`, href: "/dashboard/treasury" });
  if (sol.error) todo.push({ tone: "bad", text: `Couverture non calculable : ${sol.error}.`, href: "/dashboard/treasury" });
  if (unreadable.length) todo.push({ tone: "warn", text: `Solde réel illisible pour : ${unreadable.join(", ")} (exclus de la couverture).`, href: "/dashboard/treasury" });
  if (cov.unpriced.length) todo.push({ tone: "warn", text: `Sans prix valide : ${cov.unpriced.join(", ")}.`, href: "/dashboard/treasury" });
  for (const row of ((recon.data as any[]) || [])) {
    if (Math.abs(Number(row.liability_diff || 0)) > EPS) todo.push({ tone: "bad", text: `${row.asset_symbol} : écart de rapprochement de ${formatNumber(Number(row.liability_diff))}.`, href: "/dashboard/controls" });
    if (Number(row.negative_rows || 0) > 0) todo.push({ tone: "bad", text: `${row.asset_symbol} : ${row.negative_rows} solde(s) négatif(s).`, href: "/dashboard/controls" });
    if (Math.abs(Number(row.staking_orphan || 0)) > EPS) todo.push({ tone: "warn", text: `${row.asset_symbol} : ${formatNumber(Number(row.staking_orphan))} en staking sans stake correspondant.`, href: "/dashboard/controls" });
  }
  const badControls = controls.controls.filter((c) => c.status === "bad");
  const warnControls = controls.controls.filter((c) => c.status === "warn");
  if (badControls.length) todo.push({ tone: "bad", text: `${badControls.length} contrôle(s) en échec : ${badControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (warnControls.length) todo.push({ tone: "warn", text: `${warnControls.length} contrôle(s) à surveiller : ${warnControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (controls.error) todo.push({ tone: "warn", text: `Contrôles automatiques non exécutés : ${controls.error}.`, href: "/dashboard/controls" });
  if (atRisk > 0) todo.push({ tone: "bad", text: `${atRisk} prêt(s) à surveiller (marge LTV faible ou échéance dépassée).`, href: "/dashboard/credit" });
  if (pendingCount > 0) todo.push({ tone: "warn", text: `${pendingCount} transaction(s) en attente${stuckCount > 0 ? `, dont ${stuckCount} depuis plus d'une heure` : ""}.`, href: "/dashboard/transactions?status=pending" });
  if (failedCount > 0) todo.push({ tone: "warn", text: `${failedCount} transaction(s) ont échoué ces dernières 24 heures.`, href: "/dashboard/transactions?status=failed" });
  if (sweepFailCount > 0) todo.push({ tone: "warn", text: `${sweepFailCount} balayage(s) en échec cette semaine.`, href: "/dashboard/sweep" });
  if (pnl30 && pnl30.current.net < -0.005) todo.push({ tone: "warn", text: `Résultat net des 30 derniers jours : ${formatUsd(pnl30.current.net)}.`, href: "/dashboard/pnl" });
  const pausedRows = ((paused.data as any[]) || []) as any[];
  if (pausedRows.length) todo.push({ tone: "info", text: `Dépôts suspendus : ${pausedRows.map((p) => p.symbol).join(", ")}.`, href: "/dashboard/settings" });
  todo.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);

  // ── Statut unique : seuls « bad » et « warn » comptent ; « info » reste informatif ──
  const nBad = todo.filter((t) => t.tone === "bad").length;
  const nWarn = todo.filter((t) => t.tone === "warn").length;
  const tone: "ok" | "warn" | "bad" = nBad > 0 ? "bad" : nWarn > 0 ? "warn" : "ok";
  const hero =
    tone === "ok"
      ? { icon: "check" as const, title: "Tout va bien", text: "Couverture, contrôles, transactions et prêts sont au vert." }
      : { icon: "alert" as const, title: tone === "bad" ? `${nBad + nWarn} point(s) à traiter, dont ${nBad} prioritaire(s)` : `${nWarn} point(s) à surveiller`, text: "Chaque ligne ci-dessous ouvre la page où le traiter." };

  const net30 = pnl30?.current.net ?? null;
  const queryErrors = [usersTotal.error?.message, usersActive.error?.message, usersNew.error?.message, volume.error?.message, credit.error?.message, recon.error?.message].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader title="Aujourd'hui" subtitle="Ce qui demande ton attention maintenant. Le détail est dans les autres sections." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={queryErrors ? `Certaines données sont indisponibles : ${queryErrors}` : null} />

      <div className={`wk-hero wk-hero-${tone}`}>
        <div className="wk-hero-top">
          <div className="wk-hero-msg">
            <span className={`wk-hero-icon wk-hero-icon-${tone}`}><Icon name={hero.icon} size={26} /></span>
            <div>
              <h2 className="wk-hero-title">{hero.title}</h2>
              <p className="wk-hero-text">{hero.text}</p>
            </div>
          </div>
          <div className="wk-figures">
            <Figure label="Couverture" value={coveragePct === null ? "—" : formatPct(coveragePct)} />
            <Figure label="Résultat 30 j" value={net30 === null ? "—" : formatCompactUsd(net30)} />
            <Figure label="Actifs 7 j" value={`${formatCompactNumber(usersActive.count || 0)} / ${formatCompactNumber(usersTotal.count || 0)}`} />
            <Figure label="Volume 7 j" value={formatCompactUsd(volume7d)} />
          </div>
        </div>
      </div>

      {todo.length > 0 && (
        <div className="wk-todo">
          <h3 className="wk-todo-title">À traiter</h3>
          <ul className="wk-todo-list">
            {todo.map((t, i) => (
              <li key={`${t.text}-${i}`} className="wk-todo-item">
                <span className={`wk-dot wk-dot-${t.tone}`} style={{ marginTop: 7 }} />
                <span style={{ flex: 1 }}>{t.text}</span>
                <a className="wk-link" href={t.href} style={{ whiteSpace: "nowrap" }}>Ouvrir →</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Aller à" hint={`${usersNew.count || 0} nouvel(s) utilisateur(s) sur 7 jours. Les détails (actifs, flux, frais, transactions) sont dans les sections ci-dessous.`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {NAV.filter((e) => e.tabs).map((entry) => (
            <div key={entry.key} className="wk-panel">
              <a href={entry.href} className="wk-link" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                <Icon name={entry.icon} size={16} />{entry.label}
              </a>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
                {entry.tabs!.map((tab) => <a key={tab.href} href={tab.href} className="wk-asset-sub">{tab.label}</a>)}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div className="wk-figure"><div className="wk-figure-label">{label}</div><div className="wk-figure-value">{value}</div></div>;
}
