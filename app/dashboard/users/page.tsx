import { getSupabaseAdmin, q } from "@/lib/data";
import { formatUsd, formatDate, shortId } from "@/lib/format";
import { PageTitle, SectionTitle, TableShell, Th, Td, Badge, EmptyState, ErrorBox, Kpi, KpiGrid } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const db = getSupabaseAdmin();
  const { rows, error } = await q<any>(
    db
      .from("admin_users_overview")
      .select("id, username, country_code, verification_status, is_verified, user_level, portfolio_value_usd, total_staked_usd, active_stakes, last_activity_at, created_at")
      .order("portfolio_value_usd", { ascending: false })
  );

  const total = rows.length;
  const byCountry = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const u of rows) {
    byCountry.set(u.country_code || "?", (byCountry.get(u.country_code || "?") || 0) + 1);
    byStatus.set(u.verification_status || "inconnu", (byStatus.get(u.verification_status || "inconnu") || 0) + 1);
  }
  const top = rows.slice(0, 50);
  const totalUsd = rows.reduce((n, u) => n + Number(u.portfolio_value_usd || 0), 0);
  const top10Usd = rows.slice(0, 10).reduce((n, u) => n + Number(u.portfolio_value_usd || 0), 0);

  return (
    <div>
      <PageTitle title="Utilisateurs" subtitle="Répartition et plus gros portefeuilles. Les emails ne sont volontairement pas affichés." />
      <ErrorBox text={error} />

      <KpiGrid>
        <Kpi label="Utilisateurs" value={String(total)} />
        <Kpi label="Valeur totale" value={formatUsd(totalUsd)} />
        <Kpi label="Concentration top 10" value={totalUsd > 0 ? `${Math.round((top10Usd / totalUsd) * 100)} %` : "—"} sub="part des 10 plus gros portefeuilles" tone={totalUsd > 0 && top10Usd / totalUsd > 0.8 ? "warn" : undefined} />
      </KpiGrid>

      <SectionTitle>Répartition</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <TableShell>
          <thead><tr style={{ background: "#0f172a" }}><Th>Pays</Th><Th align="right">Utilisateurs</Th></tr></thead>
          <tbody>
            {[...byCountry.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => (
              <tr key={c} style={{ borderTop: "1px solid #334155" }}><Td>{c}</Td><Td align="right">{n}</Td></tr>
            ))}
          </tbody>
        </TableShell>
        <TableShell>
          <thead><tr style={{ background: "#0f172a" }}><Th>Vérification</Th><Th align="right">Utilisateurs</Th></tr></thead>
          <tbody>
            {[...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <tr key={s} style={{ borderTop: "1px solid #334155" }}><Td>{s}</Td><Td align="right">{n}</Td></tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <SectionTitle hint="Triés par valeur de portefeuille (50 premiers)">Plus gros portefeuilles</SectionTitle>
      {top.length === 0 ? (
        <EmptyState text="Aucun utilisateur." />
      ) : (
        <TableShell>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              <Th>Utilisateur</Th><Th>Pays</Th><Th>Vérification</Th><Th align="right">Niveau</Th>
              <Th align="right">Portefeuille</Th><Th align="right">Staké</Th><Th>Dernière activité</Th><Th>Inscrit</Th>
            </tr>
          </thead>
          <tbody>
            {top.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid #334155" }}>
                <Td>
                  <strong style={{ color: "#f8fafc" }}>{u.username || "—"}</strong>
                  <div style={{ color: "#64748b", fontSize: "0.7rem", fontFamily: "ui-monospace, monospace" }}>{shortId(u.id)}</div>
                </Td>
                <Td>{u.country_code || "—"}</Td>
                <Td><Badge tone={u.is_verified ? "ok" : "info"}>{u.verification_status || (u.is_verified ? "vérifié" : "non vérifié")}</Badge></Td>
                <Td align="right">{u.user_level ?? "—"}</Td>
                <Td align="right">{formatUsd(Number(u.portfolio_value_usd || 0))}</Td>
                <Td align="right">{formatUsd(Number(u.total_staked_usd || 0))}</Td>
                <Td>{formatDate(u.last_activity_at)}</Td>
                <Td>{formatDate(u.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
