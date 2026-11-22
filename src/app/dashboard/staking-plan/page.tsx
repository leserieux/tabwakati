import { loadPrices } from "@/core/db/data";
import { loadSolvencyLines } from "@/modules/treasury/solvency";
import { buildPlans, loadSwapStock } from "@/modules/treasury/custody-policy";
import type { PlanLine } from "@/modules/treasury/custody-plan";
import { loadStakingPlanData } from "@/modules/treasury/staking-plan-data";
import {
  HORIZONS_DECISION, HORIZONS_VIEW, SCENARIOS, byLockPeriod, decideAsset, interestOver, isFlexible, totalsOf, unlockWithin,
  type AssetDecision, type DecisionHorizon, type Scenario, type StakingPool, type Verdict
} from "@/modules/treasury/staking-plan";
import { formatDateTime, formatNumber, formatUsd, formatPct, shortId } from "@/core/format";
import { PageHeader, Section, TableWrap, Td, Th, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERDICT: Record<Verdict, { tone: Tone; label: string }> = {
  deploy: { tone: "ok", label: "Envoyer en staking" },
  hold: { tone: "info", label: "Ne rien envoyer" },
  shortfall: { tone: "bad", label: "Il manque des fonds" },
  mobile: { tone: "info", label: "Argent mobile" },
  internal: { tone: "info", label: "Jeton interne" },
  nodata: { tone: "warn", label: "Solde illisible" }
};

const n4 = (v: number) => formatNumber(v, v >= 100 ? 2 : 4);
const usdOf = (v: number, price: number | null) => (price !== null && price > 0 ? formatUsd(v * price) : null);
function Amount({ v, asset, price }: { v: number; asset: string; price: number | null }) {
  const u = usdOf(v, price);
  return <>{n4(v)} <span className="wk-asset-sub">{asset}</span>{u && <div className="wk-asset-sub">≈ {u}</div>}</>;
}

function lockLabel(p: StakingPool) { return isFlexible(p) ? "Flexible" : `Bloqué ${p.lockDays} j`; }

export default async function StakingPlanPage({ searchParams }: { searchParams: { h?: string; s?: string } }) {
  const hNum = Number(searchParams.h);
  const horizon: DecisionHorizon = (HORIZONS_DECISION as readonly number[]).includes(hNum) ? (hNum as DecisionHorizon) : 30;
  const scenario: Scenario = searchParams.s === "prudent" || searchParams.s === "extreme" ? searchParams.s : "normal";

  const prices = await loadPrices();
  const [planRes, treasury, sol] = await Promise.all([
    loadStakingPlanData(),
    loadSwapStock().catch(() => new Map<string, number>()),
    loadSolvencyLines(prices).catch((e: any) => ({ crypto: [], mobile: [], error: e?.message || "Lecture des soldes impossible" as string | null }))
  ]);
  const plans: PlanLine[] = (await buildPlans({ crypto: sol.crypto, mobile: sol.mobile }).catch(() => ({ plans: [] as PlanLine[] }))).plans;
  const data = planRes.data;

  if (!data) {
    return (
      <div>
        <PageHeader title="Plan de staking" subtitle="Intérêts à verser, déblocages et décisions de trésorerie." />
        <div className="wk-alert-bad">Données de staking illisibles{planRes.error ? ` : ${planRes.error}` : ""}. Vérifiez que la migration 20261118_admin_staking_plan est appliquée.</div>
      </div>
    );
  }

  const assets = [...new Set(data.pools.map((p) => p.asset))];
  const decisions: AssetDecision[] = assets
    .map((asset) => {
      const pools = data.pools.filter((p) => p.asset === asset);
      const plan = plans.find((x) => x.asset === asset) ?? null;
      const kind = asset === "WAKATI" ? "internal" : plan?.kind === "mobile" ? "mobile" : "crypto";
      const price = prices.get(asset) ?? plan?.priceUsd ?? null;
      return decideAsset({ asset, pools, plan, kind, unstake: data.unstake.find((u) => u.asset === asset) ?? null, priceUsd: price }, horizon, scenario);
    })
    .filter((d) => d.staked > 0 || d.pending > 0);
  const priceOf = (asset: string) => decisions.find((d) => d.asset === asset)?.priceUsd ?? prices.get(asset) ?? null;
  const totals = totalsOf(decisions);

  // Alertes
  const cron = data.engine.cron;
  const accrualAgeH = data.engine.lastAccrualAt ? (Date.now() - new Date(data.engine.lastAccrualAt).getTime()) / 3_600_000 : null;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const missedToday = data.engine.lastRunDate !== null && data.engine.lastRunDate < todayUtc && new Date().getUTCHours() >= 2;
  const shortfalls = decisions.filter((d) => d.verdict === "shortfall");

  const link = (h: number, s: Scenario) => `/dashboard/staking-plan?h=${h}&s=${s}`;
  const activeStyle = { fontWeight: 700, outline: "2px solid var(--accent, #0b5563)" } as const;

  const interestAssets = decisions.filter((d) => d.dailyPromised > 0 || d.pending > 0);
  const groups = byLockPeriod(data.pools.filter((p) => p.staked > 0 || p.isActive));
  const lockedPools = data.pools.filter((p) => !isFlexible(p) && (p.staked > 0 || p.isActive));

  return (
    <div>
      <PageHeader
        title="Plan de staking"
        subtitle="Combien est staké, combien d'intérêts verser (par jour, 7, 30, 90 jours, 1 an), quand les stakes se débloquent, et surtout : combien envoyer en staking on-chain et combien garder dans les portefeuilles."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={sol.error ? `Soldes détenus partiellement illisibles : ${sol.error}. Les décisions concernées sont marquées « solde illisible ».` : null} />

      {/* ── Alertes ── */}
      {cron === null && <div className="wk-alert-bad">La tâche d'intérêts quotidiens (kiss-daily-staking-rewards) n'existe pas : aucun intérêt n'est calculé.</div>}
      {cron && (!cron.active || (cron.lastStatus && cron.lastStatus !== "succeeded")) && <div className="wk-alert-bad">Tâche d'intérêts quotidiens en défaut ({!cron.active ? "désactivée" : cron.lastStatus}){cron.lastMessage ? ` : ${cron.lastMessage}` : ""}.</div>}
      {missedToday && <div className="wk-alert-warn">Le calcul d'intérêts du {todayUtc} (UTC) n'a pas encore tourné : dernier calcul enregistré le {data.engine.lastRunDate}. Attendu chaque jour à {cron?.schedule ?? "00:05"}.</div>}
      {accrualAgeH !== null && accrualAgeH > 36 && <div className="wk-alert-warn">Dernier calcul d'intérêts il y a {Math.round(accrualAgeH)} h (attendu chaque jour).</div>}
      {shortfalls.map((d) => <div key={d.asset} className="wk-alert-bad">{d.asset} : {d.message}</div>)}

      {/* ── Réglage de la lecture ── */}
      <div className="wk-panel" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div className="wk-label">Horizon de couverture</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              {HORIZONS_DECISION.map((h) => <a key={h} className="wk-btn" href={link(h, scenario)} style={h === horizon ? activeStyle : undefined}>{h} jours</a>)}
            </div>
          </div>
          <div>
            <div className="wk-label">Scénario de sorties</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              {(Object.keys(SCENARIOS) as Scenario[]).map((s) => <a key={s} className="wk-btn" href={link(horizon, s)} style={s === scenario ? activeStyle : undefined}>{SCENARIOS[s].label}</a>)}
            </div>
          </div>
        </div>
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>{SCENARIOS[scenario].text} Horizon : tout ce qui peut sortir ou être dû dans les {horizon} prochains jours doit rester disponible.</div>
      </div>

      {/* ── Chiffres clés ── */}
      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Total staké</div><div className="wk-strip-value">{formatUsd(totals.stakedUsd)}</div><div className="wk-strip-sub">{decisions.map((d) => `${n4(d.staked)} ${d.asset}`).join(" · ") || "Aucun stake actif"}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Intérêts à verser par jour</div><div className="wk-strip-value">{formatUsd(totals.dailyUsd)}</div><div className="wk-strip-sub">Sur la base des taux promis à chaque staker</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Intérêts accumulés non réclamés</div><div className="wk-strip-value">{formatUsd(totals.pendingUsd)}</div><div className="wk-strip-sub">Payables dès qu'un staker retire</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Déblocages sous {horizon} j</div><div className="wk-strip-value">{formatUsd(totals.unlockUsd)}</div><div className="wk-strip-sub">Stakes bloqués qui arrivent à échéance</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Peut partir en staking on-chain</div><div className="wk-strip-value">{formatUsd(totals.deployUsd)}</div><div className="wk-strip-sub">{totals.shortfallUsd > 0 ? `Manque ${formatUsd(totals.shortfallUsd)} dans les portefeuilles` : `Scénario ${SCENARIOS[scenario].label.toLowerCase()}, ${horizon} jours`}</div></div>
      </div>
      {totals.unpriced.length > 0 && <div className="wk-alert-warn">Sans cours valide, donc exclus des totaux en dollars : {totals.unpriced.join(", ")}.</div>}

      {/* ── Décision par actif ── */}
      <Section title="Que faire de chaque actif" hint={`À garder dans les portefeuilles = retraits habituels (page Réserve de retrait) + sorties de staking + déblocages + intérêts, sur ${horizon} jours, plus la marge de sécurité de la politique. Le reste peut partir en staking on-chain, sans jamais dépasser l'encours staké.`}>
        {decisions.length === 0 ? <Empty text="Aucun stake actif : rien à décider." /> : (
          <TableWrap>
            <thead>
              <tr><Th>Actif</Th><Th right>Détenu (portefeuilles)</Th><Th right>À garder</Th><Th right>Peut partir on-chain</Th><Th>Décision</Th></tr>
            </thead>
            <tbody>
              {decisions.map((d) => {
                const v = VERDICT[d.verdict];
                return (
                  <tr key={d.asset}>
                    <Td label="Actif"><b>{d.asset}</b><div className="wk-asset-sub">{d.stakers} staker(s) · staké {n4(d.staked)}</div></Td>
                    <Td right label="Détenu (portefeuilles)">{d.have === null ? "—" : <Amount v={d.have} asset={d.asset} price={d.priceUsd} />}{d.have !== null && d.hot !== null && <div className="wk-asset-sub">chaud {n4(d.hot)} · coffre {n4(d.vault ?? 0)}</div>}</Td>
                    <Td right label="À garder">{d.kind === "internal" ? "—" : <><Amount v={d.keep + d.buffer} asset={d.asset} price={d.priceUsd} /><div className="wk-asset-sub">retraits {n4(d.withdrawalReserve)} + staking {n4(d.stakingNeed)} + marge {n4(d.buffer)}</div></>}</Td>
                    <Td right label="Peut partir on-chain">{d.verdict === "deploy" ? <b><Amount v={d.deployable} asset={d.asset} price={d.priceUsd} /></b> : d.verdict === "shortfall" ? <span className="wk-bad">manque {n4(d.shortfall)}</span> : "—"}</Td>
                    <Td label="Décision"><Pill tone={v.tone}>{v.label}</Pill><div className="wk-asset-sub" style={{ maxWidth: 420 }}>{d.message}</div></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          Détail du « staking » à garder : sorties de staking flexible + déblocages à échéance + sorties anticipées (si le plan les permet) + intérêts accumulés + intérêts des {horizon} prochains jours. La part d'un stake donnée en garantie d'un prêt ne peut pas sortir et n'est pas comptée.
        </div>
        <div className="wk-asset-sub">
          Tous les plans autorisent le retrait anticipé (avec frais) : un stake « bloqué » reste donc retirable, d'où les scénarios prudent et extrême. Les fonds envoyés en staking on-chain quittent les portefeuilles lus par la page Solvabilité : la couverture y baissera d'autant tant que la position externe n'y est pas comptée.
        </div>
      </Section>

      {/* ── Intérêts ── */}
      <Section title="Intérêts à verser" hint="Intérêts simples (le moteur ne capitalise pas), au taux promis à chaque staker. « Trésorerie interne » = solde du portefeuille interne qui paie les intérêts des actifs autres que WAKATI au moment du retrait : s'il est insuffisant, le retrait n'est pas bloqué mais un manque est enregistré, donc l'argent doit être provisionné.">
        {interestAssets.length === 0 ? <Empty text="Aucun intérêt à verser." /> : (
          <TableWrap>
            <thead>
              <tr><Th>Actif</Th><Th right>Déjà accumulés</Th>{HORIZONS_VIEW.map((h) => <Th key={h} right hideSm={h === 7 || h === 90}>{h === 1 ? "Par jour" : h === 365 ? "1 an" : `${h} jours`}</Th>)}<Th right hideSm>Crédité par jour (moteur)</Th><Th>Trésorerie interne</Th></tr>
            </thead>
            <tbody>
              {interestAssets.map((d) => (
                <tr key={d.asset}>
                  <Td label="Actif"><b>{d.asset}</b></Td>
                  <Td right label="Déjà accumulés"><Amount v={d.pending} asset={d.asset} price={d.priceUsd} /></Td>
                  {HORIZONS_VIEW.map((h) => <Td key={h} right hideSm={h === 7 || h === 90} label={h === 1 ? "Par jour" : h === 365 ? "1 an" : `${h} jours`}><Amount v={interestOver(d.dailyPromised, h)} asset={d.asset} price={d.priceUsd} /></Td>)}
                  <Td right hideSm label="Crédité par jour (moteur)">{d.dailyEngine > 0 ? <Amount v={d.dailyEngine} asset={d.asset} price={d.priceUsd} /> : <span className="wk-bad">0 — rien n'est crédité</span>}</Td>
                  <Td label="Trésorerie interne">{d.kind === "internal" ? <span className="wk-asset-sub">émission (budget)</span> : (() => {
                    const bal = treasury.get(d.asset) ?? 0; const need = d.pending + d.interestHorizon;
                    return bal >= need ? <Pill tone="ok">couverte</Pill> : <Pill tone={bal > 0 ? "warn" : "bad"}>{bal > 0 ? "insuffisante" : "vide"}</Pill>;
                  })()}{d.kind !== "internal" && <div className="wk-asset-sub">{n4(treasury.get(d.asset) ?? 0)} dispo. / besoin {n4(d.pending + d.interestHorizon)} ({horizon} j)</div>}</Td>
                </tr>
              ))}
              <tr>
                <Td label="Actif"><b>Total en dollars</b></Td>
                <Td right label="Déjà accumulés"><b>{formatUsd(totals.pendingUsd)}</b></Td>
                {HORIZONS_VIEW.map((h) => <Td key={h} right hideSm={h === 7 || h === 90} label={`${h} j`}><b>{formatUsd(totals.dailyUsd * h)}</b></Td>)}
                <Td right hideSm label="Crédité par jour (moteur)"><b>{formatUsd(decisions.reduce((s, d) => s + (d.priceUsd && d.priceUsd > 0 ? d.dailyEngine * d.priceUsd : 0), 0))}</b></Td>
                <Td label="Trésorerie interne">{""}</Td>
              </tr>
            </tbody>
          </TableWrap>
        )}
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>
          Calcul automatique : chaque jour à {cron?.schedule ?? "—"} (UTC), chaque stake actif de chaque plan, y compris les plans et actifs ajoutés plus tard, reçoit montant × taux / 365 (dernier passage {cron?.lastRun ? formatDateTime(new Date(cron.lastRun)) : "—"}). Plan flexible : taux courant du plan. Plan bloqué : taux du stake. Un plan désactivé continue de payer ses stakers existants. Un seul calcul par jour : un second appel ne crédite rien. Les intérêts WAKATI sont créés par l'émission (budget limité) ; les autres actifs sont payés par la trésorerie interne au retrait.
        </div>
      </Section>

      {/* ── Par durée de blocage ── */}
      <Section title="Par durée de blocage" hint="Plans regroupés par durée. Valeurs en dollars quand le cours est connu.">
        {groups.length === 0 ? <Empty text="Aucun plan." /> : (
          <TableWrap>
            <thead><tr><Th>Durée</Th><Th>Plans</Th><Th right>Stakers</Th><Th right>Staké</Th><Th right hideSm>Intérêts / jour</Th><Th right>Intérêts 30 j</Th><Th right hideSm>Intérêts 1 an</Th><Th hideSm>Retrait anticipé</Th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const val = (f: (p: StakingPool) => number) => g.pools.reduce((s, p) => { const px = priceOf(p.asset); return px && px > 0 ? s + f(p) * px : s; }, 0);
                return (
                  <tr key={g.lockDays}>
                    <Td label="Durée"><b>{g.lockDays === 0 ? "Flexible" : `${g.lockDays} jours`}</b></Td>
                    <Td label="Plans">{g.pools.map((p) => `${p.name} (${p.asset} ${p.baseApy} %)`).join(", ")}</Td>
                    <Td right label="Stakers">{g.pools.reduce((s, p) => s + p.stakers, 0)}</Td>
                    <Td right label="Staké">{formatUsd(val((p) => p.staked))}</Td>
                    <Td right hideSm label="Intérêts / jour">{formatUsd(val((p) => p.dailyPromised))}</Td>
                    <Td right label="Intérêts 30 j">{formatUsd(val((p) => p.dailyPromised * 30))}</Td>
                    <Td right hideSm label="Intérêts 1 an">{formatUsd(val((p) => p.dailyPromised * 365))}</Td>
                    <Td hideSm label="Retrait anticipé">{g.lockDays === 0 ? "—" : g.pools.map((p) => (p.instantEnabled ? `oui${p.instantFeePct ? `, ${p.instantFeePct} % de frais` : ""}` : "non")).filter((x, i, a) => a.indexOf(x) === i).join(" / ")}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {/* ── Calendrier de déblocage ── */}
      <Section title="Calendrier de déblocage" hint="Stakes bloqués par échéance, en quantité native. Les échéances dépassées sont déjà retirables sans frais.">
        {lockedPools.length === 0 ? <Empty text="Aucun plan bloqué." /> : (
          <TableWrap>
            <thead><tr><Th>Plan</Th><Th right>Échu</Th><Th right>≤ 7 j</Th><Th right>8-30 j</Th><Th right hideSm>31-90 j</Th><Th right hideSm>91-180 j</Th><Th right hideSm>181-365 j</Th><Th right hideSm>&gt; 365 j</Th><Th right>Sous {horizon} j</Th></tr></thead>
            <tbody>
              {lockedPools.map((p) => (
                <tr key={p.id}>
                  <Td label="Plan"><b>{p.name}</b> <span className="wk-asset-sub">{p.asset} · {lockLabel(p)}</span></Td>
                  <Td right label="Échu">{n4(p.unlock.overdue)}</Td>
                  <Td right label="≤ 7 j">{n4(p.unlock.d7)}</Td>
                  <Td right label="8-30 j">{n4(p.unlock.d30)}</Td>
                  <Td right hideSm label="31-90 j">{n4(p.unlock.d90)}</Td>
                  <Td right hideSm label="91-180 j">{n4(p.unlock.d180)}</Td>
                  <Td right hideSm label="181-365 j">{n4(p.unlock.d365)}</Td>
                  <Td right hideSm label="> 365 j">{n4(p.unlock.later)}</Td>
                  <Td right label={`Sous ${horizon} j`}><b>{n4(unlockWithin(p.unlock, horizon))}</b></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {data.upcoming.length > 0 && (
          <>
            <h3 className="wk-h2" style={{ marginTop: 16 }}>Prochaines échéances</h3>
            <TableWrap>
              <thead><tr><Th>Échéance</Th><Th>Utilisateur</Th><Th>Plan</Th><Th right>Montant</Th></tr></thead>
              <tbody>
                {data.upcoming.map((u, i) => (
                  <tr key={`${u.userId}-${i}`}>
                    <Td label="Échéance">{formatDateTime(new Date(u.unlockAt))}</Td>
                    <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${u.userId}`}>{u.user ?? shortId(u.userId)}</a></Td>
                    <Td label="Plan">{u.pool}</Td>
                    <Td right label="Montant"><Amount v={u.amount} asset={u.asset} price={priceOf(u.asset)} /></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Section>

      {/* ── Détail des plans ── */}
      <Section title="Détail des plans" hint="Réglages et remplissage. Les réglages se modifient dans Produits › Staking.">
        <TableWrap>
          <thead><tr><Th>Plan</Th><Th>Type</Th><Th right>Taux promis</Th><Th>Intérêts versés ?</Th><Th right>Stakers</Th><Th right>Staké</Th><Th right hideSm>En garantie de prêts</Th><Th right hideSm>Remplissage</Th><Th hideSm>Retrait anticipé</Th></tr></thead>
          <tbody>
            {data.pools.map((p) => (
              <tr key={p.id}>
                <Td label="Plan"><b>{p.name}</b> <span className="wk-asset-sub">{p.asset}</span>{!p.isActive && <> <Pill tone="warn">Inactif</Pill></>}</Td>
                <Td label="Type">{lockLabel(p)}</Td>
                <Td right label="Taux promis">{formatNumber(p.baseApy, 2)} %</Td>
                <Td label="Intérêts versés ?">{p.enginePays ? <Pill tone="ok">Oui</Pill> : <Pill tone={p.staked > 0 ? "bad" : "warn"}>Non</Pill>}</Td>
                <Td right label="Stakers">{p.stakers}</Td>
                <Td right label="Staké">{n4(p.staked)}</Td>
                <Td right hideSm label="En garantie de prêts">{n4(p.loanLocked)}</Td>
                <Td right hideSm label="Remplissage">{p.capacity ? formatPct((p.staked / p.capacity) * 100) : "illimité"}</Td>
                <Td hideSm label="Retrait anticipé">{p.instantEnabled ? `oui${p.instantFeePct ? `, ${p.instantFeePct} %` : ""}` : "non"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>
    </div>
  );
}
