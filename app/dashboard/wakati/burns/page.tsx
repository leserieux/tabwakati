import { loadBurns } from "@/lib/burns";
import { EXPLORER } from "@/lib/wakati";
import { formatNumber, formatUsd, formatDateTime } from "@/lib/format";
import { Empty, ErrorNote, PageHeader, Pill, Section, TableWrap, Td, Th } from "@/components/ui";
import { confirmOnchainBurn, burnNow, updateBurnSettings, updateReserveSettings } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" }> = {
  completed: { label: "Brûlé on-chain", tone: "ok" },
  pending_onchain: { label: "À envoyer on-chain", tone: "warn" }
};
function Field({ label, name, defaultValue, hint, placeholder }: { label: string; name: string; defaultValue: number | string | null; hint?: string; placeholder?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step="any" defaultValue={defaultValue ?? ""} placeholder={placeholder} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="wk-field-toggle">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ width: 16, height: 16 }} />
      {label}
    </label>
  );
}

const short = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—");

export default async function BurnsPage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const r = await loadBurns();
  const pending = r.burns.filter((b) => b.status === "pending_onchain");

  return (
    <div>
      <PageHeader title="Burns" subtitle="Tant que le WAKATI vaut moins que le seuil, rien n'est brûlé et tout le bénéfice va dans la caisse. Une fois le seuil atteint, une part du bénéfice est brûlée." updatedAt={formatDateTime(new Date())} />
      <ErrorNote text={r.error ? `Certaines données sont indisponibles : ${r.error}` : null} />
      {searchParams.error && <ErrorNote text={searchParams.msg || "Opération refusée."} />}
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.msg || "Enregistré."}</div>}
      {r.oldestPendingDays !== null && r.oldestPendingDays > 7 && <div className="wk-alert-warn">Des burns attendent d'être envoyés on-chain depuis {Math.floor(r.oldestPendingDays)} jours : ils sont comptés comme brûlés dans l'app mais les jetons sont encore dans le portefeuille de trésorerie.</div>}

      <div className="wk-strip">
        <div className="wk-strip-item"><div className="wk-strip-label">Prix du WAKATI</div><div className="wk-strip-value">{r.rule?.priceFcfa == null ? "—" : `${formatNumber(r.rule.priceFcfa, 4)} FCFA`}</div><div className="wk-strip-sub">{r.rule ? `Burn dès ${formatNumber(r.rule.thresholdFcfa, 2)} FCFA (${r.rule.progressPct == null ? "—" : formatNumber(r.rule.progressPct, 1)} % atteint)` : "Règle indisponible"}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Caisse (réserve de prix)</div><div className="wk-strip-value">{r.reserveUsd === null ? "—" : formatUsd(r.reserveUsd)}</div><div className="wk-strip-sub">{r.rule?.active ? `${formatNumber(r.rule.sharePct, 0)} % du bénéfice brûlé, le reste ici` : "100 % du bénéfice arrive ici"}</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">WAKATI brûlés (total)</div><div className="wk-strip-value">{formatNumber(r.totalBurned, 0)}</div><div className="wk-strip-sub">{formatNumber(r.burnedLast30, 0)} sur 30 jours</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">À envoyer on-chain</div><div className={`wk-strip-value ${r.pendingCount > 0 ? "" : "wk-ok"}`}>{formatNumber(r.pendingAmount, 0)}</div><div className="wk-strip-sub">{r.pendingCount} burn(s) en attente</div></div>
        <div className="wk-strip-item"><div className="wk-strip-label">Trésorerie WAKATI</div><div className="wk-strip-value">{r.treasuryWakati === null ? "—" : formatNumber(r.treasuryWakati, 0)}</div><div className="wk-strip-sub">Prochain passage : 00:20 UTC</div></div>
      </div>

      {r.rule && !r.rule.enabled && <div className="wk-alert-warn">Le burn est en pause : tout le bénéfice va dans la caisse, même au-dessus du seuil.</div>}
      {r.rule && r.rule.enabled && !r.rule.active && <div className="wk-alert-ok">Burn inactif : le WAKATI est à {r.rule.priceFcfa == null ? "—" : formatNumber(r.rule.priceFcfa, 4)} FCFA, sous le seuil de {formatNumber(r.rule.thresholdFcfa, 2)} FCFA. Tout le bénéfice net va dans la caisse pour faire monter le prix.</div>}

      <Section title="Comment ça marche" hint="Un burn n'est complet qu'une fois les jetons envoyés à l'adresse de burn de la blockchain.">
        <div className="wk-panel" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
          <strong>Un seul bénéfice net par jour</strong> (celui qui sert aussi à calculer le prix, calculé à 00:10 UTC). <strong>Sous {r.rule ? formatNumber(r.rule.thresholdFcfa, 2) : "1"} FCFA</strong> : 100 % va dans la caisse, aucun burn. <strong>À partir du seuil</strong> : {r.rule ? formatNumber(r.rule.sharePct, 0) : "30"} % du bénéfice positif du jour est brûlé en WAKATI depuis la trésorerie, le reste va dans la caisse. Un jour de perte ne brûle rien et la caisse l'absorbe.
          Les deux parts sont prélevées sur le même bénéfice : elles ne peuvent pas dépasser 100 %. Le burn est d'abord <strong>comptable</strong> (statut « À envoyer on-chain », à 00:20 UTC, plafonné à {r.rule?.maxTreasuryPctPerDay != null ? formatNumber(r.rule.maxTreasuryPctPerDay, 1) : "—"} % de la trésorerie par jour) : envoyez ensuite les jetons à l'adresse de burn, puis collez le hash ci-dessous.
          <form action={burnNow} style={{ marginTop: 14 }}>
            <button type="submit" className="wk-btn">Lancer un passage de burn maintenant</button>
          </form>
        </div>
      </Section>

      <Section title="Réglages" hint="Tout se règle ici. Chaque modification est validée, enregistrée dans le journal d'audit (avant / après) et appliquée au prochain calcul.">
        {r.rule ? (
          <div className="wk-settings-card">
            <div className="wk-settings-head">
              <div>
                <h3 className="wk-settings-title">Burn</h3>
                <p className="wk-settings-hint">Déclenché quand le prix atteint le seuil. Appliqué au passage de 00:20 UTC (le bénéfice du jour est partagé à 00:10 UTC).</p>
              </div>
              {r.rule.updatedAt && <span className="wk-strip-sub">Modifié le {formatDateTime(new Date(r.rule.updatedAt))}{r.rule.updatedBy ? ` par ${r.rule.updatedBy}` : ""}</span>}
            </div>
            <form action={updateBurnSettings}>
              <div className="wk-form-grid">
                <Field label="Seuil de prix pour commencer le burn (FCFA)" name="burn_start_price_fcfa" defaultValue={r.rule.thresholdFcfa} hint={r.rule.fcfaUsd ? `Soit ${(r.rule.thresholdFcfa * r.rule.fcfaUsd).toLocaleString("fr-FR", { maximumFractionDigits: 6 })} $ au cours actuel du FCFA. Sous ce prix, 100 % va dans la caisse.` : "Sous ce prix, 100 % du bénéfice va dans la caisse."} />
                <Field label="Part du bénéfice brûlée une fois le seuil atteint (%)" name="burn_share_pct" defaultValue={r.rule.sharePct} hint="Le reste va dans la caisse. Jour de perte : aucun burn." />
                <Field label="Plafond par jour (% de la trésorerie WAKATI)" name="max_treasury_pct_per_day" defaultValue={r.rule.maxTreasuryPctPerDay} placeholder="aucun" hint="Vide = pas de plafond en pourcentage." />
                <Field label="Plafond par jour (WAKATI)" name="max_daily_burn_wakati" defaultValue={r.rule.maxDailyBurnWakati} placeholder="aucun" hint="Vide = pas de plafond absolu. Le reste est reporté au lendemain." />
                <Field label="Burn minimum (WAKATI)" name="min_burn_wakati" defaultValue={r.rule.minBurnWakati} hint="En dessous, le montant est reporté." />
                <Field label="Trésorerie à toujours conserver (WAKATI)" name="min_treasury_keep_wakati" defaultValue={r.rule.minTreasuryKeepWakati} hint="Le burn ne descend jamais sous ce solde." />
                <Toggle label="Burn activé (décoché = tout va dans la caisse)" name="enabled" defaultChecked={r.rule.enabled} />
              </div>
              <button type="submit" className="wk-submit-sm">Enregistrer le burn</button>
            </form>
          </div>
        ) : <Empty text="Réglages du burn indisponibles." />}

        {r.reserve ? (
          <div className="wk-settings-card">
            <div className="wk-settings-head">
              <div>
                <h3 className="wk-settings-title">Caisse et prix du WAKATI</h3>
                <p className="wk-settings-hint">{`Caisse actuelle : ${formatUsd(r.reserve.reserveUsd)} (en lecture seule : alimentée chaque jour par le calcul du prix). Mêmes réglages que Réglages > Prix WAKATI.`}</p>
              </div>
              {r.reserve.lastComputedAt && <span className="wk-strip-sub">Dernier calcul le {formatDateTime(new Date(r.reserve.lastComputedAt))}</span>}
            </div>
            <form action={updateReserveSettings}>
              <div className="wk-form-grid">
                <Field label="Part versée à la caisse (%)" name="profit_share_pct" defaultValue={r.reserve.profitSharePct} hint="Appliquée au bénéfice restant après le burn. Moins de 100 % = le reste reste à la plateforme." />
                <Field label="Variation max du prix par jour (%)" name="max_daily_change_pct" defaultValue={r.reserve.maxDailyChangePct} hint="Plafonne la hausse ou la baisse quotidienne du prix calculé." />
                <Field label="Prix plancher (USD)" name="price_floor_usd" defaultValue={r.reserve.priceFloorUsd} hint={r.rule?.fcfaUsd ? `Soit ${(r.reserve.priceFloorUsd / r.rule.fcfaUsd).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} FCFA. Le prix ne descend jamais en dessous (le relever fait remonter le prix dès le prochain calcul).` : "Le prix ne descend jamais en dessous."} />
                <Toggle label="Calcul automatique du prix actif" name="is_active" defaultChecked={r.reserve.isActive} />
              </div>
              <button type="submit" className="wk-submit-sm">Enregistrer la caisse et le prix</button>
            </form>
          </div>
        ) : null}
      </Section>

      <Section title="Derniers passages">
        {r.runs.length === 0 ? <Empty text="Aucun passage pour le moment (premier passage à 00:20 UTC)." /> : (
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Résultat</Th><Th right>WAKATI brûlés</Th><Th right hideSm>Dû ($)</Th><Th hideSm>Détail</Th></tr></thead>
            <tbody>
              {r.runs.map((x) => (
                <tr key={x.id}>
                  <Td label="Date">{formatDateTime(new Date(x.run_at))}</Td>
                  <Td label="Résultat"><Pill tone={x.status === "burned" ? "ok" : "warn"}>{x.status === "burned" ? "Brûlé" : x.status === "empty" ? "Rien à brûler" : x.status === "paused" ? "En pause" : "Reporté"}</Pill></Td>
                  <Td right label="WAKATI brûlés">{formatNumber(x.burnWakati, 2)}</Td>
                  <Td right hideSm label="Dû ($)">{formatUsd(x.newDueUsd)}</Td>
                  <Td hideSm label="Détail"><span style={{ color: "var(--muted)", fontSize: 13 }}>{x.note ?? "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
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
