import { loadWakati } from "@/lib/wakati";
import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { ConfirmDeleteButton } from "@/app/dashboard/settings/ConfirmDeleteButton";
import { updateStakingPool, addStakingPool, deleteStakingPool } from "@/app/dashboard/settings/actions";
import { Field, TextField, AssetSelect, RadioGroup, Toggle, SettingsCard, SettingsMessages } from "@/components/settings-form";

const RETURN = "/dashboard/wakati/staking";
type SettingsParams = { saved?: string; error?: string; msg?: string };

import { formatToken, formatCompactNumber, formatPct, formatUsd, formatPrice } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StakingPage({ searchParams }: { searchParams: SettingsParams }) {
  const db = getSupabaseAdmin();
  const [w, assets, stakingPools] = await Promise.all([
    loadWakati(),
    q<{ symbol: string; name: string; is_active: boolean }>(db.from("supported_assets").select("symbol, name, is_active").order("symbol")),
    q<any>(db.from("staking_pools").select("*").order("sort_order").order("created_at"))
  ]);
  const fmtUpdated = (iso?: string) => (iso ? formatDateTime(new Date(iso)) : null);

  const { pool, inApp } = w;
  const stakingRate = inApp.total > 0 ? inApp.staking / inApp.total : 0;
  const yearly = pool ? pool.totalStaked * (pool.apr / 100) : 0;

  const txMap = new Map(w.flows.tx.map((t) => [t.type, t]));
  const rows = [
    { label: "Mis en staking", t: txMap.get("stake") },
    { label: "Retirés du staking", t: txMap.get("unstake") },
    { label: "Récompenses versées", t: txMap.get("staking_reward") }
  ];

  return (
    <div>
      <SettingsMessages searchParams={searchParams} />
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}

      {!pool ? (
        <Empty text="Aucun pool de staking WAKATI." />
      ) : (
        <>
          <div className="wk-strip">
            <div className="wk-strip-item">
              <div className="wk-strip-label">En staking</div>
              <div className="wk-strip-value">{formatCompactNumber(pool.totalStaked)}</div>
              <div className="wk-strip-sub">{formatUsd(pool.totalStaked * w.price)}</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Taux de staking</div>
              <div className="wk-strip-value">{formatPct(stakingRate * 100)}</div>
              <div className="wk-strip-sub">des WAKATI détenus en app</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Stakers actifs</div>
              <div className="wk-strip-value">{pool.stakers}</div>
              <div className="wk-strip-sub">sur {inApp.holders} détenteurs</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Rendement annuel</div>
              <div className="wk-strip-value">{formatPct(pool.apr, 1)}</div>
              <div className="wk-strip-sub">mise minimale {formatToken(pool.minStake)}</div>
            </div>
          </div>

          <Section title="Coût du staking" hint="Ce que le pool coûte en nouveaux WAKATI distribués aux stakers.">
            <div className="wk-grid-2">
              <div className="wk-panel">
                <div className="wk-kv">
                  <div className="wk-kv-row"><span>Émission annuelle estimée</span><span>{formatToken(yearly)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Par jour, environ</span><span>{formatToken(yearly / 365)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Valeur annuelle estimée</span><span>{formatUsd(yearly * w.price)}</span></div>
                  <div className="wk-kv-row"><span>Récompenses en attente</span><span>{formatToken(pool.pendingRewards)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Récompenses déjà versées</span><span>{formatToken(pool.rewardsDistributed)} WAKATI</span></div>
                </div>
              </div>
              <div className="wk-callout wk-callout-warn">
                Les récompenses de staking s'ajoutent à l'offre en app : plus le pool grossit, plus il distribue de nouveaux WAKATI. Au prix actuel ({formatPrice(w.price)}), cela représente {formatUsd(yearly * w.price)} par an.
              </div>
            </div>
          </Section>

          <Section title="Pool">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pool</Th>
                  <Th right>Rendement</Th>
                  <Th right>Mise min.</Th>
                  <Th right>En staking</Th>
                  <Th right>Stakers</Th>
                  <Th right>Versé</Th>
                  <Th>Statut</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td><strong style={{ color: "var(--ink)" }}>{pool.name}</strong></Td>
                  <Td right label="Rendement">{formatPct(pool.apr, 1)}</Td>
                  <Td right label="Mise min.">{formatToken(pool.minStake)}</Td>
                  <Td right label="En staking">{formatToken(pool.totalStaked)}</Td>
                  <Td right label="Stakers">{pool.stakers}</Td>
                  <Td right label="Versé">{formatToken(pool.rewardsDistributed)}</Td>
                  <Td label="Statut">{pool.isActive ? <Pill tone="ok">Actif</Pill> : <Pill tone="info">Inactif</Pill>}</Td>
                </tr>
              </tbody>
            </TableWrap>
          </Section>

          <Section title={`Mouvements sur ${w.flows.days} jours`}>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Mouvement</Th>
                  <Th right>Opérations</Th>
                  <Th right>Quantité</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td right label="Opérations">{r.t?.count ?? 0}</Td>
                    <Td right label="Quantité">{formatToken(r.t?.total ?? 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>
        </>
      )}

      <Section title="Réglages — plans de staking" hint="Plan flexible (retrait à tout moment) ou bloqué (durée fixe, retrait anticipé avec frais optionnel). Le blocage est appliqué côté serveur (fn_stake/fn_unstake).">
        {stakingPools.rows.length === 0 ? (
          <div className="wk-alert-bad">Aucun plan trouvé dans staking_pools.</div>
        ) : (
          stakingPools.rows.map((sp: any) => (
            <SettingsCard returnTo={RETURN}
              key={sp.id}
              title={`${sp.name} (${sp.asset_symbol})`}
              hint={`${sp.staking_type === "locked" ? `Bloqué ${sp.lock_period_days} jours` : "Flexible — retrait à tout moment"}. ${Number(sp.total_staked).toLocaleString("fr-FR")} ${sp.asset_symbol} actuellement en staking sur ce plan.`}
              updatedAt={fmtUpdated(sp.updated_at)}
              action={updateStakingPool}
              headerExtra={
                <ConfirmDeleteButton
                  action={deleteStakingPool}
                  hiddenFields={{ return_to: RETURN, id: sp.id, label: `${sp.name} (${sp.asset_symbol})` }}
                  confirmText={`Supprimer le plan « ${sp.name} » ? Impossible s'il reste des dépôts actifs dessus. Cette action est irréversible.`}
                />
              }
            >
              <input type="hidden" name="id" value={sp.id} />
              <input type="hidden" name="label" value={`${sp.name} (${sp.asset_symbol})`} />
              <TextField label="Nom" name="name" defaultValue={sp.name} />
              <RadioGroup
                label="Type"
                name="staking_type"
                defaultValue={sp.staking_type}
                options={[
                  { value: "flexible", label: "Flexible" },
                  { value: "locked", label: "Bloqué" }
                ]}
              />
              <Field label="Durée (jours)" name="lock_period_days" step="1" defaultValue={sp.lock_period_days} hint="Ignoré si le type est Flexible." />
              <Field label="APR (%)" name="base_apy" defaultValue={sp.base_apy} hint="Récompense/jour = montant × apr / 100 / 365." />
              <Field label="Dépôt min" name="min_stake" defaultValue={sp.min_stake} />
              <Field label="Dépôt max (par utilisateur)" name="max_stake" defaultValue={sp.max_stake ?? ""} hint="Vide = illimité." />
              <Field label="Capacité totale du plan" name="max_pool_capacity" defaultValue={sp.max_pool_capacity ?? ""} hint="Vide = illimité. Tous utilisateurs confondus." />
              <Toggle label="Retrait anticipé autorisé" name="instant_unstake_enabled" defaultChecked={sp.instant_unstake_enabled} />
              <Field label="Frais de retrait anticipé (%)" name="instant_unstake_fee_percent" defaultValue={sp.instant_unstake_fee_percent ?? ""} hint="Appliqué si retrait avant la fin du blocage." />
              <Field label="Ordre d'affichage" name="sort_order" step="1" defaultValue={sp.sort_order} />
              <Toggle label="Plan actif" name="is_active" defaultChecked={sp.is_active} />
              <TextField label="Description (visible des utilisateurs)" name="description" defaultValue={sp.description || ""} />
            </SettingsCard>
          ))
        )}

        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Ajouter un plan de staking</h3>
              <p className="wk-settings-hint">Le blocage est appliqué côté serveur — un plan « Bloqué » empêche vraiment le retrait avant la fin de la durée, sauf si « Retrait anticipé autorisé » est coché.</p>
            </div>
          </div>
          <form action={addStakingPool}>
            <input type="hidden" name="return_to" value={RETURN} />
            <div className="wk-form-grid">
              <TextField label="Nom" name="name" defaultValue="" />
              <AssetSelect label="Actif" name="asset_symbol" defaultValue="WAKATI" assets={assets.rows} />
              <RadioGroup
                label="Type"
                name="staking_type"
                defaultValue="flexible"
                options={[
                  { value: "flexible", label: "Flexible" },
                  { value: "locked", label: "Bloqué" }
                ]}
              />
              <Field label="Durée (jours)" name="lock_period_days" step="1" defaultValue={0} hint="Ignoré si le type est Flexible." />
              <Field label="APR (%)" name="base_apy" defaultValue={0} />
              <Field label="Dépôt min" name="min_stake" defaultValue={0} />
              <Field label="Dépôt max (par utilisateur)" name="max_stake" defaultValue="" hint="Vide = illimité." />
              <Field label="Capacité totale du plan" name="max_pool_capacity" defaultValue="" hint="Vide = illimité." />
              <Toggle label="Retrait anticipé autorisé" name="instant_unstake_enabled" defaultChecked={true} />
              <Field label="Frais de retrait anticipé (%)" name="instant_unstake_fee_percent" defaultValue="" hint="Appliqué si retrait avant la fin du blocage." />
              <Field label="Ordre d'affichage" name="sort_order" step="1" defaultValue={100} />
              <Toggle label="Plan actif" name="is_active" defaultChecked={false} />
              <TextField label="Description (visible des utilisateurs)" name="description" defaultValue="" />
            </div>
            <button type="submit" className="wk-submit-sm">Ajouter le plan</button>
          </form>
        </div>
      </Section>

    </div>
  );
}
