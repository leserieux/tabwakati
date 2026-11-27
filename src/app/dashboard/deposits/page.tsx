import { can } from "@/core/auth/session";
import { formatDateTime, formatNumber } from "@/core/format";
import { loadDepositsToReview } from "@/modules/operations/deposit-review";
import { adjustBalance } from "@/app/dashboard/balances/actions";
import BalanceForm from "@/components/balance-form";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dépôts restés en échec ou en attente : vérifier chez le fournisseur, puis créditer en un clic (avec motif). */
export default async function DepositsToReviewPage({ searchParams }: { searchParams?: { saved?: string; error?: string; pending?: string } }) {
  const { rows, error } = await loadDepositsToReview();
  const writable = can("finance.write");
  const failed = rows.filter((r) => r.status === "failed");
  const stuck = rows.filter((r) => r.stuck);

  return (
    <div>
      <PageHeader title="Dépôts à vérifier" subtitle="Dépôts mobile money en échec ou bloqués (90 derniers jours) : vérifie chez le fournisseur avant de créditer" updatedAt={formatDateTime(new Date())} />
      {searchParams?.saved && <div className="wk-alert-ok">{searchParams.saved}</div>}
      {searchParams?.pending && <div className="wk-alert-ok">{searchParams.pending}</div>}
      {searchParams?.error && <div className="wk-alert-bad">{searchParams.error}</div>}
      <ErrorNote text={error ? `Lecture impossible : ${error}` : null} />

      <div className="wk-strip" style={{ marginBottom: 18 }}>
        <div className="wk-panel"><strong>{failed.length}</strong><div className="wk-asset-sub">en échec</div></div>
        <div className="wk-panel"><strong>{stuck.length}</strong><div className="wk-asset-sub">bloqués (en attente depuis plus d'1 h)</div></div>
      </div>

      <Section title="À vérifier" hint="Crédite seulement si le fournisseur confirme avoir encaissé. Un dépôt crédité disparaît de cette liste et ne peut plus être crédité deux fois.">
        {rows.length === 0 ? <Empty text="Aucun dépôt à vérifier." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Utilisateur</Th><Th right>Montant</Th><Th>Statut</Th><Th hideSm>Fournisseur</Th>{writable && <Th>Créditer</Th>}</tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <Td label="Date">{formatDateTime(new Date(d.createdAt))}</Td>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${d.userId}`}>{d.userLabel}</a></Td>
                  <Td right label="Montant">{formatNumber(d.amount)} {d.asset}</Td>
                  <Td label="Statut"><Pill tone={d.status === "failed" ? "bad" : "warn"}>{d.status === "failed" ? "Échec" : d.stuck ? "Bloqué" : "En attente"}</Pill></Td>
                  <Td hideSm label="Fournisseur">
                    <div>{[d.provider, d.phone].filter(Boolean).join(" · ") || "—"}</div>
                    <div className="wk-asset-sub">{d.reason ?? "Aucun motif d'échec"}{d.providerRef ? ` · réf. ${d.providerRef}` : d.externalRef ? ` · réf. ${d.externalRef}` : ""}</div>
                  </Td>
                  {writable && (
                    <Td label="Créditer">
                      <BalanceForm action={adjustBalance} style={{ display: "grid", gap: 6, minWidth: 220 }}>
                        <input type="hidden" name="user_id" value={d.userId} />
                        <input type="hidden" name="return_to" value="/dashboard/deposits" />
                        <input type="hidden" name="direction" value="credit" />
                        <input type="hidden" name="asset_symbol" value={d.asset} />
                        <input type="hidden" name="deposit_tx_id" value={d.id} />
                        <input name="amount" className="wk-input" defaultValue={String(d.suggested)} inputMode="decimal" aria-label="Montant à créditer" />
                        <input name="reason" className="wk-input" required minLength={5} maxLength={300} placeholder="Motif : reçu confirmé, réf. …" />
                        <button type="submit" className="wk-submit-sm">Créditer</button>
                      </BalanceForm>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
