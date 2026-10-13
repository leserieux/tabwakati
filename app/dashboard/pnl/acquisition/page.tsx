import { loadAcquisition } from "@/lib/acquisition";
import { formatNumber, formatPct, formatToken, formatUsd, formatDateTime } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const signed = (n: number) => `${n > 0.00005 ? "+" : ""}${formatUsd(n)}`;
const tone = (n: number) => (n > 0.00005 ? "wk-ok" : n < -0.00005 ? "wk-bad" : "");

function Metric({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className="wk-strip-value" style={{ color: warn ? "var(--warn)" : "var(--fg)" }}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}

export default async function AcquisitionPage() {
  const r = await loadAcquisition();
  const rate = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  const refRate = rate(r.referredActivated, r.referredUsers);
  const orgRate = rate(r.organicActivated, r.organicUsers);
  const cost = r.cost;
  const net = r.revenueReferredUsd - cost.usdDay;
  const dayShare = cost.wakati > 0 ? (cost.dayWakati / cost.wakati) * 100 : null;
  const cac = r.referredUsers > 0 ? cost.usdDay / r.referredUsers : null;
  const cohorts = [...r.cohorts].reverse();

  return (
    <div>
      <PageHeader title="Acquisition et rentabilité des inscrits" subtitle="Combien coûte un nouvel utilisateur, et combien rapporte-t-il ? Le seul coût d'acquisition enregistré en base est le bonus de parrainage (filleul + parrain). Les dépenses externes (publicité, influenceurs) n'y figurent pas et ne sont pas comptées." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.errors.length ? `Certaines données sont indisponibles : ${r.errors.join(" · ")}` : null} />

      <div className="wk-strip">
        <Metric label="Inscrits parrainés" value={`${r.referredUsers} / ${r.totalUsers}`} sub={`${formatPct(rate(r.referredUsers, r.totalUsers) ?? 0, 0)} des inscrits`} />
        <Metric label="Coût d'acquisition" value={`${formatToken(cost.wakati)} WAKATI`} sub={`≈ ${formatUsd(cost.usdDay)} au prix du jour`} />
        <Metric label="Coût par parrainé" value={cac === null ? "—" : formatUsd(cac)} sub={`revenu moyen : ${r.referredUsers > 0 ? formatUsd(r.revenueReferredUsd / r.referredUsers) : "—"}`} warn={cac !== null && r.referredUsers > 0 && r.revenueReferredUsd / r.referredUsers < cac} />
        <Metric label="Résultat des parrainés" value={signed(net)} sub="frais générés − bonus versés" warn={net < 0} />
      </div>

      {cost.usdDay > 0 && r.revenueReferredUsd < cost.usdDay && (
        <div className="wk-alert-warn" style={{ marginTop: 14 }}>
          Pour l'instant, le parrainage coûte plus qu'il ne rapporte : {formatUsd(cost.usdDay)} de bonus pour {formatUsd(r.revenueReferredUsd)} de frais générés par les parrainés (rapport valeur/coût : {formatNumber(cost.usdDay > 0 ? r.revenueReferredUsd / cost.usdDay : 0, 2)}). Les frais ne sont enregistrés que depuis fin juillet 2026 : ce rapport peut encore évoluer.
        </div>
      )}

      <Section title="Parrainés contre inscrits directs" hint="Les parrainés deviennent-ils de vrais utilisateurs ? « Activé » = au moins une opération terminée de leur initiative.">
        <TableWrap>
          <thead><tr><Th>Groupe</Th><Th right>Inscrits</Th><Th right>Activés</Th><Th right>Taux d'activation</Th><Th right>Frais générés</Th><Th right hideSm>Par inscrit</Th></tr></thead>
          <tbody>
            <tr>
              <Td label="Groupe">Parrainés</Td><Td right label="Inscrits">{r.referredUsers}</Td><Td right label="Activés">{r.referredActivated}</Td>
              <Td right label="Taux">{refRate === null ? "—" : formatPct(refRate, 0)}</Td><Td right label="Frais">{formatUsd(r.revenueReferredUsd)}</Td>
              <Td right hideSm label="Par inscrit">{r.referredUsers > 0 ? formatUsd(r.revenueReferredUsd / r.referredUsers) : "—"}</Td>
            </tr>
            <tr>
              <Td label="Groupe">Inscrits directs</Td><Td right label="Inscrits">{r.organicUsers}</Td><Td right label="Activés">{r.organicActivated}</Td>
              <Td right label="Taux">{orgRate === null ? "—" : formatPct(orgRate, 0)}</Td><Td right label="Frais">{formatUsd(r.revenueOrganicUsd)}</Td>
              <Td right hideSm label="Par inscrit">{r.organicUsers > 0 ? formatUsd(r.revenueOrganicUsd / r.organicUsers) : "—"}</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Section>

      <Section title="Par mois d'inscription" hint="Pour chaque mois : combien de parrainés, ce que les bonus ont coûté, et ce que ces parrainés ont rapporté.">
        {cohorts.length === 0 ? <Empty text="Aucune cohorte." /> : (
          <TableWrap>
            <thead><tr><Th>Mois</Th><Th right>Inscrits</Th><Th right>Parrainés</Th><Th right hideSm>Activés</Th><Th right>Coût (WAKATI)</Th><Th right>Coût ($)</Th><Th right>Frais générés</Th><Th right>Résultat</Th><Th right hideSm>Valeur/coût</Th></tr></thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.month}>
                  <Td label="Mois">{monthLabel(c.month)}</Td>
                  <Td right label="Inscrits">{c.signups}</Td>
                  <Td right label="Parrainés">{c.referred}</Td>
                  <Td right hideSm label="Activés">{c.referredActivated}</Td>
                  <Td right label="Coût WAKATI">{formatToken(c.cost.wakati)}</Td>
                  <Td right label="Coût $">{formatUsd(c.cost.usdDay)}</Td>
                  <Td right label="Frais">{formatUsd(c.revenueReferredUsd)}</Td>
                  <Td right label="Résultat"><strong className={tone(c.netUsd)}>{signed(c.netUsd)}</strong></Td>
                  <Td right hideSm label="Valeur/coût">{c.ltvOverCac === null ? "—" : formatNumber(c.ltvOverCac, 2)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        <div className="wk-hint" style={{ marginTop: 8 }}>« Valeur/coût » au-dessus de 1 = les parrainés de ce mois ont déjà rapporté plus qu'ils n'ont coûté. Un parrainé est classé dans le mois de sa propre inscription.</div>
      </Section>

      <Section title="Parrains" hint="Qui amène des utilisateurs, et ces utilisateurs sont-ils actifs ? Plusieurs inscriptions le même jour avec le même parrain méritent un contrôle (comptes créés en série).">
        {r.referrers.length === 0 ? <Empty text="Aucun parrain." /> : (
          <TableWrap>
            <thead><tr><Th>Parrain</Th><Th right>Parrainés</Th><Th right>Activés</Th><Th right>Bonus versés</Th><Th right>Frais générés</Th><Th>Note</Th></tr></thead>
            <tbody>
              {r.referrers.map((p) => {
                const inactiveShare = p.referred > 0 ? 1 - p.activated / p.referred : 0;
                const flag = p.maxSameDay >= 3 ? `${p.maxSameDay} inscrits le même jour` : p.referred >= 5 && inactiveShare >= 0.7 ? "peu d'activité" : null;
                return (
                  <tr key={p.id}>
                    <Td label="Parrain"><a href={`/dashboard/users/${p.id}`}>{p.username}</a></Td>
                    <Td right label="Parrainés">{p.referred}</Td>
                    <Td right label="Activés">{p.activated}</Td>
                    <Td right label="Bonus">{formatToken(p.cost.wakati)} WAKATI</Td>
                    <Td right label="Frais">{formatUsd(p.revenueUsd)}</Td>
                    <Td label="Note">{flag ? <Pill tone="warn">{flag}</Pill> : <span style={{ color: "var(--muted)" }}>—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Comment lire le coût en dollars" hint="Le WAKATI a beaucoup varié : la même somme de bonus ne vaut pas le même montant selon le prix retenu.">
        <TableWrap>
          <thead><tr><Th>Valorisation des bonus</Th><Th right>Montant</Th></tr></thead>
          <tbody>
            <tr><Td label="Valorisation">Au prix du jour de chaque bonus (quand connu)</Td><Td right label="Montant">{formatUsd(cost.usdDay)}</Td></tr>
            <tr><Td label="Valorisation">Au cours actuel du WAKATI{r.wakatiNow !== null ? ` (${r.wakatiNow.toFixed(5)} $)` : ""}</Td><Td right label="Montant">{formatUsd(cost.usdNow)}</Td></tr>
            <tr><Td label="Valorisation">Au plus haut des 31 derniers jours{r.wakatiPeak !== null ? ` (${r.wakatiPeak.toFixed(5)} $)` : ""}</Td><Td right label="Montant">{cost.usdPeak === null ? "—" : formatUsd(cost.usdPeak)}</Td></tr>
          </tbody>
        </TableWrap>
        <div className="wk-hint" style={{ marginTop: 8 }}>
          {dayShare === null ? "" : `${formatPct(dayShare, 0)} des WAKATI de bonus sont valorisés à leur prix du jour (le prix quotidien du WAKATI n'est enregistré que depuis le 4 septembre 2026) ; le reste utilise le cours actuel.`}
          {r.unattributedBonuses > 0 ? ` ${r.unattributedBonuses} anciens bonus de parrain (${formatToken(r.unattributedCost.wakati)} WAKATI) ne désignent pas de filleul précis : ils sont inclus dans le coût total et chez leur parrain, mais absents du détail par mois d'inscription.` : ""}
        </div>
      </Section>
    </div>
  );
}
