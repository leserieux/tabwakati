import { loadTelegramOverview, telegramEventLabel } from "@/lib/telegram";
import { formatDateTime, formatNumber, formatPct, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Td, Th, Pill, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const userCell = (id: string | null, username: string | null, email: string | null) =>
  id ? <a className="wk-link" href={`/dashboard/users/${id}`}>{username ?? email ?? shortId(id)}</a> : <span className="wk-asset-sub">—</span>;

const eventTone = (e: string) => (e === "linked" ? "ok" : e === "unlinked" ? "warn" : e.includes("reject") ? "bad" : "info") as "ok" | "warn" | "bad" | "info";

export default async function TelegramPage() {
  const { data: t, error } = await loadTelegramOverview();
  const share = t && t.users_total > 0 ? (t.links / t.users_total) * 100 : 0;
  const count = (e: string) => t?.audit_30d.find((x) => x.event === e)?.n ?? 0;

  return (
    <div>
      <PageHeader
        title="Bot Telegram"
        subtitle="Comptes Telegram liés à un compte WAKATI (la connexion Google reste le seul vrai compte) et journal des liaisons."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={error ? `Données Telegram illisibles : ${error}. Vérifiez que la migration 20261117_admin_markets_push_telegram_p2p est appliquée.` : null} />

      {t && (
        <>
          <div className="wk-strip">
            <div className="wk-strip-item"><div className="wk-strip-label">Comptes liés</div><div className="wk-strip-value">{formatNumber(t.links, 0)}</div><div className="wk-strip-sub">{formatPct(share)} des {formatNumber(t.users_total, 0)} utilisateurs</div></div>
            <div className="wk-strip-item"><div className="wk-strip-label">Nouvelles liaisons (7 j)</div><div className="wk-strip-value">{formatNumber(t.linked_7d, 0)}</div><div className="wk-strip-sub">{t.by_via.map((v) => `${v.via} ${v.n}`).join(" · ") || "—"}</div></div>
            <div className="wk-strip-item"><div className="wk-strip-label">Liens de liaison</div><div className="wk-strip-value">{formatNumber(t.tokens.pending, 0)} en attente</div><div className="wk-strip-sub">{t.tokens.used} utilisé(s) · {t.tokens.expired} expiré(s) non utilisé(s)</div></div>
            <div className="wk-strip-item"><div className="wk-strip-label">Langues</div><div className="wk-strip-value">{t.by_lang.map((l) => `${l.lang} ${l.n}`).join(" · ") || "—"}</div><div className="wk-strip-sub">Le bot est développé en anglais</div></div>
          </div>

          {count("unlinked") > count("linked") && count("linked") > 0 && (
            <div className="wk-alert-warn">Plus de déliaisons ({count("unlinked")}) que de liaisons ({count("linked")}) sur 30 jours : le parcours de liaison pose peut-être problème.</div>
          )}

          <Section title="Activité (30 jours)" hint="Événements du journal des liaisons (aucun jeton n'est affiché ni stocké en clair).">
            {t.audit_30d.length === 0 ? <Empty text="Aucun événement sur 30 jours." /> : (
              <TableWrap>
                <thead><tr><Th>Événement</Th><Th right>Nombre</Th></tr></thead>
                <tbody>{t.audit_30d.map((a) => (<tr key={a.event}><Td label="Événement"><Pill tone={eventTone(a.event)}>{telegramEventLabel(a.event)}</Pill></Td><Td right label="Nombre">{formatNumber(a.n, 0)}</Td></tr>))}</tbody>
              </TableWrap>
            )}
          </Section>

          <Section title="Comptes liés" hint="Les 50 plus récents.">
            {t.recent_links.length === 0 ? <Empty text="Aucun compte Telegram lié." /> : (
              <TableWrap>
                <thead><tr><Th>Utilisateur WAKATI</Th><Th>Telegram</Th><Th hideSm>Mode</Th><Th hideSm>Langue</Th><Th>Lié le</Th></tr></thead>
                <tbody>
                  {t.recent_links.map((l) => (
                    <tr key={l.telegram_id}>
                      <Td label="Utilisateur WAKATI">{userCell(l.user_id, l.username, l.email)}</Td>
                      <Td label="Telegram">{l.telegram_username ? `@${l.telegram_username}` : l.telegram_first_name ?? "—"} <span className="wk-asset-sub">#{l.telegram_id}</span></Td>
                      <Td hideSm label="Mode">{l.linked_via ?? "—"}</Td>
                      <Td hideSm label="Langue">{l.lang ?? "—"}</Td>
                      <Td label="Lié le">{formatDateTime(new Date(l.created_at))}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Section>

          <Section title="Journal des liaisons" hint="Les 40 derniers événements.">
            {t.recent_audit.length === 0 ? <Empty text="Aucun événement." /> : (
              <TableWrap>
                <thead><tr><Th>Date</Th><Th>Événement</Th><Th>Utilisateur</Th><Th hideSm>Telegram</Th></tr></thead>
                <tbody>
                  {t.recent_audit.map((a, i) => (
                    <tr key={`${a.created_at}-${i}`}>
                      <Td label="Date">{formatDateTime(new Date(a.created_at))}</Td>
                      <Td label="Événement"><Pill tone={eventTone(a.event)}>{telegramEventLabel(a.event)}</Pill></Td>
                      <Td label="Utilisateur">{userCell(a.user_id, a.username, a.email)}</Td>
                      <Td hideSm label="Telegram">{a.telegram_id ? `#${a.telegram_id}` : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
