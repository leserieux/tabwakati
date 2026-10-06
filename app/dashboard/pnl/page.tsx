import { loadFinancialMetrics } from "@/lib/metrics";
import { formatNumber, formatUsd, formatPct, formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS: { value: number; label: string }[] = [
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
  { value: 0, label: "Depuis le début" }
];

const signed = (n: number) => `${n > 0.005 ? "+" : ""}${formatUsd(n)}`;
const tone = (n: number) => (n > 0.005 ? "wk-ok" : n < -0.005 ? "wk-bad" : "");
const monthLabel = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }); };
const nativeList = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([a, v]) => `${formatNumber(v, 2)} ${a}`).join(" · ") || "—";

export default async function PnlPage({ searchParams }: { searchParams: { p?: string } }) {
  const parsed = Number(searchParams.p);
  const period = PERIODS.some((x) => x.value === parsed) && searchParams.p !== undefined ? parsed : 30;
  const r = await loadFinancialMetrics({ period });
  const c = r;
  const periodLabel = PERIODS.find((x) => x.value === period)!.label.toLowerCase();
  const delta = r.deltaPrevious;
  const maxAbs = Math.max(...r.monthlyBreakdown.map((m) => Math.abs(m.net)), 0.0001);
  const order = ["fees", "game_bets", "game_wins", "staking", "referral", "defaults"] as const;

  return (
    <div>
      <PageHeader title="Résultat" subtitle="Ce que la plateforme gagne et perd : entrées, sorties, et ce qui est de l'argent réel ou du WAKATI." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {r.truncated && <ErrorNote text="Lecture tronquée : les totaux sont partiels." />}

      {(period === 0 || period > 31) && <div className="wk-alert-warn">Au-delà de 31 jours, le prix historique du WAKATI n'est pas connu : les flux plus anciens sont valorisés au cours actuel. Les montants en dollars de cette période sont indicatifs, fiez-vous plutôt aux montants natifs.</div>}

      <div className="wk-tabs" role="tablist" aria-label="Période">
        {PERIODS.map((x) => (
          <a key={x.value} href={`/dashboard/pnl?p=${x.value}`} role="tab" aria-selected={period === x.value} className={`wk-tab ${period === x.value ? "active" : ""}`}>{x.label}</a>
        ))}
      </div>

      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Résultat net ({periodLabel})</div>
          <div className={`wk-strip-value ${tone(c.netTotal)}`}>{signed(c.netTotal)}</div>
          <div className="wk-strip-sub">{delta === null ? "Toute la période" : `${signed(delta)} vs période précédente`}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">En argent réel</div>
          <div className={`wk-strip-value ${tone(c.realTotal)}`}>{signed(c.realTotal)}</div>
          <div className="wk-strip-sub">FCFA, crypto</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">En WAKATI</div>
          <div className={`wk-strip-value ${tone(c.wakatiTotal)}`}>{signed(c.wakatiTotal)}</div>
          <div className="wk-strip-sub">Jeton interne, valeur selon son cours</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Jeux (mises − gains)</div>
          <div className={`wk-strip-value ${tone(c.gameNet)}`}>{signed(c.gameNet)}</div>
          <div className="wk-strip-sub">{c.gameRtp === null ? "Aucune mise sur la période" : `Joueurs : ${formatPct(c.gameRtp, 0)} des mises récupérées`}</div>
        </div>
      </div>

      <Section title="À retenir pour décider" hint="Signaux calculés automatiquement à partir des chiffres ci-dessous.">
        <div style={{ display: "grid", gap: 12 }}>
          {r.signals.length === 0 ? <div className="wk-panel">Pas assez de données sur cette période.</div> : r.signals.map((s, i) => (
            <div key={i} className="wk-panel">
              <div style={{ marginBottom: 6 }}><Pill tone={s.tone}>{s.title}</Pill></div>
              <div style={{ color: "var(--muted)", fontSize: 14 }}>{s.detail}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Compte de résultat" hint={`Période : ${periodLabel}. Le signe indique l'effet sur votre résultat : + ce qui rentre, − ce qui sort.`}>
        <TableWrap>
          <thead><tr><Th>Ligne</Th><Th right>Argent réel</Th><Th right>WAKATI</Th><Th right>Total</Th><Th right hideSm>Opérations</Th><Th hideSm>Montants natifs</Th></tr></thead>
          <tbody>
            {order.map((k) => {
              const l = c.byCat[k];
              const labels: Record<typeof k, { label: string; hint: string }> = {
                fees: { label: "Frais (hors jeux)", hint: "Swap, retrait, prêts, achat WAKATI" },
                game_bets: { label: "Mises des joueurs", hint: "Tout ce que les joueurs ont misé (y compris la part jackpot, 5 %)" },
                game_wins: { label: "Gains payés aux joueurs", hint: "Inclut les gains des tours gratuits et du jackpot" },
                staking: { label: "Récompenses de staking", hint: "Versées aux utilisateurs qui stakent" },
                referral: { label: "Bonus de parrainage", hint: "Versés aux parrains" },
                defaults: { label: "Prêts score en défaut", hint: "Montant non remboursé. Les prêts liquidés ne sont pas inclus." }
              };
              const lbl = labels[k];
              return (
                <tr key={k}>
                  <Td label="Ligne"><div>{lbl.label}</div><div style={{ color: "var(--muted)", fontSize: 12.5 }}>{lbl.hint}</div></Td>
                  <Td right label="Argent réel"><span className={tone(l.real)}>{signed(l.real)}</span></Td>
                  <Td right label="WAKATI"><span className={tone(l.wakati)}>{signed(l.wakati)}</span></Td>
                  <Td right label="Total"><span className={tone(l.usd)}>{signed(l.usd)}</span></Td>
                  <Td right hideSm label="Opérations">{formatNumber(l.count, 0)}</Td>
                  <Td hideSm label="Montants natifs">{nativeList(l.native)}</Td>
                </tr>
              );
            })}
            <tr>
              <Td label="Ligne"><strong>Résultat net</strong></Td>
              <Td right label="Argent réel"><strong className={tone(c.realTotal)}>{signed(c.realTotal)}</strong></Td>
              <Td right label="WAKATI"><strong className={tone(c.wakatiTotal)}>{signed(c.wakatiTotal)}</strong></Td>
              <Td right label="Total"><strong className={tone(c.netTotal)}>{signed(c.netTotal)}</strong></Td>
              <Td right hideSm label="Opérations">—</Td>
              <Td hideSm label="Montants natifs">—</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Mois par mois" hint="Résultat net de chaque mois ; la barre est proportionnelle au plus grand écart.">
        <TableWrap>
          <thead><tr><Th>Mois</Th><Th right>Frais</Th><Th right>Jeux (net)</Th><Th right hideSm>Coûts</Th><Th right>Résultat</Th><Th hideSm> </Th></tr></thead>
          <tbody>
            {r.monthlyBreakdown.map((m) => (
              <tr key={m.key}>
                <Td label="Mois">{monthLabel(m.key)}</Td>
                <Td right label="Frais"><span className={tone(m.fees)}>{signed(m.fees)}</span></Td>
                <Td right label="Jeux (net)"><span className={tone(m.game)}>{signed(m.game)}</span></Td>
                <Td right hideSm label="Coûts"><span className={tone(m.costs)}>{signed(m.costs)}</span></Td>
                <Td right label="Résultat"><strong className={tone(m.net)}>{signed(m.net)}</strong></Td>
                <Td hideSm label="">
                  <div className="wk-share-track" style={{ width: 140 }}><div className="wk-share-fill" style={{ width: `${(Math.abs(m.net) / maxAbs) * 100}%`, background: m.net < -0.005 ? "var(--bad)" : undefined }} /></div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="wk-hint">« Coûts » = staking + parrainage + prêts en défaut.</p>
      </Section>

      <Section title="Trésorerie actuelle" hint={`Soldes des portefeuilles de la plateforme, au cours actuel. Total : ${formatUsd(r.treasuryUsd)}.`}>
        <TableWrap>
          <thead><tr><Th>Actif</Th><Th right>Solde</Th><Th right hideSm>Cours</Th><Th right>Valeur</Th></tr></thead>
          <tbody>
            {r.treasury.length === 0 ? <tr><Td colSpan={4}>Aucun solde.</Td></tr> : r.treasury.map((w) => (
              <tr key={w.asset}>
                <Td label="Actif">{w.asset}</Td>
                <Td right label="Solde">{formatNumber(w.balance, 4)}</Td>
                <Td right hideSm label="Cours">{w.price === null ? "Sans cours" : formatUsd(w.price)}</Td>
                <Td right label="Valeur">{w.usd === null ? "—" : formatUsd(w.usd)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Section>

      <p className="wk-hint">Le WAKATI est valorisé au prix du jour quand il est connu (environ 31 derniers jours), sinon au cours actuel. Les autres actifs sont valorisés au cours actuel. Ce tableau est une estimation de gestion à partir des transactions : il ne remplace pas une comptabilité.</p>
    </div>
  );
}
