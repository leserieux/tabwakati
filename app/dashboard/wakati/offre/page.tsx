import { getSupabaseAdmin } from "@/lib/data";
import { loadWakati } from "@/lib/wakati";
import { loadBurns } from "@/lib/burns";
import { loadEmission } from "@/lib/emission";
import { updateEmissionSettings } from "./actions";
import { formatToken, formatCompactNumber, formatPct, formatUsd, formatNumber, formatDateTime } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Flux réels de la trésorerie WAKATI, lus dans le journal (treasury_ledger).
 * « Sortie » = WAKATI qui quittent la trésorerie vers les utilisateurs ; une valeur négative = ce qui revient.
 * Les ajustements comptables, backfills, burns et retraits admin ne sont pas de l'émission : exclus du net.
 */
const FLOW_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "rewards", label: "Récompenses, bonus et gains aux jeux", types: ["payout_debit"] },
  { key: "sales", label: "WAKATI vendus aux utilisateurs (achats)", types: ["wakati_sale"] },
  { key: "swaps", label: "Swaps WAKATI ↔ autres actifs (net)", types: ["swap_out", "swap_in"] },
  { key: "loans", label: "Prêts accordés moins remboursés", types: ["loan_disbursement", "loan_repayment", "liquidation"] },
  { key: "fees", label: "Frais et mises encaissés", types: ["fee_credit"] },
  { key: "reclaim", label: "Reprises admin sur les utilisateurs", types: ["admin_reclaim"] }
];
const NON_EMISSION_TYPES = ["adjustment", "backfill", "burn", "admin_withdrawal"];

type FlowRow = { type: string; count: number; change: number };

async function loadTreasuryFlows(days: number): Promise<{ rows: FlowRow[]; days: number; error?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("get_wakati_treasury_flows", { p_days: days });
  const d: any = data || { rows: [], days };
  return {
    days: Number(d.days || days),
    rows: ((d.rows || []) as any[]).map((t) => ({ type: String(t.type), count: Number(t.count), change: Number(t.change) })),
    error: error?.message
  };
}

/** Sortie nette vers les utilisateurs pour des types d'écriture (positif = la trésorerie diminue). */
const outflow = (rows: FlowRow[], types: string[]) => -rows.filter((r) => types.includes(r.type)).reduce((n, r) => n + r.change, 0);

function Field({ label, name, defaultValue, hint, step = "any" }: { label: string; name: string; defaultValue: number | string; hint?: string; step?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step={step} defaultValue={defaultValue} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="wk-field-toggle">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ width: 16, height: 16 }} />
      {label}
    </label>
  );
}

export default async function OffrePage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const [w, burns, em] = await Promise.all([loadWakati(), loadBurns(), loadEmission()]);
  const cfg = em.settings;
  const [f90, f30] = await Promise.all([loadTreasuryFlows(cfg.runwayWindowDays), loadTreasuryFlows(30)]);
  const { inApp, wallet } = w;

  // Plafond propre à l'application (Burns > Réglages). Vide = automatique : WAKATI chez les utilisateurs + trésorerie interne.
  // Attention : en mode automatique le plafond suit l'offre réelle, donc il ne peut pas détecter un excédent. Fixe-le à 10 000 000 dans Burns > Réglages.
  const treasury = wallet?.balance ?? 0;
  const configuredCap = burns.rule?.supplyCapWakati ?? null;
  const existing = inApp.total + treasury;
  const cap = configuredCap ?? existing;
  const TOL = 0.001; // tolérance d'arrondi (WAKATI)
  const capBelowUsage = configuredCap !== null && configuredCap + TOL < existing;
  const excess = configuredCap !== null ? existing - configuredCap : 0;
  const missing = configuredCap !== null ? configuredCap - existing : 0;

  const net30 = FLOW_GROUPS.reduce((n, g) => n + outflow(f30.rows, g.types), 0);
  const scale = 30 / Math.max(f90.days, 1);
  const net90m = FLOW_GROUPS.reduce((n, g) => n + outflow(f90.rows, g.types), 0) * scale;
  const outOfScope30 = NON_EMISSION_TYPES.reduce((n, t) => n + f30.rows.filter((r) => r.type === t).reduce((m, r) => m + r.change, 0), 0);

  // Tenue de la trésorerie : sur la moyenne mensuelle des derniers jours (plus stable que 30 jours).
  // Si la sortie nette est nulle ou négative, la trésorerie ne baisse pas : il n'y a pas de durée à estimer.
  const runwayMonths = net90m > 0 ? treasury / net90m : null;
  const st = em.status;
  const budgetMonthly = treasury * (cfg.budgetPctPerMonth / 100);
  const usagePct = st?.usagePct ?? null;
  const modeLabel = !cfg.enabled ? "Désactivé" : cfg.enforce ? "Appliqué" : "Surveillance seule";
  const modeTone = !cfg.enabled ? "warn" : cfg.enforce ? "ok" : "info";

  const burnedBooked = wallet?.burned ?? 0;
  const rule = burns.rule;

  // Sensibilité du prix : prix = caisse / WAKATI disponibles chez les utilisateurs.
  const reserve = w.state?.reserveUsd ?? 0;
  const available = inApp.available;
  const STEP = cfg.priceStepWakati;
  const dilution = available + STEP > 0 ? (STEP / (available + STEP)) * 100 : 0;
  const rawPrice = available > 0 ? reserve / available : null;

  const yearsText = runwayMonths === null ? "Stable (la trésorerie ne baisse pas)" : runwayMonths >= 24 ? `${formatNumber(runwayMonths / 12, 1)} ans` : `${formatNumber(runwayMonths, 1)} mois`;

  return (
    <div>
      {capBelowUsage && (
        <div className="wk-alert-bad">Intégrité de l'offre : il y a {formatToken(excess)} WAKATI de trop par rapport au plafond de {formatToken(cap)} (utilisateurs + trésorerie = {formatToken(existing)}). Des jetons ont été créés par erreur dans la base : cherche l'écriture en cause dans le journal de trésorerie et corrige-la.</div>
      )}
      {configuredCap !== null && !capBelowUsage && missing > TOL && (
        <div className="wk-alert-ok">Offre interne : {formatToken(missing)} WAKATI sous le plafond de {formatToken(cap)} (jetons retirés, brûlés ou sortis de l'app).</div>
      )}
      {configuredCap === null && (
        <div className="wk-alert-bad">Aucun plafond n'est défini : l'offre affichée est simplement la somme de ce qui existe, donc un excédent passerait inaperçu. Fixe le plafond (10 000 000) dans Burns &gt; Réglages.</div>
      )}
      {searchParams.error && <div className="wk-alert-bad">{searchParams.msg || "Opération refusée."}</div>}
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.msg || "Enregistré."}</div>}
      {(w.errors.length > 0 || burns.error || f90.error || f30.error || em.error) && (
        <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {[...w.errors, burns.error, f90.error, f30.error, em.error].filter(Boolean).join(" · ")}</div>
      )}

      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Plafond de l'offre</div>
          <div className="wk-strip-value">{formatCompactNumber(cap)}</div>
          <div className="wk-strip-sub">{configuredCap !== null ? "défini dans l'app (Burns > Réglages)" : "automatique (en app + trésorerie)"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">{net30 >= 0 ? "Sortie nette sur 30 jours" : "Retour net sur 30 jours"}</div>
          <div className="wk-strip-value">{formatCompactNumber(net30)}</div>
          <div className="wk-strip-sub">{treasury > 0 ? `${formatPct((net30 / treasury) * 100, 2)} de la trésorerie` : "—"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Tenue de la trésorerie</div>
          <div className="wk-strip-value">{yearsText}</div>
          <div className="wk-strip-sub">{runwayMonths === null ? `sur les ${f90.days} derniers jours` : `au rythme moyen des ${f90.days} jours`}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Brûlé</div>
          <div className="wk-strip-value">{formatCompactNumber(burnedBooked)}</div>
          <div className="wk-strip-sub">"cumul comptable (in-app)"</div>
        </div>
      </div>

      <Section title="Principe" hint="L'offre ne grossit pas : elle est fixe. La seule chose qui bouge, c'est la part de la trésorerie qui passe chez les utilisateurs.">
        <div className="wk-callout">
          Aucun nouveau WAKATI n'est créé par ta plateforme. Les {formatToken(treasury)} WAKATI de la trésorerie sont le <strong>budget d'émission</strong> : ils sortent vers les utilisateurs (récompenses, achats, swaps, prêts) et reviennent en partie (frais, mises perdues, remboursements). Offre fixe : si utilisateurs + trésorerie dépasse le plafond, c'est une erreur de comptabilité, signalée en haut de page. Le burn retire des jetons de ce budget quand le prix atteint le seuil. Vérifie sur PolygonScan que le contrat ne possède pas de fonction de création (« mint ») : si elle existe, l'offre n'est pas réellement plafonnée.
        </div>
      </Section>

      <Section title="Flux de la trésorerie" hint="Lu dans le journal de trésorerie : tout ce qui sort vers les utilisateurs (positif) et tout ce qui revient (négatif), sur 30 jours et en moyenne mensuelle.">
        <TableWrap>
          <thead>
            <tr><Th>Flux</Th><Th right>30 jours</Th><Th right>{`Moyenne / mois (${f90.days} j)`}</Th><Th right hideSm>Valeur (30 j)</Th></tr>
          </thead>
          <tbody>
            {FLOW_GROUPS.map((g) => {
              const a = outflow(f30.rows, g.types);
              const b = outflow(f90.rows, g.types) * scale;
              return (
                <tr key={g.key}>
                  <Td>{g.label}</Td>
                  <Td right label="30 jours">{formatToken(a)}</Td>
                  <Td right label="Moyenne / mois">{formatToken(b)}</Td>
                  <Td right hideSm label="Valeur">{formatUsd(a * w.price)}</Td>
                </tr>
              );
            })}
            <tr>
              <Td><strong>{net30 >= 0 ? "Sortie nette vers les utilisateurs" : "Retour net vers la trésorerie"}</strong></Td>
              <Td right label="30 jours"><strong>{formatToken(net30)}</strong></Td>
              <Td right label="Moyenne / mois"><strong>{formatToken(net90m)}</strong></Td>
              <Td right hideSm label="Valeur"><strong>{formatUsd(net30 * w.price)}</strong></Td>
            </tr>
          </tbody>
        </TableWrap>
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          Un net négatif signifie que la trésorerie a reçu plus qu'elle n'a versé (frais, mises perdues, swaps vers d'autres actifs, remboursements) : ce n'est pas de la création de jetons. Les ajustements comptables et les burns ne sont pas comptés{Math.abs(outOfScope30) > TOL ? ` (${formatToken(outOfScope30)} WAKATI de ce type sur 30 jours)` : ""}.
        </div>
      </Section>

      <Section title="Plafond d'émission" hint={`Budget de ${formatNumber(cfg.budgetPctPerMonth, 2)} % de la trésorerie par mois, calculé sur ${cfg.windowDays} jours glissants. Appliqué automatiquement au staking et au parrainage ; les gains aux jeux sont comptés mais jamais bloqués.`}>
        <div className="wk-grid-2">
          <div className="wk-panel">
            <div className="wk-kv">
              <div className="wk-kv-row"><span>Mode</span><span><Pill tone={modeTone as any}>{modeLabel}</Pill></span></div>
              <div className="wk-kv-row"><span>Budget sur {cfg.windowDays} jours</span><span>{st ? `${formatToken(st.budget)} WAKATI` : "—"}</span></div>
              <div className="wk-kv-row"><span>Staking et parrainage utilisés</span><span>{st ? formatToken(st.incentivesUsed) : "—"}</span></div>
              <div className="wk-kv-row"><span>Jeux (gains moins mises), comptés</span><span>{st ? formatToken(st.gameNetUsed) : "—"}</span></div>
              <div className="wk-kv-row"><span>Total utilisé</span><span>{st ? formatToken(st.used) : "—"} {usagePct !== null && <Pill tone={usagePct >= 100 ? "warn" : usagePct >= 80 ? "warn" : "ok"}>{formatPct(usagePct, 0)} du budget</Pill>}</span></div>
              <div className="wk-kv-row"><span>Reste disponible</span><span>{st ? `${formatToken(st.remaining)} WAKATI` : "—"}</span></div>
              <div className="wk-kv-row"><span>Équivalent mensuel de référence</span><span>{formatToken(budgetMonthly)} WAKATI</span></div>
            </div>
          </div>
          <div className={usagePct !== null && usagePct >= 100 ? "wk-callout wk-callout-warn" : "wk-callout"}>
            {usagePct !== null && usagePct >= 100
              ? (cfg.enforce ? "Budget épuisé : les récompenses de staking du jour sont réduites (ou à zéro) et les bonus de parrainage ne sont plus versés jusqu'à ce que la fenêtre se libère. Les inscriptions fonctionnent normalement." : "Budget dépassé, mais le mode « surveillance seule » est actif : rien n'est réduit.")
              : "En dessous du budget : staking et parrainage sont payés normalement. Si le budget s'épuise, le staking du jour est réduit proportionnellement (jamais bloqué d'un coup) et le bonus de parrainage est sauté ; l'inscription et le lien de parrainage restent valides."}
            <div className="wk-asset-sub" style={{ marginTop: 8 }}>Le journal du plafond démarre au passage du staking de 00:05 UTC : le staking et le parrainage déjà versés avant ne comptent pas encore dans « utilisés ».</div>
          </div>
        </div>
        {em.log.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <TableWrap>
              <thead><tr><Th>Date</Th><Th>Source</Th><Th right>Demandé</Th><Th right>Accordé</Th><Th>Résultat</Th></tr></thead>
              <tbody>
                {em.log.map((x) => (
                  <tr key={x.id}>
                    <Td label="Date">{formatDateTime(new Date(x.at))}</Td>
                    <Td label="Source">{x.source === "staking" ? "Staking du jour" : x.source === "referral" ? "Bonus de parrainage" : x.source}</Td>
                    <Td right label="Demandé">{formatToken(x.requested)}</Td>
                    <Td right label="Accordé">{formatToken(x.allowed)}</Td>
                    <Td label="Résultat"><Pill tone={x.allowed >= x.requested ? "ok" : x.allowed > 0 ? "warn" : "bad"}>{x.allowed >= x.requested ? "Payé en entier" : x.allowed > 0 ? "Réduit" : "Sauté"}</Pill></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Section>

      <Section title="Réglages du plafond" hint="Tout se règle ici. Chaque modification est validée, enregistrée dans le journal d'audit (avant / après) et appliquée dès le prochain paiement.">
        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Plafond d'émission et parrainage</h3>
              <p className="wk-settings-hint">Budget = trésorerie WAKATI × pourcentage mensuel × (fenêtre ÷ 30).</p>
            </div>
            {cfg.updatedAt && <span className="wk-strip-sub">Modifié le {formatDateTime(new Date(cfg.updatedAt))}{cfg.updatedBy ? ` par ${cfg.updatedBy}` : ""}</span>}
          </div>
          <form action={updateEmissionSettings}>
            <div className="wk-form-grid">
              <Field label="Budget mensuel (% de la trésorerie WAKATI)" name="budget_pct_per_month" defaultValue={cfg.budgetPctPerMonth} hint="Plus bas = plus strict. Par exemple 0,5 % de 1 813 785 = 9 069 WAKATI par mois." />
              <Field label="Fenêtre de calcul (jours glissants)" name="window_days" defaultValue={cfg.windowDays} step="1" hint="Période sur laquelle on additionne ce qui a été émis." />
              <Field label="Bonus du filleul (WAKATI)" name="referral_bonus_referred" defaultValue={cfg.referralBonusReferred} hint="Versé au nouvel inscrit qui utilise un code." />
              <Field label="Bonus du parrain (WAKATI)" name="referral_bonus_referrer" defaultValue={cfg.referralBonusReferrer} hint="Versé au propriétaire du code." />
              <Field label="Pas de l'exemple « effet sur le prix » (WAKATI)" name="price_step_wakati" defaultValue={cfg.priceStepWakati} hint="Utilisé par la section Effet sur le prix de cette page." />
              <Field label="Fenêtre de la tenue de trésorerie (jours)" name="runway_window_days" defaultValue={cfg.runwayWindowDays} step="1" hint="Moyenne d'émission utilisée pour estimer la durée de tenue." />
              <Toggle label="Plafond activé (décoché = aucun suivi, aucun blocage)" name="enabled" defaultChecked={cfg.enabled} />
              <Toggle label="Appliquer le plafond (décoché = surveillance seule)" name="enforce" defaultChecked={cfg.enforce} />
              <Toggle label="Compter les gains nets des jeux dans le budget" name="count_game_net" defaultChecked={cfg.countGameNet} />
              <Toggle label="Limiter le staking quand le budget est épuisé" name="gate_staking" defaultChecked={cfg.gateStaking} />
              <Toggle label="Sauter le bonus de parrainage quand le budget est épuisé" name="gate_referral" defaultChecked={cfg.gateReferral} />
            </div>
            <button type="submit" className="wk-submit-sm">Enregistrer le plafond</button>
          </form>
        </div>
      </Section>

      <Section title="Règle d'ajustement de l'offre" hint="Pas de création de jetons : l'offre s'ajuste avec le burn et le budget d'émission.">
        <div className="wk-panel">
          <div className="wk-kv">
            <div className="wk-kv-row"><span>Prix du WAKATI</span><span>{rule?.priceFcfa == null ? "—" : `${formatNumber(rule.priceFcfa, 4)} FCFA`}</span></div>
            <div className="wk-kv-row"><span>Seuil pour commencer le burn</span><span>{rule ? `${formatNumber(rule.thresholdFcfa, 2)} FCFA (${rule.progressPct == null ? "—" : formatNumber(rule.progressPct, 1)} % atteint)` : "—"}</span></div>
            <div className="wk-kv-row"><span>État</span><span>{!rule ? "—" : !rule.enabled ? <Pill tone="warn">En pause</Pill> : rule.active ? <Pill tone="ok">Burn actif</Pill> : <Pill tone="info">Burn inactif : tout va dans la caisse</Pill>}</span></div>
            <div className="wk-kv-row"><span>Part du bénéfice brûlée au-dessus du seuil</span><span>{rule ? `${formatNumber(rule.sharePct, 0)} %` : "—"}</span></div>
            <div className="wk-kv-row"><span>Caisse (réserve de prix)</span><span>{formatUsd(reserve)}</span></div>
          </div>
        </div>
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>Réglages modifiables dans l'onglet Burns.</div>
      </Section>

      <Section title="Effet sur le prix" hint="Le prix calculé est la caisse divisée par les WAKATI disponibles chez les utilisateurs (hors staking). Toute émission vers les utilisateurs agrandit ce dénominateur.">
        <div className="wk-grid-2">
          <div className="wk-panel">
            <div className="wk-kv">
              <div className="wk-kv-row"><span>Caisse</span><span>{formatUsd(reserve)}</span></div>
              <div className="wk-kv-row"><span>WAKATI disponibles chez les utilisateurs</span><span>{formatToken(available)}</span></div>
              <div className="wk-kv-row"><span>Prix brut calculé</span><span>{rawPrice === null ? "—" : `${formatNumber(rawPrice, 8)} $`}</span></div>
              <div className="wk-kv-row"><span>+ {formatToken(STEP)} WAKATI distribués</span><span>≈ −{formatPct(dilution, 1)} sur ce prix</span></div>
            </div>
          </div>
          <div className="wk-callout wk-callout-warn">
            Plus le nombre de WAKATI disponibles est faible, plus chaque distribution pèse sur le prix. Les WAKATI en staking ({formatToken(inApp.staking)}) ne comptent pas ici : si beaucoup de stakers retirent d'un coup, le prix calculé baisse mécaniquement.
          </div>
        </div>
      </Section>

      <Section title="Résumé pour un investisseur" hint="Des faits mesurables, sans promesse de rendement. À faire valider juridiquement avant toute communication.">
        <div className="wk-panel">
          <div className="wk-kv">
            <div className="wk-kv-row"><span>Offre totale (plafond)</span><span>{formatToken(cap)} WAKATI</span></div>
            <div className="wk-kv-row"><span>Part encore en trésorerie</span><span>{cap > 0 ? formatPct((treasury / cap) * 100, 1) : "—"}</span></div>
            <div className="wk-kv-row"><span>En circulation chez les utilisateurs</span><span>{formatToken(inApp.total)} ({cap > 0 ? formatPct((inApp.total / cap) * 100, 2) : "—"})</span></div>
            <div className="wk-kv-row"><span>Brûlé à ce jour</span><span>{formatToken(burnedBooked)} WAKATI</span></div>
            <div className="wk-kv-row"><span>{net90m >= 0 ? "Sortie nette moyenne" : "Retour net moyen"}</span><span>{formatToken(net90m)} WAKATI / mois</span></div>
            <div className="wk-kv-row"><span>Tenue de la trésorerie à ce rythme</span><span>{yearsText}</span></div>
            <div className="wk-kv-row"><span>Création de nouveaux jetons</span><span>Aucune par la plateforme</span></div>
          </div>
        </div>
      </Section>
    </div>
  );
}
