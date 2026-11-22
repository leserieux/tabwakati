import { loadPushOverview, pushTypeLabel } from "@/modules/system/push";
import { formatDateTime, formatNumber, formatPct } from "@/core/format";
import { PageHeader, Section, TableWrap, Td, Th, Pill, Empty, ErrorNote } from "@/components/ui";
import { sendBroadcast, setPushType } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { saved?: string; error?: string; msg?: string };

export default async function NotificationsPage({ searchParams }: { searchParams: Params }) {
  const { data: p, error } = await loadPushOverview();
  const coverage = p && p.users_total > 0 ? (p.users_with_device / p.users_total) * 100 : 0;

  return (
    <div>
      <PageHeader
        title="Notifications push"
        subtitle="Appareils enregistrés pour les push (FCM), types de notification activables et envoi de messages aux utilisateurs."
        updatedAt={formatDateTime(new Date())}
      />
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.msg || "Enregistré."}</div>}
      {searchParams.error && <div className="wk-alert-bad">{searchParams.msg || "Échec de l'opération."}</div>}
      <ErrorNote text={error ? `Données push illisibles : ${error}. Vérifiez que la migration 20261117_admin_markets_push_telegram_p2p est appliquée.` : null} />

      {p && p.devices === 0 && (
        <div className="wk-alert-warn">
          Aucun appareil n'est enregistré pour les push : aucune notification ne part pour l'instant, quel que soit le réglage ci-dessous. Un appareil s'enregistre quand un utilisateur ouvre une version de l'app qui active les notifications et accepte l'autorisation.
        </div>
      )}

      {p && (
        <div className="wk-strip">
          <div className="wk-strip-item"><div className="wk-strip-label">Appareils enregistrés</div><div className="wk-strip-value">{formatNumber(p.devices, 0)}</div><div className="wk-strip-sub">{p.last_registered_at ? `Dernier : ${formatDateTime(new Date(p.last_registered_at))}` : "Aucun enregistrement"}</div></div>
          <div className="wk-strip-item"><div className="wk-strip-label">Utilisateurs joignables</div><div className="wk-strip-value">{formatNumber(p.users_with_device, 0)}</div><div className="wk-strip-sub">{formatPct(coverage)} des {formatNumber(p.users_total, 0)} utilisateurs</div></div>
          <div className="wk-strip-item"><div className="wk-strip-label">Types de push actifs</div><div className="wk-strip-value">{p.types.filter((t) => t.enabled).length} / {p.types.length}</div><div className="wk-strip-sub">Un type coupé n'envoie plus de push</div></div>
          <div className="wk-strip-item"><div className="wk-strip-label">Plateformes</div><div className="wk-strip-value">{p.by_platform.length === 0 ? "—" : p.by_platform.map((x) => `${x.platform} ${x.devices}`).join(" · ")}</div><div className="wk-strip-sub">{p.by_version.length === 0 ? "Aucune version" : `Versions : ${p.by_version.slice(0, 3).map((v) => `${v.version} (${v.devices})`).join(", ")}`}</div></div>
        </div>
      )}

      <Section title="Envoyer un message" hint="Le message part en push sur les appareils enregistrés et, si la case est cochée, est aussi déposé dans la boîte de notifications de l'app (type « Message de l'équipe »), y compris pour les utilisateurs sans appareil.">
        <div className="wk-settings-card">
          <form action={sendBroadcast}>
            <div className="wk-form-grid">
              <div>
                <label className="wk-label" htmlFor="title">Titre (60 caractères max)</label>
                <input id="title" name="title" type="text" maxLength={60} required className="wk-input" />
              </div>
              <div>
                <label className="wk-label" htmlFor="body">Message (240 caractères max)</label>
                <textarea id="body" name="body" rows={3} maxLength={240} required className="wk-input" />
              </div>
              <div>
                <span className="wk-label">Destinataires</span>
                <div className="wk-radio-group">
                  <label className="wk-radio-option"><input type="radio" name="audience" value="users" defaultChecked />Une liste d'utilisateurs</label>
                  <label className="wk-radio-option"><input type="radio" name="audience" value="all" />Tous les utilisateurs</label>
                </div>
              </div>
              <div>
                <label className="wk-label" htmlFor="recipients">Liste (si « une liste »)</label>
                <textarea id="recipients" name="recipients" rows={2} placeholder="noms d'utilisateur, e-mails ou identifiants, séparés par des espaces ou virgules (200 max)" className="wk-input" />
              </div>
              <div>
                <label className="wk-label" htmlFor="confirm">Tapez ENVOYER (obligatoire pour « tous »)</label>
                <input id="confirm" name="confirm" type="text" autoComplete="off" placeholder="ENVOYER" className="wk-input" />
              </div>
              <label className="wk-field-toggle">
                <input type="checkbox" name="save_in_app" defaultChecked style={{ width: 16, height: 16 }} />
                Aussi dans la boîte de notifications de l'app
              </label>
            </div>
            <button type="submit" className="wk-submit-sm">Envoyer</button>
          </form>
        </div>
        <div className="wk-asset-sub" style={{ marginTop: 8 }}>L'envoi est définitif et inscrit dans le journal d'audit (titre, message, nombre d'appareils touchés).</div>
      </Section>

      <Section title="Types de notification" hint="Activer ou couper l'envoi de push par type. Couper un type ne supprime pas la notification dans l'app : seul le push disparaît.">
        {!p || p.types.length === 0 ? <Empty text="Aucun type configuré." /> : (
          <TableWrap>
            <thead><tr><Th>Type</Th><Th hideSm>Code</Th><Th right>Notifications (30 j)</Th><Th>État</Th><Th>Action</Th></tr></thead>
            <tbody>
              {p.types.map((t) => (
                <tr key={t.type}>
                  <Td label="Type">{pushTypeLabel(t.type)}</Td>
                  <Td hideSm label="Code"><span className="wk-asset-sub">{t.type}</span></Td>
                  <Td right label="Notifications (30 j)">{formatNumber(t.notifs_30d, 0)}</Td>
                  <Td label="État">{t.enabled ? <Pill tone="ok">Push actif</Pill> : <Pill tone="warn">Push coupé</Pill>}</Td>
                  <Td label="Action">
                    <form action={setPushType}>
                      <input type="hidden" name="type" value={t.type} />
                      <input type="hidden" name="enabled" value={t.enabled ? "0" : "1"} />
                      <button type="submit" className="wk-submit-sm">{t.enabled ? "Couper" : "Réactiver"}</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      {p && p.types_without_push.length > 0 && (
        <Section title="Notifications sans push" hint="Types créés dans l'app ces 30 derniers jours mais absents de la liste des push : ils ne déclenchent jamais de notification sur le téléphone.">
          <TableWrap>
            <thead><tr><Th>Type</Th><Th right>Notifications (30 j)</Th></tr></thead>
            <tbody>
              {p.types_without_push.map((t) => (
                <tr key={t.type}><Td label="Type">{t.type}</Td><Td right label="Notifications (30 j)">{formatNumber(t.n, 0)}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Section>
      )}
    </div>
  );
}
