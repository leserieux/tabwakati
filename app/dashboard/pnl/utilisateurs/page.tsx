import { loadUserProfit, type UserProfit } from "@/lib/user-profit";
import { formatNumber, formatUsd, formatDateTime } from "@/lib/format";
import { ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { Signals, PeriodTabs, parsePeriod } from "@/components/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIODS = [{ value: 30, label: "30 jours" }, { value: 90, label: "90 jours" }, { value: 0, label: "Depuis le début" }];
const signed = (n: number) => `${n > 0.00005 ? "+" : ""}${formatUsd(n)}`;
const tone = (n: number) => (n > 0.00005 ? "wk-ok" : n < -0.00005 ? "wk-bad" : "");

function UserTable({ rows, empty }: { rows: UserProfit[]; empty: string }) {
  return (
    <TableWrap>
      <thead><tr><Th>Utilisateur</Th><Th right>Résultat net</Th><Th right hideSm>Frais</Th><Th right hideSm>Jeux</Th><Th right hideSm>Coûts</Th><Th right hideSm>Déposé</Th><Th>Note</Th></tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><Td colSpan={7}>{empty}</Td></tr> : rows.map((u) => (
          <tr key={u.id}>
            <Td label="Utilisateur"><a href={`/dashboard/users/${u.id}`}>{u.username}</a>{u.referred ? <span style={{ color: "var(--muted)", fontSize: 12.5 }}> · filleul</span> : null}</Td>
            <Td right label="Résultat net"><strong className={tone(u.net)}>{signed(u.net)}</strong></Td>
            <Td right hideSm label="Frais"><span className={tone(u.fees)}>{signed(u.fees)}</span></Td>
            <Td right hideSm label="Jeux"><span className={tone(u.game)}>{signed(u.game)}</span></Td>
            <Td right hideSm label="Coûts"><span className={tone(u.staking + u.referral + u.defaults)}>{signed(u.staking + u.referral + u.defaults)}</span></Td>
            <Td right hideSm label="Déposé">{formatUsd(u.deposits)}</Td>
            <Td label="Note">{u.flag ? <Pill tone="warn">{u.flag}</Pill> : <span style={{ color: "var(--muted)" }}>—</span>}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function UserProfitPage({ searchParams }: { searchParams: { p?: string } }) {
  const period = parsePeriod(searchParams.p, [30, 90, 0], 30);
  const r = await loadUserProfit(period);
  const periodLabel = PERIODS.find((x) => x.value === period)!.label.toLowerCase();

  return (
    <div>
      <PageHeader title="Rentabilité par utilisateur" subtitle="Qui vous rapporte de l'argent, qui vous en coûte : frais payés, résultat des jeux, récompenses et bonus reçus." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {(period === 0 || period > 31) && <div className="wk-alert-warn">Au-delà de 31 jours, le prix historique du WAKATI n'est pas connu : les flux plus anciens sont valorisés au cours actuel. Montants indicatifs.</div>}
      <PeriodTabs base="/dashboard/pnl/utilisateurs" periods={PERIODS} current={period} />

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Résultat net ({periodLabel})</div><div className={`wk-strip-value ${tone(r.totalNet)}`}>{signed(r.totalNet)}</div><div className="wk-strip-sub">Tous utilisateurs confondus</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Rentables</div><div className="wk-strip-value wk-ok">{r.positive}</div><div className="wk-strip-sub">Résultat net positif</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Déficitaires</div><div className={`wk-strip-value ${r.negative > 0 ? "wk-bad" : ""}`}>{r.negative}</div><div className="wk-strip-sub">Coûtent plus qu'ils ne rapportent</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Sans activité</div><div className="wk-strip-value">{formatNumber(r.inactive, 0)}</div><div className="wk-strip-sub">Aucun flux sur la période</div></div>
      </div>

      <Signals items={r.signals} />

      {r.referral && (
        <Section title="Le parrainage est-il rentable ?" hint="Bonus versés aux parrains, comparés à ce que génèrent les filleuls.">
          <TableWrap>
            <thead><tr><Th>Bonus versés</Th><Th right>Coût (USD)</Th><Th right>Filleuls</Th><Th right>Résultat net des filleuls</Th></tr></thead>
            <tbody><tr>
              <Td label="Bonus versés">{r.referral.bonusCount}</Td>
              <Td right label="Coût">{formatUsd(r.referral.bonusUsd)}</Td>
              <Td right label="Filleuls">{r.referral.referredCount}</Td>
              <Td right label="Résultat net"><strong className={tone(r.referral.referredNetUsd)}>{signed(r.referral.referredNetUsd)}</strong></Td>
            </tr></tbody>
          </TableWrap>
        </Section>
      )}

      <Section title="Ceux qui rapportent le plus" hint="Résultat net = frais payés + mises − gains − récompenses − bonus − prêts en défaut.">
        <UserTable rows={r.top} empty="Aucun utilisateur rentable sur la période." />
      </Section>

      <Section title="Ceux qui coûtent le plus">
        <UserTable rows={r.bottom} empty="Aucun utilisateur déficitaire sur la période." />
      </Section>

      <p className="wk-hint">« Coûts » = récompenses de staking + bonus de parrainage + prêts en défaut. « Déposé » = dépôts réussis de la période (tous canaux). C'est un indicateur de gestion : un utilisateur déficitaire aujourd'hui peut devenir rentable (et inversement).</p>
    </div>
  );
}
