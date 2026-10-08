import { loadBurns } from "@/lib/burns";
import { EXPLORER } from "@/lib/wakati";
import { formatNumber, formatUsd, formatDateTime } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { confirmOnchainBurn, burnNow } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" }> = {
  completed: { label: "Brûlé on-chain", tone: "ok" },
  pending_onchain: { label: "À envoyer on-chain", tone: "warn" }
};
const short = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—");

export default async function BurnsPage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const r = await loadBurns();
  const pending = r.burns.filter((b) => b.status === "pending_onchain");

  return (
    <div>
      <PageHeader title="Burns" subtitle="La cagnotte jackpot (5 % de chaque mise) est convertie chaque jour en WAKATI brûlés depuis la trésorerie." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {searchParams.error && <ErrorNote text={searchParams.msg || "Opération refusée."} />}
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.msg || "Enregistré."}</div>}
      {r.oldestPendingDays !== null && r.oldestPendingDays > 7 && <div className="wk-alert-warn">Des burns attendent d'être envoyés on-chain depuis {Math.floor(r.oldestPendingDays)} jours : ils sont comptés comme brûlés dans l'app mais les jetons sont encore dans le portefeuille de trésorerie.</div>}

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Cagnotte à brûler</div><div className="wk-strip-value">{r.pool ? `${formatNumber(r.pool.amount, 2)} ${r.pool.asset}` : "—"}</div><div className="wk-strip-sub">{r.pool?.wakatiEquivalent != null ? `≈ ${formatNumber(r.pool.wakatiEquivalent, 0)} WAKATI${r.pool.usd != null ? ` (${formatUsd(r.pool.usd)})` : ""}` : "Prix indisponible"}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">WAKATI brûlés (total)</div><div className="wk-strip-value">{formatNumber(r.totalBurned, 0)}</div><div className="wk-strip-sub">{formatNumber(r.burnedLast30, 0)} sur 30 jours</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">À envoyer on-chain</div><div className={`wk-strip-value ${r.pendingCount > 0 ? "" : "wk-ok"}`}>{formatNumber(r.pendingAmount, 0)}</div><div className="wk-strip-sub">{r.pendingCount} burn(s) en attente</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Trésorerie WAKATI</div><div className="wk-strip-value">{r.treasuryWakati === null ? "—" : formatNumber(r.treasuryWakati, 0)}</div><div className="wk-strip-sub">Prochain burn : 00:20 UTC</div></div>
      </div>

      <Section title="Comment ça marche" hint="Un burn n'est complet qu'une fois les jetons envoyés à l'adresse de burn de la blockchain.">
        <div className="wk-panel" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
          <strong>Chaque jour à 00:20 UTC</strong>, la cagnotte ({r.pool ? `${formatNumber(r.pool.contributionPct, 1)} % de chaque mise` : "contribution des joueurs"}) est libérée dans la trésorerie : ces FCFA deviennent un revenu réel. L'équivalent en valeur est ensuite <strong>brûlé en WAKATI</strong> depuis la trésorerie : le solde baisse et le total brûlé augmente dans l'app.
          Ce burn est d'abord <strong>comptable</strong> (statut « À envoyer on-chain »). Envoyez ensuite les jetons à l'adresse de burn depuis votre portefeuille de trésorerie, puis collez le hash de transaction ci-dessous pour le confirmer.
          <form action={burnNow} style={{ marginTop: 14 }}>
            <button type="submit" className="wk-btn">Brûler la cagnotte maintenant</button>
          </form>
        </div>
      </Section>

      {pending.length > 0 && (
        <Section title="À confirmer on-chain" hint="Collez le hash de la transaction d'envoi vers l'adresse de burn.">
          <TableWrap>
            <thead><tr><Th>Date</Th><Th right>WAKATI</Th><Th hideSm>Motif</Th><Th>Confirmation</Th></tr></thead>
            <tbody>
              {pending.map((b) => (
                <tr key={b.id}>
                  <Td label="Date">{formatDateTime(new Date(b.created_at))}</Td>
                  <Td right label="WAKATI">{formatNumber(b.amount, 2)}</Td>
                  <Td hideSm label="Motif"><span style={{ color: "var(--muted)", fontSize: 13 }}>{b.reason ?? "—"}</span></Td>
                  <Td label="Confirmation">
                    <form action={confirmOnchainBurn} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input type="hidden" name="id" value={b.id} />
                      <input name="tx_hash" placeholder="0x… (hash de transaction)" required pattern="0x[0-9a-fA-F]{64}" style={{ minWidth: 220, flex: 1 }} />
                      <button type="submit" className="wk-btn">Confirmer</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}

      <Section title="Historique des burns">
        {r.burns.length === 0 ? <Empty text="Aucun burn enregistré pour le moment." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Origine</Th><Th right>WAKATI</Th><Th>Statut</Th><Th hideSm>Transaction</Th><Th hideSm>Motif</Th></tr></thead>
            <tbody>
              {r.burns.slice(0, 100).map((b) => {
                const s = STATUS[b.status] ?? { label: b.status, tone: "warn" as const };
                return (
                  <tr key={b.id}>
                    <Td label="Date">{formatDateTime(new Date(b.created_at))}</Td>
                    <Td label="Origine">{b.source === "treasury" ? "Trésorerie" : "Utilisateur"}</Td>
                    <Td right label="WAKATI">{formatNumber(b.amount, 2)}</Td>
                    <Td label="Statut"><Pill tone={s.tone}>{s.label}</Pill></Td>
                    <Td hideSm label="Transaction">{b.tx_hash ? <a href={`${EXPLORER}/tx/${b.tx_hash}`} target="_blank" rel="noreferrer">{short(b.tx_hash)}</a> : "—"}</Td>
                    <Td hideSm label="Motif"><span style={{ color: "var(--muted)", fontSize: 13 }}>{b.reason ?? "—"}</span></Td>
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
