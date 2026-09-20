import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatDate, shortId } from "@/lib/format";
import { PageTitle, SectionTitle, TableShell, Th, Td, Badge, EmptyState, ErrorBox } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Flag({ on }: { on: boolean }) {
  return on ? <Badge tone="ok">oui</Badge> : <Badge tone="bad">non</Badge>;
}

export default async function OperationsPage() {
  const db = getSupabaseAdmin();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [assets, pending, sweeps, failed] = await Promise.all([
    q<any>(db.from("supported_assets").select("symbol, network, is_active, can_be_deposited, can_be_withdrawn, can_be_swapped, can_be_p2p, min_deposit, min_withdraw, max_withdraw, min_sweep").order("symbol")),
    q<any>(db.from("transactions").select("id, user_id, type, status, asset_symbol, amount, created_at").in("status", ["pending", "processing"]).order("created_at", { ascending: true }).limit(30)),
    q<any>(db.from("sweep_log").select("id, created_at, asset_symbol, network, amount, status, dry_run, error_message").order("created_at", { ascending: false }).limit(20)),
    q<any>(db.from("transactions").select("id, type, asset_symbol, amount, created_at").eq("status", "failed").gte("created_at", since7d).order("created_at", { ascending: false }).limit(20))
  ]);

  return (
    <div>
      <PageTitle title="Opérations" subtitle="Contrôles par actif, transactions en attente, balayages et échecs récents." />

      <SectionTitle hint="Interrupteurs par actif. Un dépôt suspendu se réactive avec can_be_deposited = true.">Contrôles par actif</SectionTitle>
      <ErrorBox text={assets.error} />
      <TableShell>
        <thead>
          <tr style={{ background: "#0f172a" }}>
            <Th>Actif</Th>
            <Th>Réseau</Th>
            <Th>Actif</Th>
            <Th>Dépôts</Th>
            <Th>Retraits</Th>
            <Th>Swaps</Th>
            <Th>P2P</Th>
            <Th align="right">Dépôt min</Th>
            <Th align="right">Retrait min / max</Th>
            <Th align="right">Seuil balayage</Th>
          </tr>
        </thead>
        <tbody>
          {assets.rows.map((a) => (
            <tr key={`${a.symbol}-${a.network}`} style={{ borderTop: "1px solid #334155" }}>
              <Td><strong style={{ color: "#f8fafc" }}>{a.symbol}</strong></Td>
              <Td>{a.network}</Td>
              <Td><Flag on={!!a.is_active} /></Td>
              <Td><Flag on={a.can_be_deposited !== false} /></Td>
              <Td><Flag on={!!a.can_be_withdrawn} /></Td>
              <Td><Flag on={!!a.can_be_swapped} /></Td>
              <Td><Flag on={!!a.can_be_p2p} /></Td>
              <Td align="right">{a.min_deposit !== null ? formatNumber(Number(a.min_deposit)) : "—"}</Td>
              <Td align="right">
                {a.min_withdraw !== null ? formatNumber(Number(a.min_withdraw)) : "—"} / {a.max_withdraw !== null ? formatNumber(Number(a.max_withdraw)) : "∞"}
              </Td>
              <Td align="right">
                {Number(a.min_sweep) >= 1e9 ? <Badge tone="warn">balayage bloqué</Badge> : formatNumber(Number(a.min_sweep || 0))}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <SectionTitle hint="Les plus anciennes d'abord. Au-delà d'1 h, à vérifier.">Transactions en attente</SectionTitle>
      <ErrorBox text={pending.error} />
      {pending.rows.length === 0 ? (
        <EmptyState text="Aucune transaction en attente." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Date</Th><Th>Type</Th><Th>Actif</Th><Th align="right">Montant</Th><Th>Statut</Th><Th>Utilisateur</Th>
            </tr>
          </thead>
          <tbody>
            {pending.rows.map((t) => {
              const old = Date.now() - new Date(t.created_at).getTime() > 3600 * 1000;
              return (
                <tr key={t.id} style={{ borderTop: "1px solid #334155" }}>
                  <Td>{formatDate(t.created_at)}</Td>
                  <Td>{t.type}</Td>
                  <Td>{t.asset_symbol}</Td>
                  <Td align="right">{formatNumber(Number(t.amount))}</Td>
                  <Td><Badge tone={old ? "warn" : "info"}>{t.status}</Badge></Td>
                  <Td mono>{shortId(t.user_id)}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <SectionTitle hint="20 derniers balayages vers le treasury">Balayages</SectionTitle>
      <ErrorBox text={sweeps.error} />
      {sweeps.rows.length === 0 ? (
        <EmptyState text="Aucun balayage." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Date</Th><Th>Actif</Th><Th>Réseau</Th><Th align="right">Montant</Th><Th>Statut</Th><Th>Détail</Th>
            </tr>
          </thead>
          <tbody>
            {sweeps.rows.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #334155" }}>
                <Td>{formatDate(s.created_at)}</Td>
                <Td>{s.asset_symbol}</Td>
                <Td>{s.network}</Td>
                <Td align="right">{formatNumber(Number(s.amount))}</Td>
                <Td><Badge tone={s.status === "swept" ? "ok" : "bad"}>{s.status}</Badge>{s.dry_run ? " test" : ""}</Td>
                <Td>{s.error_message ? <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{s.error_message}</span> : ""}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <SectionTitle hint="7 derniers jours">Transactions en échec</SectionTitle>
      <ErrorBox text={failed.error} />
      {failed.rows.length === 0 ? (
        <EmptyState text="Aucun échec sur 7 jours." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Date</Th><Th>Type</Th><Th>Actif</Th><Th align="right">Montant</Th>
            </tr>
          </thead>
          <tbody>
            {failed.rows.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #334155" }}>
                <Td>{formatDate(t.created_at)}</Td>
                <Td>{t.type}</Td>
                <Td>{t.asset_symbol}</Td>
                <Td align="right">{formatNumber(Number(t.amount))}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
