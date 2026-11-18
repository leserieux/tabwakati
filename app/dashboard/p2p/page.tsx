import { loadP2pReport, type P2pAssetRow } from "@/lib/p2p";
import { formatDateTime, formatNumber, formatUsd, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Td, Th, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function AssetTable({ rows }: { rows: P2pAssetRow[] }) {
  if (rows.length === 0) return <Empty text="Aucun transfert sur la période." />;
  return (
    <TableWrap>
      <thead><tr><Th>Actif</Th><Th right>Transferts</Th><Th right hideSm>Expéditeurs</Th><Th right hideSm>Destinataires</Th><Th right>Volume</Th><Th right>Frais</Th><Th right hideSm>Valeur (volume)</Th><Th right hideSm>Dernier</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.asset_symbol}>
            <Td label="Actif">{r.asset_symbol}</Td>
            <Td right label="Transferts">{formatNumber(r.transfers, 0)}</Td>
            <Td right hideSm label="Expéditeurs">{r.senders}</Td>
            <Td right hideSm label="Destinataires">{r.receivers}</Td>
            <Td right label="Volume">{formatNumber(r.volume, 4)}</Td>
            <Td right label="Frais">{formatNumber(r.fees, 4)}</Td>
            <Td right hideSm label="Valeur (volume)">{r.volume_usd === null ? "non valorisé" : formatUsd(r.volume_usd)}</Td>
            <Td right hideSm label="Dernier">{r.last_at ? formatDateTime(new Date(r.last_at)) : "—"}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function P2pPage() {
  const r = await loadP2pReport();
  return (
    <div>
      <PageHeader
        title="Transferts P2P"
        subtitle="Transferts entre utilisateurs de l'app : volume et frais par actif (les frais sont payés par l'expéditeur et encaissés par la plateforme), valorisés au cours actuel."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {r.unpriced.length > 0 && <div className="wk-alert-warn">Sans cours valide, donc exclus des totaux USD : {r.unpriced.join(", ")}.</div>}

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Volume (30 j)</div><div className="wk-strip-value">{formatUsd(r.totals.d30Usd)}</div><div className="wk-strip-sub">{formatNumber(r.totals.transfers30, 0)} transfert(s)</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Frais (30 j)</div><div className="wk-strip-value">{formatUsd(r.totals.fees30Usd)}</div><div className="wk-strip-sub">Encaissés par la plateforme</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Volume (total)</div><div className="wk-strip-value">{formatUsd(r.totals.allUsd)}</div><div className="wk-strip-sub">{formatNumber(r.totals.transfersAll, 0)} transfert(s)</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Frais (total)</div><div className="wk-strip-value">{formatUsd(r.totals.feesAllUsd)}</div><div className="wk-strip-sub">Déjà inclus dans la page Frais (type p2p_fee)</div></div>
      </div>

      <Section title="30 derniers jours" hint="Par actif, en quantité native.">
        <AssetTable rows={r.d30} />
      </Section>
      <Section title="Depuis le début" hint="Tous les transferts terminés.">
        <AssetTable rows={r.all} />
      </Section>

      <Section title="Derniers transferts" hint="Les 25 plus récents.">
        {r.recent.length === 0 ? <Empty text="Aucun transfert." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Expéditeur</Th><Th>Destinataire</Th><Th>Actif</Th><Th right>Montant reçu</Th><Th right>Frais</Th></tr></thead>
            <tbody>
              {r.recent.map((t) => (
                <tr key={t.id}>
                  <Td label="Date">{formatDateTime(new Date(t.created_at))}</Td>
                  <Td label="Expéditeur"><a className="wk-link" href={`/dashboard/users/${t.sender_id}`}>{t.sender ?? shortId(t.sender_id)}</a></Td>
                  <Td label="Destinataire">{t.receiver_id ? <a className="wk-link" href={`/dashboard/users/${t.receiver_id}`}>{t.receiver ?? shortId(t.receiver_id)}</a> : "—"}</Td>
                  <Td label="Actif">{t.asset_symbol}</Td>
                  <Td right label="Montant reçu">{formatNumber(t.net_amount ?? Math.max(0, t.amount - t.fee), 4)}</Td>
                  <Td right label="Frais">{formatNumber(t.fee, 4)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
