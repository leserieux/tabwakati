import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";
import { addTask, updateTaskStatus, deleteTask, createTaskFromSuggestion } from "./actions";
import { StatusSelect, DeleteTaskButton } from "./TaskRowControls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Task = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "done" | "wontfix";
  source: "manual" | "auto";
  source_key: string | null;
  created_at: string;
  completed_at: string | null;
};

type Suggestion = { key: string; title: string; description: string; category: string; priority: "low" | "medium" | "high"; href?: string };

const CATEGORY_LABEL: Record<string, string> = { produit: "Produit", fiabilite: "Fiabilité", securite: "Sécurité", donnees: "Données", autre: "Autre" };
const PRIORITY_LABEL: Record<string, string> = { high: "Haute", medium: "Moyenne", low: "Basse" };
const PRIORITY_TONE: Record<string, Tone> = { high: "bad", medium: "warn", low: "info" };
const STATUS_LABEL: Record<string, string> = { todo: "À faire", in_progress: "En cours", done: "Terminé", wontfix: "Ne sera pas fait" };
const STATUS_ORDER: Record<string, number> = { todo: 0, in_progress: 1, done: 2, wontfix: 3 };

function formatDuration(ms: number): string {
  const mins = ms / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)} j`;
  return `${Math.round(days / 30)} mois`;
}

function maxAgeHours(coingeckoId: string | null, network: string): number {
  if (coingeckoId) return 3;
  if (network === "Fiat") return 48;
  return 36;
}

async function computeSuggestions(): Promise<Suggestion[]> {
  const db = getSupabaseAdmin();
  const suggestions: Suggestion[] = [];

  const [assetsRes, pricesRes, flagsRes, addressesRes, minSweepRes, creditRes, wheelRes, kycCountRes] = await Promise.all([
    q<{ symbol: string; name: string; network: string; coingecko_id: string | null }>(db.from("supported_assets").select("symbol, name, network, coingecko_id").eq("is_active", true)),
    q<{ asset_symbol: string; price_usd: number | null; updated_at: string | null }>(db.from("asset_prices_resolved").select("asset_symbol, price_usd, updated_at")),
    q<{ flag_type: string; severity: string }>(db.from("user_risk_flags").select("flag_type, severity").eq("status", "open")),
    q<{ id: string; asset_symbol: string; network: string; cached_balance: number }>(db.from("user_addresses").select("id, asset_symbol, network, cached_balance").eq("is_active", true).gt("cached_balance", 0)),
    q<{ symbol: string; network: string; min_sweep: number }>(db.from("supported_assets").select("symbol, network, min_sweep")),
    db.from("admin_credit_summary").select("loans_a_risque, score_loans_a_risque").maybeSingle(),
    db.from("admin_wheel_summary").select("rtp_paid_pct").maybeSingle(),
    db.from("user_kyc").select("user_id", { count: "exact", head: true })
  ]);

  // 1) Prix absents/à 0/périmés
  const priceBy = new Map(pricesRes.rows.map((p) => [p.asset_symbol, p]));
  for (const a of assetsRes.rows) {
    const p = priceBy.get(a.symbol);
    const limit = maxAgeHours(a.coingecko_id, a.network);
    const ageHours = p && p.updated_at ? (Date.now() - new Date(p.updated_at).getTime()) / 3600000 : null;
    if (!p || p.updated_at === null) {
      suggestions.push({ key: `price:missing:${a.symbol}`, title: `Aucun cours pour ${a.symbol}`, description: `${a.name} n'a aucun cours valide : il est exclu des valorisations USD du dashboard.`, category: "donnees", priority: "medium", href: "/dashboard/markets" });
    } else if (!(Number(p.price_usd) > 0)) {
      suggestions.push({ key: `price:zero:${a.symbol}`, title: `Cours à 0 pour ${a.symbol}`, description: `Le dernier cours enregistré est 0$, ce qui fausse toute valorisation USD de cet actif.`, category: "donnees", priority: "medium", href: "/dashboard/markets" });
    } else if (ageHours !== null && ageHours > limit) {
      suggestions.push({ key: `price:stale:${a.symbol}`, title: `Cours périmé pour ${a.symbol}`, description: `Dernière mise à jour il y a plus de ${Math.round(limit)}h. Vérifier le flux de prix (CoinGecko ou calcul interne).`, category: "donnees", priority: "low", href: "/dashboard/markets" });
    }
  }

  // 2) Flags de risque ouverts, groupés par type
  const flagCounts = new Map<string, number>();
  const flagSeverity = new Map<string, string>();
  for (const f of flagsRes.rows) {
    flagCounts.set(f.flag_type, (flagCounts.get(f.flag_type) || 0) + 1);
    if (f.severity === "high" || !flagSeverity.has(f.flag_type)) flagSeverity.set(f.flag_type, f.severity);
  }
  for (const [type, count] of flagCounts) {
    suggestions.push({
      key: `risk_flags:${type}`,
      title: `${count} signal(aux) de risque ouvert(s) : ${type}`,
      description: "Voir la fiche utilisateur de chaque compte concerné pour investiguer.",
      category: "securite",
      priority: flagSeverity.get(type) === "high" ? "high" : "medium",
      href: "/dashboard/users"
    });
  }

  // 3) Adresses à balayer
  const minSweepBy = new Map(minSweepRes.rows.map((a) => [`${a.symbol}::${a.network}`, Number(a.min_sweep)]));
  const toSweep = addressesRes.rows.filter((a) => Number(a.cached_balance) >= (minSweepBy.get(`${a.asset_symbol}::${a.network}`) ?? Infinity));
  if (toSweep.length > 0) {
    suggestions.push({ key: "sweep_pending", title: `${toSweep.length} adresse(s) au-dessus du seuil de balayage`, description: "Des fonds utilisateurs sont prêts à être balayés vers la trésorerie.", category: "fiabilite", priority: "medium", href: "/dashboard/sweep" });
  }

  // 4) Crédit à risque
  const credit = creditRes.data as { loans_a_risque: number; score_loans_a_risque: number } | null;
  const creditAtRisk = (credit?.loans_a_risque || 0) + (credit?.score_loans_a_risque || 0);
  if (creditAtRisk > 0) {
    suggestions.push({ key: "loans_at_risk", title: `${creditAtRisk} prêt(s) proche(s) de la liquidation ou en grâce`, description: "Vérifier s'il faut relancer les emprunteurs ou ajuster les paramètres de risque.", category: "produit", priority: "high", href: "/dashboard/credit" });
  }

  // 5) RTP roue anormal
  const wheel = wheelRes.data as { rtp_paid_pct: number | null } | null;
  if (wheel?.rtp_paid_pct !== null && wheel?.rtp_paid_pct !== undefined && wheel.rtp_paid_pct > 110) {
    suggestions.push({ key: "wheel_rtp_anomaly", title: `RTP de la roue à ${wheel.rtp_paid_pct.toFixed(1)}% (tours payants)`, description: "La plateforme paie significativement plus qu'elle ne prend sur les tours payants. Vérifier la config des segments.", category: "produit", priority: "medium", href: "/dashboard/games" });
  }

  // 6) KYC jamais utilisé
  const kycCount = kycCountRes.count ?? 0;
  if (kycCount === 0) {
    suggestions.push({ key: "kyc_missing_global", title: "Aucun utilisateur n'a de dossier KYC", description: "Le score de risque KYC est constant pour tout le monde tant que ce n'est pas collecté. Décider si le KYC doit être mis en place.", category: "securite", priority: "low", href: "/dashboard/settings" });
  }

  return suggestions;
}

export default async function TasksPage() {
  const db = getSupabaseAdmin();

  const [tasksRes, suggestions] = await Promise.all([
    q<Task>(db.from("admin_tasks").select("*").order("created_at", { ascending: false })),
    computeSuggestions()
  ]);

  const errors = tasksRes.error || "";
  const trackedKeys = new Set(
    tasksRes.rows.filter((t) => t.status !== "done" && t.status !== "wontfix" && t.source === "auto" && t.source_key).map((t) => t.source_key as string)
  );
  const openSuggestions = suggestions.filter((s) => !trackedKeys.has(s.key));

  const openTasks = tasksRes.rows.filter((t) => t.status === "todo" || t.status === "in_progress");
  const highPriorityOpen = openTasks.filter((t) => t.priority === "high");
  const doneThisMonth = tasksRes.rows.filter((t) => t.status === "done" && t.completed_at && new Date(t.completed_at).getMonth() === new Date().getMonth() && new Date(t.completed_at).getFullYear() === new Date().getFullYear());

  const sortedOpenTasks = [...openTasks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : b.priority === "high" ? 1 : 0) || +new Date(b.created_at) - +new Date(a.created_at)
  );

  const closedTasks = tasksRes.rows.filter((t) => t.status === "done" || t.status === "wontfix");
  const sortedClosedTasks = [...closedTasks].sort((a, b) => +new Date(b.completed_at || b.created_at) - +new Date(a.completed_at || a.created_at));

  const resolvedWithDuration = tasksRes.rows.filter((t) => t.status === "done" && t.completed_at);
  const avgResolutionMs = resolvedWithDuration.length
    ? resolvedWithDuration.reduce((sum, t) => sum + (new Date(t.completed_at as string).getTime() - new Date(t.created_at).getTime()), 0) / resolvedWithDuration.length
    : null;

  return (
    <div>
      <PageHeader title="Tâches" subtitle="Ce qui reste à faire sur l'app, la base de données et le dashboard — suggestions automatiques et suivi manuel." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Tâches ouvertes" value={String(openTasks.length)} sub={`${highPriorityOpen.length} en priorité haute`} tone={highPriorityOpen.length > 0 ? "bad" : undefined} />
        <StatCard label="Suggestions non traitées" value={String(openSuggestions.length)} sub="Anomalies détectées ailleurs dans le dashboard" tone={openSuggestions.length > 0 ? "warn" : "ok"} />
        <StatCard label="Terminées ce mois-ci" value={String(doneThisMonth.length)} sub="Tâches marquées comme faites" />
        <StatCard label="Temps moyen de résolution" value={avgResolutionMs !== null ? formatDuration(avgResolutionMs) : "—"} sub={`Sur ${resolvedWithDuration.length} tâche(s) terminée(s)`} />
      </div>

      <Section title="Suggestions automatiques" hint="Générées à chaque chargement de page à partir des anomalies déjà détectées ailleurs (Marchés, Utilisateurs, Balayage, Crédit, Jeux). Convertis-les en tâche pour les suivre, ou ignore-les si ce n'est pas pertinent.">
        {openSuggestions.length === 0 ? (
          <Empty text="Aucune anomalie détectée en ce moment." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Suggestion</Th>
                <Th>Catégorie</Th>
                <Th>Priorité</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {openSuggestions.map((s) => (
                <tr key={s.key}>
                  <Td label="Suggestion">
                    <div>{s.href ? <a className="wk-link" href={s.href}>{s.title}</a> : s.title}</div>
                    <div className="wk-asset-sub">{s.description}</div>
                  </Td>
                  <Td label="Catégorie">{CATEGORY_LABEL[s.category] || s.category}</Td>
                  <Td label="Priorité"><Pill tone={PRIORITY_TONE[s.priority]}>{PRIORITY_LABEL[s.priority]}</Pill></Td>
                  <Td label="Action">
                    <form action={createTaskFromSuggestion}>
                      <input type="hidden" name="title" value={s.title} />
                      <input type="hidden" name="description" value={s.description} />
                      <input type="hidden" name="category" value={s.category} />
                      <input type="hidden" name="priority" value={s.priority} />
                      <input type="hidden" name="source_key" value={s.key} />
                      <button type="submit" className="wk-submit-sm">Suivre comme tâche</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Ajouter une tâche">
        <form action={addTask}>
          <div className="wk-form-grid">
            <div>
              <label className="wk-label" htmlFor="title">Titre</label>
              <input id="title" name="title" type="text" required className="wk-input" />
            </div>
            <div>
              <label className="wk-label" htmlFor="category">Catégorie</label>
              <select id="category" name="category" defaultValue="autre" className="wk-input">
                <option value="produit">Produit</option>
                <option value="fiabilite">Fiabilité</option>
                <option value="securite">Sécurité</option>
                <option value="donnees">Données</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label className="wk-label" htmlFor="priority">Priorité</label>
              <select id="priority" name="priority" defaultValue="medium" className="wk-input">
                <option value="high">Haute</option>
                <option value="medium">Moyenne</option>
                <option value="low">Basse</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="wk-label" htmlFor="description">Description</label>
              <textarea id="description" name="description" rows={2} className="wk-input" />
            </div>
          </div>
          <button type="submit" className="wk-submit-sm" style={{ marginTop: 8 }}>Ajouter</button>
        </form>
      </Section>

      <Section title="Tâches ouvertes" hint="À faire ou en cours. Change le statut directement depuis la liste.">
        {sortedOpenTasks.length === 0 ? (
          <Empty text="Aucune tâche ouverte." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Tâche</Th>
                <Th>Catégorie</Th>
                <Th>Priorité</Th>
                <Th>Statut</Th>
                <Th hideSm>Créée le</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sortedOpenTasks.map((t) => (
                <tr key={t.id}>
                  <Td label="Tâche">
                    <div>{t.title} {t.source === "auto" && <Pill tone="info">Auto</Pill>}</div>
                    {t.description && <div className="wk-asset-sub">{t.description}</div>}
                  </Td>
                  <Td label="Catégorie">{CATEGORY_LABEL[t.category] || t.category}</Td>
                  <Td label="Priorité"><Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill></Td>
                  <Td label="Statut">
                    <StatusSelect action={updateTaskStatus} id={t.id} title={t.title} status={t.status} />
                  </Td>
                  <Td hideSm label="Créée le"><span className="wk-asset-sub">{formatDateTime(new Date(t.created_at))}</span></Td>
                  <Td label="Actions">
                    <DeleteTaskButton action={deleteTask} id={t.id} title={t.title} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Tâches terminées" hint="Terminées ou classées « ne sera pas fait », les plus récentes d'abord, avec le temps écoulé entre la création et la clôture.">
        {sortedClosedTasks.length === 0 ? (
          <Empty text="Aucune tâche terminée pour l'instant." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Tâche</Th>
                <Th>Catégorie</Th>
                <Th>Priorité</Th>
                <Th>Résultat</Th>
                <Th hideSm>Clôturée le</Th>
                <Th right>Temps de résolution</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sortedClosedTasks.map((t) => {
                const duration = t.completed_at ? formatDuration(new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) : null;
                return (
                  <tr key={t.id}>
                    <Td label="Tâche">
                      <div>{t.title} {t.source === "auto" && <Pill tone="info">Auto</Pill>}</div>
                      {t.description && <div className="wk-asset-sub">{t.description}</div>}
                    </Td>
                    <Td label="Catégorie">{CATEGORY_LABEL[t.category] || t.category}</Td>
                    <Td label="Priorité"><Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill></Td>
                    <Td label="Résultat"><Pill tone={t.status === "done" ? "ok" : "info"}>{STATUS_LABEL[t.status]}</Pill></Td>
                    <Td hideSm label="Clôturée le"><span className="wk-asset-sub">{t.completed_at ? formatDateTime(new Date(t.completed_at)) : "—"}</span></Td>
                    <Td right label="Temps de résolution">{duration ?? "—"}</Td>
                    <Td label="Actions">
                      <StatusSelect action={updateTaskStatus} id={t.id} title={t.title} status={t.status} />
                      <DeleteTaskButton action={deleteTask} id={t.id} title={t.title} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className={`wk-strip-value${tone ? ` wk-${tone}` : ""}`}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
