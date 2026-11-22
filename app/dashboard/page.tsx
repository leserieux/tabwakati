import { getSupabaseAdmin, loadPrices } from "@/lib/data";
import { futuresTodos, loadFuturesMoney } from "@/lib/futures";
import MoneyHero from "@/app/dashboard/futures/money-hero";
import { computeCoverage } from "@/lib/valuation";
import { loadSolvencyLines } from "@/lib/solvency";
import { ensureTodaySnapshot, loadSnapshots, coverageOfDay } from "@/lib/custody-policy";
import { compare, comparePoints, type Delta } from "@/lib/trends";
import { loadFunding, actionText, type FundingLine } from "@/lib/funding";
import { loadPnl } from "@/lib/pnl";
import { loadControls } from "@/lib/controls";
import { statusLabel, statusTone, lineRatio } from "@/lib/asset-view";
import { formatCompactNumber, formatCompactUsd, formatDateTime, formatNumber, formatUsd, formatPct } from "@/lib/format";
import { PageHeader, Section, Pill, CoverageBar, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 3600 * 1000;
const EPS = 0.00000001;

/** Une ligne de la liste « À traiter » : ce qui ne va pas, et la page où le traiter. */
type Todo = { tone: Tone; text: string; href: string; usd?: number };
const ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

export default async function TodayPage() {
  const db = getSupabaseAdmin();
  const now = Date.now();
  const since24h = new Date(now - DAY).toISOString();
  const since7d = new Date(now - 7 * DAY).toISOString();
  const stuckBefore = new Date(now - 3600 * 1000).toISOString();

  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const since14d = new Date(now - 14 * DAY).toISOString();
  const [usersTotal, usersActive, usersNew, volume, credit, recon, pending, stuck, failed, sweepFails, paused, pnl30, controls, prices, usersNewPrev, snaps] = await Promise.all([
    db.from("admin_users_overview").select("id", { count: "exact", head: true }),
    db.from("admin_users_overview").select("id", { count: "exact", head: true }).gte("last_activity_at", since7d),
    db.from("admin_users_overview").select("id", { count: "exact", head: true }).gte("created_at", since7d),
    db.rpc("admin_volume_daily", { p_days: 14 }),
    db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque").maybeSingle(),
    db.rpc("get_admin_reconciliation"),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]),
    db.from("transactions").select("id", { count: "exact", head: true }).in("status", ["pending", "processing"]).lt("created_at", stuckBefore),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    db.from("sweep_log").select("id", { count: "exact", head: true }).neq("status", "swept").eq("dry_run", false).gte("created_at", since7d),
    db.from("supported_assets").select("symbol").eq("can_be_deposited", false),
    loadPnl(30).catch(() => null),
    loadControls(),
    loadPrices(),
    db.from("admin_users_overview").select("id", { count: "exact", head: true }).gte("created_at", since14d).lt("created_at", since7d),
    loadSnapshots(dayKey(now - 10 * DAY), dayKey(now)).catch(() => ({ rows: [], error: "relevés illisibles" }))
  ]);

  // Couverture : custody réelle (on-chain + PawaPay), comme la page Solvabilité.
  const sol = await loadSolvencyLines(prices);
  const lines = [...sol.crypto, ...sol.mobile];
  const cov = computeCoverage(lines.filter((l) => l.have !== null).map((l) => ({ asset: l.asset, owed: l.owe, held: l.have as number, price: l.priceUsd })));
  const unreadable = lines.filter((l) => l.have === null).map((l) => l.asset);
  const coveragePct = sol.error || Number.isNaN(cov.coveragePct) ? null : cov.coveragePct;

  // Volume : 7 derniers jours (aujourd'hui inclus) contre les 7 jours d'avant, jeux exclus.
  const volCut = dayKey(now - 6 * DAY);
  const volRows = ((volume.data as any[]) || []).filter((r) => r.category !== "game");
  const volume7d = volRows.filter((r) => String(r.day) >= volCut).reduce((s, r) => s + Number(r.volume_usd || 0), 0);
  const volumePrev7d = volRows.filter((r) => String(r.day) < volCut).reduce((s, r) => s + Number(r.volume_usd || 0), 0);
  const atRisk = Number((credit.data as any)?.loans_a_risque || 0) + Number((credit.data as any)?.score_loans_a_risque || 0);
  const pendingCount = pending.count || 0;
  const stuckCount = stuck.count || 0;
  const failedCount = failed.count || 0;
  const sweepFailCount = sweepFails.count || 0;

  // ── « Est-ce normal ? » : chaque chiffre clé comparé à la période précédente (voir lib/trends.ts) ──
  const volumeDelta = compare(volume7d, volumePrev7d, { minBase: 50 });
  const newUsersDelta = compare(usersNew.count || 0, usersNewPrev.count ?? null, { minBase: 5 });
  const net30Delta = compare(pnl30?.current.net ?? null, pnl30?.previous?.net ?? null, { minBase: 5 });
  let coverageDelta: Delta = comparePoints(null, null);
  {
    // Couverture d'il y a ~7 jours : relevé quotidien le plus proche de J-7 (entre J-10 et J-5).
    const byDate = new Map<string, typeof snaps.rows>();
    for (const r of snaps.rows) byDate.set(r.snapshot_date, [...(byDate.get(r.snapshot_date) || []), r]);
    const pick = [...byDate.keys()]
      .map((d) => ({ d, age: now - Date.parse(`${d}T12:00:00Z`) }))
      .filter((x) => x.age >= 5 * DAY && x.age <= 10.5 * DAY)
      .sort((a, b) => Math.abs(a.age - 7 * DAY) - Math.abs(b.age - 7 * DAY))[0];
    if (pick && coveragePct !== null) {
      const then = coverageOfDay(byDate.get(pick.d) || []);
      coverageDelta = comparePoints(coveragePct, Number.isNaN(then.coveragePct) ? null : then.coveragePct);
    }
  }

  // ── À traiter : chaque ligne renvoie vers la page où l'on agit ──
  // Plan d'approvisionnement (réserve de retrait + autonomie + test de stress) : jamais bloquant pour l'accueil.
  let funding: FundingLine[] = [];
  try {
    const f = await loadFunding(sol);
    funding = f.lines;
    await ensureTodaySnapshot(f.lines.map((l) => l.plan)); // relevé quotidien, même si personne n'ouvre la page « Réserve de retrait »
  } catch (e) {
    console.error("[accueil] plan d'approvisionnement non calculé:", e);
  }

  const todo: Todo[] = [];
  for (const f of funding) {
    if (f.urgency === "now") todo.push({ tone: "bad", text: actionText(f), href: "/dashboard/funding", usd: f.action.usd ?? undefined });
    else if (f.urgency === "soon") todo.push({ tone: "warn", text: actionText(f), href: "/dashboard/funding", usd: f.action.usd ?? undefined });
  }
  const watchAssets = funding.filter((f) => f.urgency === "watch").map((f) => f.plan.asset);
  if (watchAssets.length) todo.push({ tone: "info", text: `Si les plus gros utilisateurs retiraient ensemble, il faudrait d'abord déplacer de l'argent du coffre sur : ${watchAssets.join(", ")}.`, href: "/dashboard/funding" });
  if (volumeDelta.unusual && volumeDelta.direction === "down") todo.push({ tone: "warn", text: `Le volume des 7 derniers jours a baissé de ${Math.round(Math.abs(volumeDelta.pct ?? 0))} % par rapport aux 7 jours d'avant.`, href: "/dashboard/transactions" });
  if (volumeDelta.unusual && volumeDelta.direction === "up") todo.push({ tone: "info", text: `Le volume des 7 derniers jours a augmenté de ${Math.round(Math.abs(volumeDelta.pct ?? 0))} % par rapport aux 7 jours d'avant : vérifie que la trésorerie suit.`, href: "/dashboard/funding" });
  if (net30Delta.unusual && net30Delta.direction === "down") todo.push({ tone: "warn", text: `Le résultat des 30 derniers jours est en baisse de ${Math.round(Math.abs(net30Delta.pct ?? 0))} % par rapport aux 30 jours d'avant.`, href: "/dashboard/pnl" });
  if (coverageDelta.unusual && coverageDelta.direction === "down") todo.push({ tone: "warn", text: `La couverture du dû a perdu ${Math.abs(coverageDelta.pct ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} points en 7 jours.`, href: "/dashboard/assets" });
  if (cov.missingUsd > 0.01) todo.push({ tone: "bad", text: `Il manque environ ${formatUsd(cov.missingUsd)} pour couvrir ce que tu dois aux utilisateurs. Ouvre la liste des actifs pour voir lesquels approvisionner.`, href: "/dashboard/assets", usd: cov.missingUsd });
  if (sol.error) todo.push({ tone: "bad", text: `Couverture non calculable : ${sol.error}.`, href: "/dashboard/treasury" });
  if (unreadable.length) todo.push({ tone: "warn", text: `Solde réel illisible pour : ${unreadable.join(", ")} (exclus de la couverture).`, href: "/dashboard/treasury" });
  if (cov.unpriced.length) todo.push({ tone: "warn", text: `Sans prix valide : ${cov.unpriced.join(", ")}.`, href: "/dashboard/treasury" });
  for (const row of ((recon.data as any[]) || [])) {
    if (Math.abs(Number(row.liability_diff || 0)) > EPS) todo.push({ tone: "bad", text: `${row.asset_symbol} : les soldes des utilisateurs ne concordent pas avec les mouvements enregistrés (écart de ${formatNumber(Number(row.liability_diff))}).`, href: "/dashboard/controls" });
    if (Number(row.negative_rows || 0) > 0) todo.push({ tone: "bad", text: `${row.asset_symbol} : ${row.negative_rows} utilisateur(s) avec un solde négatif.`, href: "/dashboard/controls" });
    if (Math.abs(Number(row.staking_orphan || 0)) > EPS) todo.push({ tone: "warn", text: `${row.asset_symbol} : ${formatNumber(Number(row.staking_orphan))} placés en staking sans position de staking correspondante.`, href: "/dashboard/controls" });
  }
  const badControls = controls.controls.filter((c) => c.status === "bad");
  const warnControls = controls.controls.filter((c) => c.status === "warn");
  if (badControls.length) todo.push({ tone: "bad", text: `${badControls.length} contrôle(s) en échec : ${badControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (warnControls.length) todo.push({ tone: "warn", text: `${warnControls.length} contrôle(s) à surveiller : ${warnControls.map((c) => c.label).join(" · ")}.`, href: "/dashboard/controls" });
  if (controls.error) todo.push({ tone: "warn", text: `Contrôles automatiques non exécutés : ${controls.error}.`, href: "/dashboard/controls" });
  if (atRisk > 0) todo.push({ tone: "bad", text: `${atRisk} prêt(s) à surveiller (marge faible ou échéance dépassée).`, href: "/dashboard/credit" });
  if (pendingCount > 0) todo.push({ tone: "warn", text: `${pendingCount} transaction(s) en attente${stuckCount > 0 ? `, dont ${stuckCount} depuis plus d'une heure` : ""}.`, href: "/dashboard/operations" });
  if (failedCount > 0) todo.push({ tone: "warn", text: `${failedCount} transaction(s) ont échoué ces dernières 24 heures.`, href: "/dashboard/operations#echecs" });
  if (sweepFailCount > 0) todo.push({ tone: "warn", text: `${sweepFailCount} collecte(s) de dépôts en échec cette semaine.`, href: "/dashboard/sweep" });
  if (pnl30 && pnl30.current.net < -0.005) todo.push({ tone: "warn", text: `Résultat net des 30 derniers jours : ${formatUsd(pnl30.current.net)}.`, href: "/dashboard/pnl" });
  const pausedRows = ((paused.data as any[]) || []) as any[];
  if (pausedRows.length) todo.push({ tone: "info", text: `Dépôts suspendus : ${pausedRows.map((p) => p.symbol).join(", ")}.`, href: "/dashboard/settings" });
  todo.push(...(await futuresTodos()));
  const futuresMoney = await loadFuturesMoney();
  todo.sort((a, b) => ORDER[a.tone] - ORDER[b.tone] || (b.usd ?? 0) - (a.usd ?? 0));

  // ── Statut unique : seuls « bad » et « warn » comptent ; « info » reste informatif ──
  const nBad = todo.filter((t) => t.tone === "bad").length;
  const nWarn = todo.filter((t) => t.tone === "warn").length;
  const tone: "ok" | "warn" | "bad" = nBad > 0 ? "bad" : nWarn > 0 ? "warn" : "ok";
  const statusTitle = tone === "ok" ? "Tout va bien" : tone === "bad" ? `${nBad + nWarn} point(s) à traiter, dont ${nBad} prioritaire(s)` : `${nWarn} point(s) à surveiller`;
  const statusText = tone === "ok" ? "Couverture, contrôles, transactions et prêts sont au vert." : "Les plus importants sont en haut de la liste « À traiter ».";

  const net30 = pnl30?.current.net ?? null;
  const queryErrors = [usersTotal.error?.message, usersActive.error?.message, usersNew.error?.message, volume.error?.message, credit.error?.message, recon.error?.message].filter(Boolean).join(" · ");
  const heldUsd = sol.error ? null : cov.heldUsd;

  // Actifs à regarder en premier : les moins couverts d'abord (même calcul que la page Actifs).
  const rank = (st: string) => (st === "short" ? 0 : st === "error" ? 1 : st === "sweep" ? 2 : st === "minor" ? 3 : 4);
  const assetRows = [...lines].sort((a, b) => rank(a.status) - rank(b.status) || lineRatio(a) - lineRatio(b) || a.asset.localeCompare(b.asset)).slice(0, 8);

  return (
    <div className="wk-exchange-dashboard">
      <PageHeader title="Accueil" subtitle="L'essentiel d'abord : l'état de la plateforme, les chiffres clés, puis ce qui demande ton attention." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={queryErrors ? `Certaines données sont indisponibles : ${queryErrors}` : null} />

      <div className={`wk-exchange-status wk-exchange-status-${tone}`}>
        <div className="wk-exchange-status-copy">
          <span className="wk-exchange-status-indicator" />
          <div>
            <span className="wk-exchange-eyebrow">ÉTAT DE LA PLATEFORME</span>
            <h2>{statusTitle}</h2>
            <p>{statusText}</p>
          </div>
        </div>
        <span className="wk-exchange-status-meta">{usersNew.count || 0} nouvel(s) utilisateur(s) sur 7 jours</span>
      </div>

      <div className="wk-exchange-kpis" style={{ marginTop: 16 }}>
        <Kpi label="Fonds détenus" value={heldUsd === null ? "—" : formatCompactUsd(heldUsd)} detail="valeur réelle (on-chain + prestataire)" href="/dashboard/assets" />
        <Kpi label="Couverture du dû" value={coveragePct === null ? "—" : formatPct(coveragePct)} detail={cov.missingUsd > 0.01 ? `manque ${formatUsd(cov.missingUsd)}` : "actif par actif"} href="/dashboard/assets" tone={coveragePct === null ? undefined : cov.missingUsd > 0.01 ? "negative" : "positive"} trend={coverageDelta} trendLabel="vs il y a 7 j" />
        <Kpi label="Utilisateurs actifs (7 j)" value={`${formatCompactNumber(usersActive.count || 0)} / ${formatCompactNumber(usersTotal.count || 0)}`} detail={`${formatCompactNumber(usersNew.count || 0)} nouveaux sur 7 j`} href="/dashboard/users" trend={newUsersDelta} trendLabel="nouveaux vs 7 j précédents" />
        <Kpi label="Volume (7 j)" value={formatCompactUsd(volume7d)} detail="hors jeux" href="/dashboard/transactions" trend={volumeDelta} trendLabel="vs 7 j précédents" />
        <Kpi label="Résultat (30 j)" value={net30 === null ? "—" : formatCompactUsd(net30)} detail="net de la plateforme" href="/dashboard/pnl" tone={net30 === null ? undefined : net30 < -0.005 ? "negative" : "positive"} trend={net30Delta} trendLabel="vs 30 j précédents" />
        <Kpi label="Transactions en attente" value={formatCompactNumber(pendingCount)} detail={stuckCount > 0 ? `${stuckCount} depuis plus d'1 h` : "aucune bloquée"} href="/dashboard/operations" tone={stuckCount > 0 ? "negative" : undefined} />
        <Kpi label="Échecs (24 h)" value={formatCompactNumber(failedCount)} detail="transactions échouées" href="/dashboard/operations#echecs" tone={failedCount > 0 ? "negative" : undefined} />
        <Kpi label="Prêts à surveiller" value={formatCompactNumber(atRisk)} detail="marge faible ou échéance dépassée" href="/dashboard/credit" tone={atRisk > 0 ? "negative" : undefined} />
      </div>

      <div className="wk-exchange-lower">
        <section className="wk-exchange-panel">
          <div className="wk-exchange-panel-head">
            <h2>À traiter</h2>
            <span className={`wk-exchange-count ${nBad > 0 ? "wk-exchange-count-bad" : nWarn > 0 ? "wk-exchange-count-warn" : ""}`}>{todo.length}</span>
          </div>
          {todo.length === 0 ? (
            <div className="wk-exchange-empty"><span>✓</span><div><strong>Rien à traiter</strong><p>Aucune alerte en ce moment.</p></div></div>
          ) : (
            <ul className="wk-exchange-todo">
              {todo.map((t, i) => (
                <li key={`${t.text}-${i}`} className={`wk-exchange-todo-item wk-exchange-todo-${t.tone}`}>
                  <span className="wk-exchange-todo-marker" />
                  <span className="wk-exchange-todo-text">{t.text}</span>
                  <a href={t.href}>Ouvrir →</a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wk-exchange-panel">
          <div className="wk-exchange-panel-head">
            <h2>Actifs à surveiller</h2>
            <a className="wk-link" href="/dashboard/assets">Tous les actifs →</a>
          </div>
          {assetRows.length === 0 ? (
            <div className="wk-exchange-empty"><div><strong>Aucun actif</strong><p>Les soldes n'ont pas pu être lus.</p></div></div>
          ) : (
            <div className="wk-kv">
              {assetRows.map((l) => (
                <div className="wk-kv-row" key={l.label} style={{ alignItems: "center" }}>
                  <span><a className="wk-link" href={`/dashboard/assets/${encodeURIComponent(l.asset)}`}>{l.asset}</a></span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{l.have === null ? null : <CoverageBar ratio={lineRatio(l)} tone={statusTone(l.status)} />}<Pill tone={statusTone(l.status)}>{statusLabel(l.status)}</Pill></span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {futuresMoney.data && (
        <Section title="Futures : résultat de la plateforme" hint="Frais encaissés et PNL de trading, en WAKATI. Détail dans Produits › Futures.">
          <MoneyHero money={futuresMoney.data} currency="WAKATI" usdPrice={prices.get("WAKATI") ?? null} compact />
        </Section>
      )}
    </div>
  );
}

function Kpi({ label, value, detail, href, tone, trend, trendLabel }: { label: string; value: string; detail?: string; href: string; tone?: "positive" | "negative"; trend?: Delta; trendLabel?: string }) {
  const showTrend = trend && trend.direction !== "na";
  return (
    <a className={`wk-exchange-kpi ${tone === "positive" ? "wk-exchange-kpi-positive" : tone === "negative" ? "wk-exchange-kpi-negative" : ""}`} href={href}>
      <span className="wk-exchange-kpi-arrow">→</span>
      <span className="wk-exchange-kpi-label">{label}</span>
      <span className="wk-exchange-kpi-value">{value}</span>
      {detail && <span className="wk-exchange-kpi-detail">{detail}</span>}
      {showTrend && (
        <span className="wk-exchange-kpi-detail" title={trend.unusual ? "Écart inhabituel (30 % ou plus)" : undefined}>
          <span className={trend.tone === "positive" ? "wk-ok" : trend.tone === "negative" ? "wk-bad" : ""}>{trend.text}</span>
          {trendLabel ? ` ${trendLabel}` : ""}{trend.unusual ? " · inhabituel" : ""}
        </span>
      )}
    </a>
  );
}
