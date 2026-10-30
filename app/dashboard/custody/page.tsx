import { loadPrices } from "@/lib/data";
import { loadSolvencyLines } from "@/lib/solvency";
import { VAULT_CONFIGURED } from "@/lib/custody";
import { buildPlans, ensureTodaySnapshot, loadSnapshots, coverageOfDay, STATS_DAYS, todayKey, type SnapshotRow } from "@/lib/custody-policy";
import { summarize, toUsd, EPS, type PlanLine, type PlanState } from "@/lib/custody-plan";
import { formatNumber, formatUsd, formatPct } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";
import { HotGauge } from "@/components/custody-gauge";
import { savePolicy, takeSnapshot } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TONE: Record<PlanState, Tone> = { ok: "ok", refill: "warn", danger: "bad", excess: "info", unknown: "bad", nothing: "info" };
const PILL: Record<PlanState, string> = {
  ok: "Tout va bien",
  refill: "À remplir bientôt",
  danger: "Danger",
  excess: "Trop plein",
  unknown: "Illisible",
  nothing: "Rien à payer"
};

/** « 1 234 FCFA (≈ 2,10 $) » — le prix en dollars n'apparaît que s'il est connu. */
function money(amount: number, p: Pick<PlanLine, "asset" | "priceUsd">): string {
  const usd = toUsd(amount, p.priceUsd);
  return `${formatNumber(amount)} ${p.asset}${usd !== null ? ` (≈ ${formatUsd(usd)})` : ""}`;
}

/** Rappel quand une partie de l'argent prêt est réservée aux swaps (elle ne peut pas payer de retrait). */
function swapNote(p: PlanLine): string {
  return p.reservedForSwaps > EPS ? ` Attention : ${money(p.reservedForSwaps, p)} sont réservés aux swaps et ne peuvent pas servir à payer des retraits.` : "";
}

/** Montant sans le prix en dollars (pour les listes où la valeur en $ ne ferait que charger la lecture). */
function qty(amount: number, p: Pick<PlanLine, "asset">): string {
  return `${formatNumber(amount)} ${p.asset}`;
}

/** Ce qu'il faut faire, en une phrase que tout le monde comprend. */
function advice(p: PlanLine): { title: string; detail: string } {
  const mobile = p.kind === "mobile";
  const hotName = mobile ? "le compte chez le prestataire de paiement" : "le portefeuille de retrait";
  const vaultName = mobile ? "ta banque" : "le coffre";
  switch (p.state) {
    case "ok":
      return { title: "✅ Tout va bien", detail: "Il y a de quoi payer les retraits habituels, et même le plus gros solde d'un utilisateur." };
    case "refill": {
      const src = mobile || !VAULT_CONFIGURED ? "" : p.vault >= p.move ? " Tu peux les prendre dans le coffre." : p.vault > EPS ? " Le coffre n'en a pas assez : complète avec une autre source." : "";
      return { title: `⚠️ Ajoute environ ${money(p.move, p)} dans ${hotName}`, detail: `Il commence à se vider. Pas d'urgence aujourd'hui, mais mieux vaut le remplir avant la prochaine vague de retraits.${swapNote(p)}${src}` };
    }
    case "danger": {
      const src = mobile || !VAULT_CONFIGURED ? "" : p.vault >= p.move ? " Tu peux les prendre dans le coffre." : "";
      return { title: `🚨 Ajoute environ ${money(p.move, p)} dans ${hotName} maintenant`, detail: `Si le plus gros utilisateur retirait tout son argent d'un coup, il n'y aurait pas assez de prêt pour le payer.${swapNote(p)}${src}` };
    }
    case "excess":
      return {
        title: `💤 Tu peux mettre à l'abri environ ${money(p.move, p)}`,
        detail:
          mobile
            ? `Il y a plus d'argent prêt que nécessaire. Le surplus peut repartir vers ${vaultName}.`
            : VAULT_CONFIGURED
              ? `Il y a plus d'argent exposé que nécessaire (plus risqué si un pirate attaque). Mets le surplus dans ${vaultName}.`
              : `Il y a plus d'argent exposé que nécessaire (plus risqué si un pirate attaque). Pour le mettre à l'abri, configure d'abord l'adresse du coffre (VAULT_EVM_ADDRESS).`
      };
    case "nothing":
      return { title: "Rien à payer ici", detail: "Aucun utilisateur n'a d'argent sur cet actif : il n'y a rien à garder en réserve pour l'instant." };
    case "unknown":
      return { title: "On n'arrive pas à lire cet actif", detail: `${p.error ? p.error + ". " : ""}Tant que ce n'est pas lisible, on ne peut pas dire si c'est bon. Ce n'est pas rassurant : vérifie la connexion au portefeuille.` };
  }
}

function ruleNumber(p: PlanLine): number {
  return p.need.winner === "floor" ? 1 : p.need.winner === "biggest" ? 2 : 3;
}

function verdictBox(plans: PlanLine[], s: ReturnType<typeof summarize>) {
  const names = (list: PlanLine[]) => list.map((p) => p.asset).join(", ");
  const nothingToDo = plans.length === 0;
  if (nothingToDo) {
    return { cls: "unknown", title: "Aucun actif à surveiller", lines: ["Personne n'a encore d'argent sur la plateforme."] };
  }
  const extra: string[] = [];
  if (s.excess.length > 0) extra.push(`Bon à savoir : ${s.excess.length} actif(s) ont plus d'argent à portée de main que nécessaire (${names(s.excess)}). Ce n'est pas urgent, mais c'est plus risqué en cas de piratage.`);
  if (s.verdict === "bad") {
    return {
      cls: "bad",
      title: "Attention : un gros retrait pourrait échouer",
      lines: [`À remplir maintenant : ${names(s.danger)}.`, ...(s.refill.length ? [`À remplir bientôt : ${names(s.refill)}.`] : []), ...extra]
    };
  }
  if (s.verdict === "warn") {
    return { cls: "warn", title: "Presque tout est prêt, un peu de remplissage à prévoir", lines: [`À remplir bientôt : ${names(s.refill)}.`, ...extra] };
  }
  if (s.verdict === "unknown") {
    return { cls: "unknown", title: "On ne peut pas dire si tout est prêt", lines: [`Lecture impossible pour : ${names(s.unknown)}.`, ...extra] };
  }
  return { cls: "ok", title: "Oui, tout est prêt pour payer les retraits", lines: ["Pour chaque actif, il y a assez d'argent à portée de main pour payer les retraits habituels.", ...extra] };
}

function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

export default async function CustodyPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string; msg?: string; snap?: string };
}) {
  const prices = await loadPrices();
  const sol = await loadSolvencyLines(prices);
  const { plans, warning } = await buildPlans(sol);
  await ensureTodaySnapshot(plans);

  const today = todayKey();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const snaps = await loadSnapshots(since, today);

  const summary = summarize(plans);
  const verdict = verdictBox(plans, summary);
  const workRows = plans.filter((p) => p.freeSurplus > EPS || p.policy.invest_pct > 0);

  const byDay = new Map<string, SnapshotRow[]>();
  for (const r of snaps.rows) byDay.set(r.snapshot_date, [...(byDay.get(r.snapshot_date) || []), r]);
  const days = [...byDay.entries()].slice(0, 14);

  return (
    <>
      <PageHeader
        title="Réserve de retrait"
        subtitle="Est-ce qu'il y a assez d'argent à portée de main pour payer ceux qui retirent ? Et quelle part de l'argent peut travailler sans danger ?"
      />

      <ErrorNote text={sol.error} />
      <ErrorNote text={searchParams.error ? `Échec sur ${searchParams.error} : ${searchParams.msg || ""}` : null} />
      {warning && <div className="wk-callout wk-callout-warn" style={{ marginBottom: 16 }}>{warning}</div>}
      {searchParams.saved && <div className="wk-alert-ok">Réglages de {searchParams.saved} enregistrés.</div>}
      {searchParams.snap && <div className="wk-alert-ok">Relevé du jour enregistré.</div>}

      <div className={`wk-verdict wk-verdict-${verdict.cls}`}>
        <h2 className="wk-verdict-title">{verdict.title}</h2>
        {verdict.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>

      <div className="wk-explain">
        <div className="wk-explain-item">
          <span className="wk-explain-emoji" aria-hidden="true">🧰</span>
          <h3>Le portefeuille de retrait</h3>
          <p>{"C'est l'argent prêt à partir. Quand quelqu'un retire, on le prend ici. Il doit être assez rempli pour payer, mais pas trop : c'est la partie la plus exposée aux pirates."}</p>
        </div>
        <div className="wk-explain-item">
          <span className="wk-explain-emoji" aria-hidden="true">🔒</span>
          <h3>Le coffre</h3>
          <p>{"C'est l'argent mis à l'abri, hors ligne. Beaucoup plus sûr, mais plus lent à sortir. La grande majorité de l'argent devrait dormir ici."}</p>
        </div>
        <div className="wk-explain-item">
          <span className="wk-explain-emoji" aria-hidden="true">🌱</span>
          <h3>{"L'argent libre"}</h3>
          <p>{"C'est ce qui reste quand tout ce que tu dois est couvert, avec une marge de sécurité. Seul cet argent-là peut être placé pour rapporter des bénéfices."}</p>
        </div>
      </div>

      {!VAULT_CONFIGURED && (
        <div className="wk-callout wk-callout-info" style={{ marginBottom: 16 }}>
          {"Aucun coffre n'est encore branché : tout l'argent crypto est compté dans le portefeuille de retrait. Pour activer le coffre, ajoute l'adresse de ton coffre dans les variables du dashboard (VAULT_EVM_ADDRESS, et VAULT_BTC_ADDRESS pour le Bitcoin). Son contenu sera alors compté comme de l'argent détenu."}
        </div>
      )}

      <Section title="Un actif après l'autre" hint={`Chaque carte répond à trois questions : combien je dois, combien j'ai, et que faire. Les retraits sont observés sur les ${STATS_DAYS} derniers jours.`}>
        {plans.length === 0 ? (
          <Empty text="Aucun actif à afficher." />
        ) : (
          <div className="wk-cust-grid">
            {plans.map((p) => {
              const tone = TONE[p.state];
              const a = advice(p);
              const mobile = p.kind === "mobile";
              return (
                <article key={p.asset} className={`wk-cust-card wk-cust-card-${tone}`}>
                  <div className="wk-cust-head">
                    <h3 className="wk-cust-name">{p.label}</h3>
                    <Pill tone={tone}>{PILL[p.state]}</Pill>
                  </div>

                  <p className="wk-cust-say">
                    {"Tu dois "}
                    <b>{money(p.owe, p)}</b>
                    {" à tes utilisateurs. "}
                    {p.have !== null ? (
                      <>
                        {"Tu as "}
                        <b>{money(p.have, p)}</b>
                        {" en tout."}
                      </>
                    ) : (
                      "Impossible de lire ce que tu as."
                    )}
                  </p>

                  <dl className="wk-cust-rows">
                    <div>
                      <dt>{mobile ? "Chez le prestataire de paiement" : "Dans le portefeuille de retrait"}</dt>
                      <dd>{p.hot !== null ? formatNumber(p.hot) : "?"} {p.asset}</dd>
                    </div>
                    {!mobile && (
                      <div>
                        <dt>Dans le coffre</dt>
                        <dd>{VAULT_CONFIGURED ? `${formatNumber(p.vault)} ${p.asset}` : "pas de coffre"}</dd>
                      </div>
                    )}
                    {!mobile && p.onUsers > EPS && (
                      <div>
                        <dt>Pas encore ramassé (adresses des utilisateurs)</dt>
                        <dd>{formatNumber(p.onUsers)} {p.asset}</dd>
                      </div>
                    )}
                    {p.reservedForSwaps > EPS && (
                      <div>
                        <dt>{"dont réservé aux swaps"}</dt>
                        <dd>{formatNumber(p.reservedForSwaps)} {p.asset}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Disponible pour payer les retraits</dt>
                      <dd>{p.withdrawable !== null ? formatNumber(p.withdrawable) : "?"} {p.asset}</dd>
                    </div>
                    <div>
                      <dt>{"À garder prêt pour les retraits (la cible)"}</dt>
                      <dd>{formatNumber(p.target)} {p.asset}</dd>
                    </div>
                  </dl>

                  <HotGauge plan={p} tone={tone} />

                  <div className={`wk-cust-action wk-cust-action-${tone}`}>
                    <strong>{a.title}</strong>
                    {a.detail}
                  </div>

                  <details className="wk-cust-why">
                    <summary>{"Pourquoi cette cible ?"}</summary>
                    <ul>
                      <li>{"On garde le plus grand de ces trois montants, sans jamais dépasser ce que tu dois :"}</li>
                      <li>{`1. Le plancher choisi : ${qty(p.need.floor, p)}`}</li>
                      <li>{`2. Le plus gros solde d'un seul utilisateur : ${qty(p.need.biggest, p)}`}</li>
                      <li>{`3. ${formatNumber(p.policy.days_cover)} jours du pire jour de retraits (${qty(p.stat.peak_day_out, p)} sorti ce jour-là) : ${qty(p.need.peak, p)}`}</li>
                      <li>
                        <b>
                          {Math.max(p.need.floor, p.need.biggest, p.need.peak) > p.target + EPS
                            ? `Ici, c'est le n°${ruleNumber(p)} qui décide, mais on ne garde jamais plus que ce que tu dois : ${qty(p.target, p)}.`
                            : `Ici, c'est le n°${ruleNumber(p)} qui décide : ${qty(p.target, p)}.`}
                        </b>
                      </li>
                      <li>{`Sur ${STATS_DAYS} jours : ${p.stat.withdrawals_count} retrait(s), le plus gros de ${qty(p.stat.max_single, p)}.`}</li>
                      <li>{`On prévient « à remplir » sous ${qty(p.low, p)} et « trop plein » au-dessus de ${qty(p.high, p)}.`}</li>
                      {p.swapStock > EPS && <li>{`Le stock des swaps (${qty(p.swapStock, p)}) est mis de côté avant de compter : les swaps paient depuis le même portefeuille.`}</li>}
                    </ul>
                  </details>

                  <div className="wk-cust-work">
                    {p.have === null ? (
                      "Argent libre : inconnu tant que la lecture échoue."
                    ) : p.freeSurplus > EPS ? (
                      <>
                        {"🌱 Argent libre : "}
                        <b>{money(p.freeSurplus, p)}</b>
                        {p.policy.invest_pct > 0 ? <> {" — tu acceptes d'en faire travailler "}<b>{formatPct(p.policy.invest_pct)}</b>{", soit "}<b>{money(p.canWork, p)}</b>{"."}</> : " — tu n'as pas encore choisi d'en faire travailler (réglages plus bas)."}
                      </>
                    ) : (
                      `🌱 Argent libre : aucun. Tout ce que tu as sert à couvrir ce que tu dois${p.swapStock > EPS ? `, et ${money(p.swapStock, p)} sont réservés aux swaps` : ""}.`
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="L'argent qui peut travailler"
        hint="Règle d'or : l'argent que les utilisateurs peuvent retirer à tout moment ne travaille jamais. Seul ton argent libre peut être placé."
      >
        <div className="wk-explain">
          <div className="wk-explain-item">
            <h3>1. Les soldes disponibles des utilisateurs</h3>
            <p>{"Ne travaillent jamais. C'est leur argent, il doit rester prêt à être retiré à n'importe quel moment."}</p>
          </div>
          <div className="wk-explain-item">
            <h3>2. Le staking choisi par les utilisateurs</h3>
            <p>{"Peut travailler, parce qu'ils l'ont demandé. Place-le seulement pour la même durée que ce qu'ils ont choisi, sinon tu ne pourras pas les rendre à temps."}</p>
          </div>
          <div className="wk-explain-item">
            <h3>3. Ton argent libre</h3>
            <p>{"Peut travailler, dans la limite que tu choisis. On garde toujours une marge de sécurité, et on ne touche pas au stock des swaps."}</p>
          </div>
        </div>

        {workRows.length === 0 ? (
          <Empty text="Pour l'instant il n'y a pas d'argent libre : tout ce que tu as sert à couvrir ce que tu dois et le stock des swaps." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th right>Argent libre</Th>
                <Th right>Part acceptée</Th>
                <Th right>Peut travailler</Th>
              </tr>
            </thead>
            <tbody>
              {workRows.map((p) => (
                <tr key={p.asset}>
                  <Td label="Actif">{p.label}</Td>
                  <Td right label="Argent libre">{money(p.freeSurplus, p)}</Td>
                  <Td right label="Part acceptée">{formatPct(p.policy.invest_pct)}</Td>
                  <Td right label="Peut travailler"><b>{money(p.canWork, p)}</b></Td>
                </tr>
              ))}
              <tr>
                <Td label="Total en dollars"><b>Total</b></Td>
                <Td right label="Argent libre"><b>{formatUsd(summary.freeUsd)}</b></Td>
                <Td right label="Part acceptée">{""}</Td>
                <Td right label="Peut travailler"><b>{formatUsd(summary.canWorkUsd)}</b></Td>
              </tr>
            </tbody>
          </TableWrap>
        )}
        {summary.unpriced.length > 0 && (
          <p className="wk-cust-why" style={{ marginTop: 10 }}>{`Sans prix connu, donc absents du total en dollars : ${summary.unpriced.join(", ")}.`}</p>
        )}
        <p className="wk-cust-why" style={{ marginTop: 10 }}>
          {"Ce tableau ne déplace aucun argent : il dit seulement combien tu pourrais placer sans mettre les retraits en danger. Place de préférence dans des supports faciles à reprendre vite, sans levier. Vérifie aussi ce que la loi de ton pays autorise."}
        </p>
      </Section>

      <Section title="Réglages" hint="Les valeurs par défaut conviennent pour commencer. Ouvre un actif pour les changer.">
        {plans.length === 0 ? (
          <Empty text="Aucun actif à régler." />
        ) : (
          plans.map((p) => (
            <details key={p.asset} className="wk-set-row">
              <summary>
                {p.label}
                <span>{`Plancher ${formatNumber(p.policy.min_hot)} · ${formatNumber(p.policy.days_cover)} jours · part qui travaille ${formatPct(p.policy.invest_pct)}`}</span>
              </summary>
              <form action={savePolicy} className="wk-cust-form">
                <input type="hidden" name="asset_symbol" value={p.asset} />
                <div className="wk-cust-form-grid">
                  <div>
                    <label htmlFor={`mh-${p.asset}`}>Plancher à toujours garder prêt</label>
                    <input id={`mh-${p.asset}`} className="wk-input" name="min_hot" type="number" step="any" min="0" defaultValue={p.policy.min_hot} />
                    <small>{`En ${p.asset}. Même si personne ne retire, on garde au moins ça.`}</small>
                  </div>
                  <div>
                    <label htmlFor={`dc-${p.asset}`}>Jours de retraits à couvrir</label>
                    <input id={`dc-${p.asset}`} className="wk-input" name="days_cover" type="number" step="any" min="0" max="90" defaultValue={p.policy.days_cover} />
                    <small>{"On regarde le pire jour de retraits et on le multiplie par ce nombre."}</small>
                  </div>
                  <div>
                    <label htmlFor={`lp-${p.asset}`}>{"Alerte « à remplir » sous (%)"}</label>
                    <input id={`lp-${p.asset}`} className="wk-input" name="low_pct" type="number" step="any" min="1" max="100" defaultValue={p.policy.low_pct} />
                    <small>{"En pourcentage de la cible. 50 = on prévient quand il reste moitié moins que la cible."}</small>
                  </div>
                  <div>
                    <label htmlFor={`hp-${p.asset}`}>{"Alerte « trop plein » au-dessus de (%)"}</label>
                    <input id={`hp-${p.asset}`} className="wk-input" name="high_pct" type="number" step="any" min="100" max="1000" defaultValue={p.policy.high_pct} />
                    <small>{"En pourcentage de la cible. 150 = on prévient quand il y a une fois et demie la cible."}</small>
                  </div>
                  <div>
                    <label htmlFor={`ip-${p.asset}`}>{"Part de l'argent libre qui peut travailler (%)"}</label>
                    <input id={`ip-${p.asset}`} className="wk-input" name="invest_pct" type="number" step="any" min="0" max="100" defaultValue={p.policy.invest_pct} />
                    <small>{"0 = rien ne travaille. Commence petit."}</small>
                  </div>
                  <div>
                    <label htmlFor={`sp-${p.asset}`}>Marge de sécurité (%)</label>
                    <input id={`sp-${p.asset}`} className="wk-input" name="safety_pct" type="number" step="any" min="0" max="1000" defaultValue={p.policy.safety_pct} />
                    <small>{"En pourcentage de ce que tu dois : de l'argent en plus qu'on ne touche jamais."}</small>
                  </div>
                </div>
                <div>
                  <button className="wk-btn wk-btn-primary" type="submit">Enregistrer</button>
                </div>
              </form>
            </details>
          ))
        )}
      </Section>

      <Section
        title="Relevé de couverture"
        hint="Chaque jour, la page note combien tu dois et combien tu as. À la fin du mois, télécharge le relevé : c'est la preuve que tout était couvert."
      >
        <form action={takeSnapshot} style={{ marginBottom: 12 }}>
          <button className="wk-btn" type="submit">{"Enregistrer le relevé maintenant"}</button>
        </form>

        {snaps.error ? (
          <ErrorNote text={`Relevés illisibles : ${snaps.error}. La migration 20261031_custody_policy.sql est-elle appliquée ?`} />
        ) : days.length === 0 ? (
          <Empty text="Aucun relevé pour l'instant. Le premier s'enregistre tout seul à la prochaine visite." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Jour</Th>
                <Th right>Tu devais</Th>
                <Th right>Tu avais</Th>
                <Th right>Couverture</Th>
              </tr>
            </thead>
            <tbody>
              {days.map(([day, rows]) => {
                const c = coverageOfDay(rows);
                const tone: Tone = c.coveragePct >= 100 ? "ok" : c.coveragePct >= 98 ? "warn" : "bad";
                return (
                  <tr key={day}>
                    <Td label="Jour">{day}</Td>
                    <Td right label="Tu devais">{formatUsd(c.owedUsd)}</Td>
                    <Td right label="Tu avais">{formatUsd(c.heldUsd)}</Td>
                    <Td right label="Couverture"><Pill tone={tone}>{formatPct(c.coveragePct)}</Pill></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}

        <p className="wk-cust-why" style={{ marginTop: 14 }}>{"Télécharger le relevé d'un mois (fichier à ouvrir dans Excel) :"}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {recentMonths(6).map((m) => (
            <a key={m} className="wk-btn" href={`/api/custody/export?month=${m}`}>{m}</a>
          ))}
        </div>
      </Section>
    </>
  );
}
