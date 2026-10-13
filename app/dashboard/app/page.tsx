import { getSupabaseAdmin } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import { publishAppVersion } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppVersionPage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const { data: v, error } = await getSupabaseAdmin().from("app_versions").select("*").eq("platform", "android").maybeSingle();

  return (
    <div>
      <PageHeader title="Application mobile" subtitle="Publiez ici la dernière version de l'APK. Au démarrage, l'application compare son numéro de build à celui-ci et propose la mise à jour." updatedAt={v?.updated_at ? formatDateTime(new Date(v.updated_at)) : undefined} />

      {searchParams.saved && <div className="wk-alert-ok">{searchParams.msg || "Enregistré."}</div>}
      {searchParams.error && <div className="wk-alert-bad">{searchParams.msg || "Échec de l'enregistrement."}</div>}
      {error && <div className="wk-alert-bad">Lecture impossible : {error.message}</div>}

      <Section title="Version actuellement proposée" hint="Ce que les applications lisent au démarrage.">
        {v ? (
          <div className="wk-panel">
            <div className="wk-kv">
              <div className="wk-kv-row"><span>Dernière version</span><span>{v.latest_name ?? "—"} (build {v.latest_build})</span></div>
              <div className="wk-kv-row"><span>Version minimale obligatoire</span><span>build {v.min_build}{v.min_build > 1 ? " (les versions plus anciennes sont bloquées)" : " (aucune obligation)"}</span></div>
              <div className="wk-kv-row"><span>Lien de l'APK</span><span style={{ wordBreak: "break-all" }}>{v.apk_url}</span></div>
              <div className="wk-kv-row"><span>Empreinte SHA-256</span><span style={{ wordBreak: "break-all" }}>{v.apk_sha256 ?? "non renseignée"}</span></div>
              <div className="wk-kv-row"><span>Notes</span><span>{v.notes ?? "—"}</span></div>
            </div>
          </div>
        ) : (
          <div className="wk-hint">Aucune version publiée : les applications ne proposent aucune mise à jour.</div>
        )}
      </Section>

      <Section title={v ? "Publier une nouvelle version" : "Publier la première version"} hint="Le numéro de build est le nombre après le + dans pubspec.yaml (version: 1.0.3+12 → build 12). Il doit augmenter à chaque APK.">
        <form action={publishAppVersion}>
          <div className="wk-form-grid">
            <div className="wk-field">
              <label className="wk-label" htmlFor="latest_name">Nom de la version</label>
              <input id="latest_name" name="latest_name" type="text" placeholder="1.0.3" defaultValue={v?.latest_name ?? ""} className="wk-input" />
            </div>
            <div className="wk-field">
              <label className="wk-label" htmlFor="latest_build">Numéro de build</label>
              <input id="latest_build" name="latest_build" type="number" min={1} step={1} required defaultValue={v ? v.latest_build + 1 : ""} className="wk-input" />
            </div>
            <div className="wk-field">
              <label className="wk-label" htmlFor="min_build">Build minimum obligatoire</label>
              <input id="min_build" name="min_build" type="number" min={1} step={1} required defaultValue={v?.min_build ?? 1} className="wk-input" />
            </div>
            <div className="wk-field" style={{ gridColumn: "1 / -1" }}>
              <label className="wk-label" htmlFor="apk_url">Lien de téléchargement de l'APK (https)</label>
              <input id="apk_url" name="apk_url" type="url" required placeholder="https://…/app-release.apk" defaultValue={v?.apk_url ?? ""} className="wk-input" />
            </div>
            <div className="wk-field" style={{ gridColumn: "1 / -1" }}>
              <label className="wk-label" htmlFor="apk_sha256">Empreinte SHA-256 de l'APK (recommandée)</label>
              <input id="apk_sha256" name="apk_sha256" type="text" placeholder="64 caractères hexadécimaux" defaultValue={v?.apk_sha256 ?? ""} className="wk-input" />
            </div>
            <div className="wk-field" style={{ gridColumn: "1 / -1" }}>
              <label className="wk-label" htmlFor="notes">Notes affichées aux utilisateurs</label>
              <textarea id="notes" name="notes" rows={3} defaultValue={v?.notes ?? ""} className="wk-input" />
            </div>
            <label className="wk-field-toggle" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" name="confirm_force" style={{ width: 16, height: 16 }} />
              <span>Je confirme que les versions inférieures au build minimum seront bloquées (à cocher si vous augmentez le minimum).</span>
            </label>
            <label className="wk-field-toggle" style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" name="confirm_rollback" style={{ width: 16, height: 16 }} />
              <span>Revenir en arrière (à cocher seulement si le nouveau build est plus ancien que le build publié).</span>
            </label>
          </div>
          <div style={{ marginTop: 14 }}><button type="submit" className="wk-submit-sm">Publier</button></div>
        </form>
        <div className="wk-hint" style={{ marginTop: 10 }}>
          Calculer l'empreinte : <code>sha256sum app-release.apk</code> (Linux/Mac) ou <code>certutil -hashfile app-release.apk SHA256</code> (Windows).
          Gardez toujours le même keystore de signature, sinon Android refusera d'installer la mise à jour par-dessus l'ancienne version.
        </div>
      </Section>
    </div>
  );
}
