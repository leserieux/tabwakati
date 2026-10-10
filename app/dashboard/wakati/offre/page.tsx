import { getSupabaseAdmin } from "@/lib/data";
import { loadWakati } from "@/lib/wakati";
import { loadBurns } from "@/lib/burns";
import { formatToken, formatCompactNumber, formatPct, formatUsd, formatNumber } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ce qui sort de la trésorerie vers les utilisateurs (nouveaux WAKATI en circulation). */
const EMISSIONS: { type: string; label: string }[] = [
  { type: "staking_reward", label: "Récompenses de staking" },
  { type: "referral_bonus", label: "Bonus de parrainage" },
  { type: "game_win", label: "Gains aux jeux" }
];
/** Ce qui revient dans la trésorerie : les mises perdues. */
const RETURN_TYPE = "game_bet";

/** Repère de budget (non appliqué automatiquement) : part de la trésorerie émise nette par mois. */
const BUDGET_PCT_PER_MONTH = 0.5;

type FlowRow = { type: string; count: number; total: number };

async function loadFlows(days: number): Promise<{ rows: FlowRow[]; days: number; error?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("get_wakati_flows", { p_days: days });
  const d: any = data || { tx: [], days };
  return {
    days: Number(d.days || days),
    rows: ((d.tx || []) as any[]).map((t) => ({ type: String(t.type), count: Number(t.count), total: Number(t.total) })),
    error: error?.message
  };
}

export default async function OffrePage() {
  const [w, burns, f90] = await Promise.all([loadWakati(), loadBurns(), loadFlows(90)]);
  const { chain, inApp, wallet } = w;

  // Plafond propre à l'application (Burns > Réglages). Vide = automatique : WAKATI chez les utilisateurs + trésorerie interne.
  // Ce n'est pas l'offre de la blockchain.
  const treasury = wallet?.balance ?? 0;
  const configuredCap = burns.rule?.supplyCapWakati ?? null;
  const cap = configuredCap ?? inApp.total + treasury;
  const capBelowUsage = configuredCap !== null && configuredCap < inApp.total + treasury;

  const sum = (rows: FlowRow[], types: string[]) => rows.filter((r) => types.includes(r.type)).reduce((n, r) => n + r.total, 0);
  const f30 = w.flows;

  const em30 = sum(f30.tx, EMISSIONS.map((e) => e.type));
  const ret30 = sum(f30.tx, [RETURN_TYPE]);
  const net30 = em30 - ret30;

  const scale = 30 / Math.max(f90.days, 1);
  const em90m = sum(f90.rows, EMISSIONS.map((e) => e.type)) * scale;
  const ret90m = sum(f90.rows, [RETURN_TYPE]) * scale;
  const net90m = em90m - ret90m;

  // Tenue de la trésorerie : sur la moyenne mensuelle des 90 derniers jours (plus stable que 30 jours).
  const runwayMonths = net90m > 0 ? treasury / net90m : null;
  const budget = treasury * (BUDGET_PCT_PER_MONTH / 100);
  const usage90 = budget > 0 ? (Math.max(net90m, 0) / budget) * 100 : 0;
  const usage30 = budget > 0 ? (Math.max(net30, 0) / budget) * 100 : 0;

  const burnedOnchain = chain.burned ?? 0;
  const burnedBooked = wallet?.burned ?? 0;
  const rule = burns.rule;

  // Sensibilité du prix : prix = caisse / WAKATI disponibles chez les utilisateurs.
  const reserve = w.state?.reserveUsd ?? 0;
  const available = inApp.available;
  const STEP = 10_000;
  const dilution = available + STEP > 0 ? (STEP / (available + STEP)) * 100 : 0;
  const rawPrice = available > 0 ? reserve / available : null;

  const yearsText = runwayMonths === null ? "Illimitée" : runwayMonths >= 24 ? `${formatNumber(runwayMonths / 12, 1)} ans` : `${formatNumber(runwayMonths, 1)} mois`;

  return (
    <div>
      {capBelowUsage && (
        <div className="wk-alert-bad">Le plafond défini ({formatToken(cap)} WAKATI) est inférieur à ce qui existe déjà dans l'app ({formatToken(inApp.total + treasury)} WAKATI chez les utilisateurs et en trésorerie). Corrige-le dans Burns &gt; Réglages.</div>
      )}
      {(w.errors.length > 0 || burns.error || f90.error) && (
        <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {[...w.errors, burns.error, f90.error].filter(Boolean).join(" · ")}</div>
      )}

      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Plafond de l'offre</div>
          <div className="wk-strip-value">{formatCompactNumber(cap)}</div>
          <div className="wk-strip-sub">{configuredCap !== null ? "défini dans l'app (Burns > Réglages)" : "automatique (en app + trésorerie)"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Émission nette sur 30 jours</div>
          <div className="wk-strip-value">{formatCompactNumber(net30)}</div>
          <div className="wk-strip-sub">{treasury > 0 ? `${formatPct((net30 / treasury) * 100, 2)} de la trésorerie` : "—"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Tenue de la trésorerie</div>
          <div className="wk-strip-value">{yearsText}</div>
          <div className="wk-strip-sub">{runwayMonths === null ? "elle ne baisse pas (90 j)" : "au rythme moyen des 90 jours"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Brûlé</div>
          <div className="wk-strip-value">{formatCompactNumber(Math.max(burnedOnchain, burnedBooked))}</div>
          <div className="wk-strip-sub">{burns.pendingCount > 0 ? `${formatToken(burns.pendingAmount)} à envoyer on-chain` : "cumul comptable ou on-chain"}</div>
        </div>
      </div>

      <Section title="Principe" hint="L'offre ne grossit pas : elle est fixe. La seule chose qui bouge, c'est la part de la trésorerie qui passe chez les utilisateurs.">
        <div className="wk-callout">
          Aucun nouveau WAKATI n'est créé par ta plateforme. Les {formatToken(treasury)} WAKATI de la trésorerie sont le <strong>budget d'émission</strong> : ils sortent vers les utilisateurs (staking, parrainage, gains aux jeux) et reviennent en partie (mises). Le burn retire des jetons de ce budget quand le prix atteint le seuil. Vérifie sur PolygonScan que le contrat ne possède pas de fonction de création (« mint ») : si elle existe, l'offre n'est pas réellement plafonnée.
        </div>
      </Section>

      <Section title="Ce qui sort de la trésorerie" hint="Nouveaux WAKATI mis en circulation chez les utilisateurs, par source, sur 30 jours et en moyenne mensuelle sur 90 jours.">
        <TableWrap>
          <thead>
            <tr><Th>Source</Th><Th right>30 jours</Th><Th right>Moyenne / mois (90 j)</Th><Th right hideSm>Valeur (30 j)</Th></tr>
          </thead>
          <tbody>
            {EMISSIONS.map((e) => {
              const a = sum(f30.tx, [e.type]);
              const b = sum(f90.rows, [e.type]) * scale;
              return (
                <tr key={e.type}>
                  <Td>{e.label}</Td>
                  <Td right label="30 jours">{formatToken(a)}</Td>
                  <Td right label="Moyenne / mois">{formatToken(b)}</Td>
                  <Td right hideSm label="Valeur">{formatUsd(a * w.price)}</Td>
                </tr>
              );
            })}
            <tr>
              <Td><strong>Total émis</strong></Td>
              <Td right label="30 jours"><strong>{formatToken(em30)}</strong></Td>
              <Td right label="Moyenne / mois"><strong>{formatToken(em90m)}</strong></Td>
              <Td right hideSm label="Valeur"><strong>{formatUsd(em30 * w.price)}</strong></Td>
            </tr>
            <tr>
              <Td>Mises qui reviennent en trésorerie</Td>
              <Td right label="30 jours">− {formatToken(ret30)}</Td>
              <Td right label="Moyenne / mois">− {formatToken(ret90m)}</Td>
              <Td right hideSm label="Valeur">− {formatUsd(ret30 * w.price)}</Td>
            </tr>
            <tr>
              <Td><strong>Émission nette</strong></Td>
              <Td right label="30 jours"><strong>{formatToken(net30)}</strong></Td>
              <Td right label="Moyenne / mois"><strong>{formatToken(net90m)}</strong></Td>
              <Td right hideSm label="Valeur"><strong>{formatUsd(net30 * w.price)}</strong></Td>
            </tr>
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Budget d'émission" hint={`Repère de ${formatNumber(BUDGET_PCT_PER_MONTH, 1)} % de la trésorerie par mois. C'est une référence affichée ici : elle n'est pas encore appliquée automatiquement aux paiements.`}>
        <div className="wk-grid-2">
          <div className="wk-panel">
            <div className="wk-kv">
              <div className="wk-kv-row"><span>Budget mensuel de référence</span><span>{formatToken(budget)} WAKATI</span></div>
              <div className="wk-kv-row"><span>Émission nette, 30 derniers jours</span><span>{formatToken(Math.max(net30, 0))} <Pill tone={usage30 > 100 ? "warn" : "ok"}>{formatPct(usage30, 0)} du budget</Pill></span></div>
              <div className="wk-kv-row"><span>Émission nette, moyenne 90 jours</span><span>{formatToken(Math.max(net90m, 0))} <Pill tone={usage90 > 100 ? "warn" : "ok"}>{formatPct(usage90, 0)} du budget</Pill></span></div>
            </div>
          </div>
          <div className={usage90 > 100 || usage30 > 100 ? "wk-callout wk-callout-warn" : "wk-callout"}>
            {usage90 > 100 || usage30 > 100
              ? "L'émission dépasse le repère : surveille surtout les gains aux jeux, qui varient beaucoup d'un mois à l'autre."
              : "L'émission reste sous le repère. Les gains aux jeux sont la part la plus variable : une série de gros gains peut dépasser le budget en quelques jours."}
          </div>
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
            <div className="wk-kv-row"><span>Brûlé à ce jour</span><span>{formatToken(Math.max(burnedOnchain, burnedBooked))} WAKATI</span></div>
            <div className="wk-kv-row"><span>Émission nette moyenne</span><span>{formatToken(net90m)} WAKATI / mois</span></div>
            <div className="wk-kv-row"><span>Tenue de la trésorerie à ce rythme</span><span>{yearsText}</span></div>
            <div className="wk-kv-row"><span>Création de nouveaux jetons</span><span>Aucune par la plateforme</span></div>
          </div>
        </div>
      </Section>
    </div>
  );
}
