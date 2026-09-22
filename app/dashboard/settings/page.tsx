import React from "react";
import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import { DeleteCountryButton } from "./DeleteCountryButton";
import {
  updateStakingConfig,
  updateWheelConfig,
  updatePredictionConfig,
  updateScoreCreditConfig,
  updatePaymentCountry,
  addPaymentCountry,
  deletePaymentCountry,
  updateCampayConfig
} from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Field({ label, name, defaultValue, step = "any", hint }: { label: string; name: string; defaultValue: number | string; step?: string; hint?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step={step} defaultValue={defaultValue} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function TextField({ label, name, defaultValue, hint }: { label: string; name: string; defaultValue: string; hint?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="text" defaultValue={defaultValue} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function AssetSelect({ label, name, defaultValue, assets }: { label: string; name: string; defaultValue: string; assets: { symbol: string; name: string; is_active: boolean }[] }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="wk-input">
        {assets.map((a) => (
          <option key={a.symbol} value={a.symbol}>
            {a.symbol} — {a.name}{!a.is_active ? " (inactif)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProviderSelect({ label, name, defaultValue, providers, allowNone }: { label: string; name: string; defaultValue: string; providers: { code: string; name: string; is_active: boolean }[]; allowNone?: boolean }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="wk-input">
        {allowNone && <option value="">Aucun</option>}
        {providers.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}{!p.is_active ? " (inactif)" : ""}
          </option>
        ))}
      </select>
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

function Card({ title, hint, updatedAt, headerExtra, action, children }: { title: string; hint: string; updatedAt?: string | null; headerExtra?: React.ReactNode; action: (formData: FormData) => void; children: React.ReactNode }) {
  return (
    <div className="wk-settings-card">
      <div className="wk-settings-head">
        <div>
          <h3 className="wk-settings-title">{title}</h3>
          <p className="wk-settings-hint">{hint}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {updatedAt && <span className="wk-strip-sub">Modifié le {updatedAt}</span>}
          {headerExtra}
        </div>
      </div>
      <form action={action}>
        <div className="wk-form-grid">{children}</div>
        <button type="submit" className="wk-submit-sm">Enregistrer</button>
      </form>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const db = getSupabaseAdmin();
  const [staking, wheel, prediction, scoreCredit, campay, assets, countries, providers] = await Promise.all([
    q<any>(db.from("staking_config").select("*").eq("id", 1).limit(1)),
    q<any>(db.from("wheel_config").select("*").eq("id", 1).limit(1)),
    q<any>(db.from("prediction_config").select("*").eq("id", 1).limit(1)),
    q<any>(db.from("score_credit_config").select("*").eq("id", 1).limit(1)),
    q<any>(db.from("campay_config").select("*").eq("id", 1).limit(1)),
    q<{ symbol: string; name: string; is_active: boolean }>(db.from("supported_assets").select("symbol, name, is_active").order("symbol")),
    q<any>(db.from("payment_countries").select("*").order("sort_order")),
    q<{ code: string; name: string; is_active: boolean }>(db.from("payment_providers").select("code, name, is_active").order("code"))
  ]);

  const s = staking.rows[0];
  const w = wheel.rows[0];
  const p = prediction.rows[0];
  const sc = scoreCredit.rows[0];
  const c = campay.rows[0];

  const queryErrors = [staking.error, wheel.error, prediction.error, scoreCredit.error, campay.error, assets.error, countries.error, providers.error].filter(Boolean).join(" · ");
  const fmtUpdated = (iso?: string) => (iso ? formatDateTime(new Date(iso)) : null);

  return (
    <div>
      <PageHeader
        title="Paramètres"
        subtitle="Les réglages qui pilotent le comportement de la plateforme. Chaque section s'enregistre séparément."
        updatedAt={formatDateTime(new Date())}
      />

      {queryErrors && <div className="wk-alert-bad">Certains réglages n'ont pas pu être lus : {queryErrors}</div>}
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.saved} enregistré.</div>}
      {searchParams.error && (
        <div className="wk-alert-bad">
          Échec de l'enregistrement ({searchParams.error}){searchParams.msg ? ` : ${searchParams.msg}` : "."}
        </div>
      )}

      {s ? (
        <Card title="Staking" hint="Taux annuel appliqué au pool unique de staking WAKATI." updatedAt={fmtUpdated(s.updated_at)} action={updateStakingConfig}>
          <Field label="APR (%)" name="apr" defaultValue={s.apr} hint="Récompense/jour = montant × apr / 100 / 365." />
          <Toggle label="Staking actif" name="is_active" defaultChecked={s.is_active} />
        </Card>
      ) : (
        <div className="wk-alert-bad">Section Staking : aucune ligne trouvée dans staking_config (id=1).</div>
      )}

      {w ? (
        <Card title="Roue de la fortune" hint="Spins gratuits, coût des spins payants et jackpot." updatedAt={fmtUpdated(w.updated_at)} action={updateWheelConfig}>
          <Field label="Spins gratuits / jour" name="free_spins_daily" step="1" defaultValue={w.free_spins_daily} />
          <Field label="Coût d'un spin payant" name="paid_spin_cost_amount" defaultValue={w.paid_spin_cost_amount} />
          <AssetSelect label="Devise du coût" name="paid_spin_cost_asset" defaultValue={w.paid_spin_cost_asset} assets={assets.rows} />
          <Field label="Contribution au jackpot (%)" name="jackpot_contribution_pct" defaultValue={w.jackpot_contribution_pct} hint="% du coût de chaque spin payant." />
          <AssetSelect label="Devise du jackpot" name="jackpot_asset_symbol" defaultValue={w.jackpot_asset_symbol} assets={assets.rows} />
          <Field label="Bonus de streak (spins gratuits)" name="streak_bonus_free_spins" step="1" defaultValue={w.streak_bonus_free_spins} />
          <Field label="Intervalle du bonus de streak (jours)" name="streak_bonus_interval" step="1" defaultValue={w.streak_bonus_interval} />
          <Toggle label="Roue active" name="is_active" defaultChecked={w.is_active} />
        </Card>
      ) : (
        <div className="wk-alert-bad">Section Roue de la fortune : aucune ligne trouvée dans wheel_config (id=1).</div>
      )}

      {p ? (
        <Card title="Prédictions" hint={`Mises et gains pour le jeu de prédiction sur ${p.asset_name || p.asset_symbol}.`} updatedAt={fmtUpdated(p.updated_at)} action={updatePredictionConfig}>
          <Field label="Mise fixe (WAKATI)" name="bet_amount" defaultValue={p.bet_amount} />
          <Field label="Mise min (mode libre)" name="bet_min" defaultValue={p.bet_min} />
          <Field label="Mise max (mode libre)" name="bet_max" defaultValue={p.bet_max} />
          <Field label="Multiplicateur de gain" name="win_multiplier" defaultValue={p.win_multiplier} />
          <Field label="Durée du pari (secondes)" name="duration_seconds" step="1" defaultValue={p.duration_seconds} />
          <Field label="Paris max / jour / utilisateur" name="max_bets_per_day" step="1" defaultValue={p.max_bets_per_day} />
          <Field label="Délai entre 2 paris (secondes)" name="cooldown_seconds" step="1" defaultValue={p.cooldown_seconds} />
          <Toggle label="Prédictions actives" name="is_active" defaultChecked={p.is_active} />
        </Card>
      ) : (
        <div className="wk-alert-bad">Section Prédictions : aucune ligne trouvée dans prediction_config (id=1).</div>
      )}

      {sc ? (
        <Card title="Prêts sur score de crédit" hint="Paramètres principaux des micro-prêts accordés selon le score de l'utilisateur." updatedAt={fmtUpdated(sc.updated_at)} action={updateScoreCreditConfig}>
          <Field label="Taux de conversion de base (%)" name="conversion_rate_base_pct" defaultValue={sc.conversion_rate_base_pct} />
          <Field label="Taux de conversion max (%)" name="conversion_rate_max_pct" defaultValue={sc.conversion_rate_max_pct} />
          <Field label="Frais min requis (USD, 90 j)" name="min_fees_required_usd" defaultValue={sc.min_fees_required_usd} />
          <Field label="Âge min du compte (jours)" name="min_account_age_days" step="1" defaultValue={sc.min_account_age_days} />
          <Field label="Plafond 1er prêt (USD)" name="first_loan_cap_usd" defaultValue={sc.first_loan_cap_usd} />
          <Field label="Plafond absolu (USD)" name="max_absolute_cap_usd" defaultValue={sc.max_absolute_cap_usd} />
          <Field label="Durée du prêt (jours)" name="loan_duration_days" step="1" defaultValue={sc.loan_duration_days} />
          <Field label="Délai de grâce (heures)" name="grace_period_hours" step="1" defaultValue={sc.grace_period_hours} />
          <Toggle label="Prêts sur score actifs" name="is_active" defaultChecked={sc.is_active} />
          <div className="wk-hint" style={{ gridColumn: "1/-1" }}>D'autres réglages avancés (extensions, frais cross-asset...) existent dans cette table mais ne sont pas encore éditables ici.</div>
        </Card>
      ) : (
        <div className="wk-alert-bad">Section Prêts sur score : aucune ligne trouvée dans score_credit_config (id=1).</div>
      )}

      <Section title="Pays & paiement mobile money" hint="Fournisseur principal et fournisseur de secours par pays, limites de dépôt/retrait, frais, et activation séparée dépôts/retraits.">
        {countries.rows.length === 0 ? (
          <div className="wk-alert-bad">Aucun pays trouvé dans payment_countries.</div>
        ) : (
          countries.rows.map((ct: any) => (
            <Card
              key={ct.iso_code}
              title={`${ct.name} (${ct.iso_code})`}
              hint={`Indicatif ${ct.dial_code} · téléphone à ${ct.phone_digits_min}-${ct.phone_digits_max} chiffres.`}
              updatedAt={fmtUpdated(ct.updated_at)}
              action={updatePaymentCountry}
              headerExtra={<DeleteCountryButton action={deletePaymentCountry} isoCode={ct.iso_code} label={`${ct.name} (${ct.iso_code})`} />}
            >
              <input type="hidden" name="iso_code" value={ct.iso_code} />
              <input type="hidden" name="label" value={`${ct.name} (${ct.iso_code})`} />
              <TextField label="Devise (code)" name="currency_code" defaultValue={ct.currency_code} />
              <AssetSelect label="Actif du portefeuille" name="wallet_asset_symbol" defaultValue={ct.wallet_asset_symbol || ""} assets={assets.rows} />
              <ProviderSelect label="Fournisseur principal" name="provider_code" defaultValue={ct.provider_code} providers={providers.rows} />
              <ProviderSelect label="Fournisseur de secours" name="fallback_provider_code" defaultValue={ct.fallback_provider_code || ""} providers={providers.rows} allowNone />
              <Field label="Dépôt min" name="min_deposit" defaultValue={ct.min_deposit ?? ""} hint="Vide = pas de minimum." />
              <Field label="Dépôt max" name="max_deposit" defaultValue={ct.max_deposit ?? ""} hint="Vide = illimité." />
              <Field label="Retrait min" name="min_withdraw" defaultValue={ct.min_withdraw ?? ""} hint="Vide = pas de minimum." />
              <Field label="Retrait max" name="max_withdraw" defaultValue={ct.max_withdraw ?? ""} hint="Vide = illimité." />
              <Field label="Frais de retrait (fixe)" name="withdraw_fee" defaultValue={ct.withdraw_fee} />
              <Field label="Frais de retrait (%)" name="withdraw_fee_percentage" defaultValue={ct.withdraw_fee_percentage ?? ""} hint="Vide = aucun frais en %." />
              <Toggle label="Dépôts activés" name="deposit_enabled" defaultChecked={ct.deposit_enabled} />
              <Toggle label="Retraits activés" name="withdraw_enabled" defaultChecked={ct.withdraw_enabled} />
              <Toggle label="Pays actif" name="is_active" defaultChecked={ct.is_active} />
            </Card>
          ))
        )}

        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Ajouter un pays</h3>
              <p className="wk-settings-hint">Le pays est créé désactivé par défaut — active-le une fois les réglages vérifiés.</p>
            </div>
          </div>
          <form action={addPaymentCountry}>
            <div className="wk-form-grid">
              <TextField label="Code pays (ISO 2, ex : GH)" name="iso_code" defaultValue="" />
              <TextField label="Nom" name="name" defaultValue="" />
              <TextField label="Indicatif (ex : +233)" name="dial_code" defaultValue="" />
              <TextField label="Devise (code, ex : GHS)" name="currency_code" defaultValue="" />
              <AssetSelect label="Actif du portefeuille" name="wallet_asset_symbol" defaultValue="" assets={assets.rows} />
              <ProviderSelect label="Fournisseur principal" name="provider_code" defaultValue={providers.rows.find((p: any) => p.code === "pawapay")?.code || providers.rows[0]?.code || ""} providers={providers.rows} />
              <ProviderSelect label="Fournisseur de secours" name="fallback_provider_code" defaultValue="" providers={providers.rows} allowNone />
              <Field label="Chiffres du téléphone (min)" name="phone_digits_min" step="1" defaultValue={8} />
              <Field label="Chiffres du téléphone (max)" name="phone_digits_max" step="1" defaultValue={9} />
              <Field label="Dépôt min" name="min_deposit" defaultValue="" hint="Vide = pas de minimum." />
              <Field label="Dépôt max" name="max_deposit" defaultValue="" hint="Vide = illimité." />
              <Field label="Retrait min" name="min_withdraw" defaultValue="" hint="Vide = pas de minimum." />
              <Field label="Retrait max" name="max_withdraw" defaultValue="" hint="Vide = illimité." />
              <Field label="Frais de retrait (fixe)" name="withdraw_fee" defaultValue={0} />
              <Field label="Frais de retrait (%)" name="withdraw_fee_percentage" defaultValue="" hint="Vide = aucun frais en %." />
              <Field label="Ordre d'affichage" name="sort_order" step="1" defaultValue={100} />
              <Toggle label="Dépôts activés" name="deposit_enabled" defaultChecked={true} />
              <Toggle label="Retraits activés" name="withdraw_enabled" defaultChecked={true} />
              <Toggle label="Pays actif" name="is_active" defaultChecked={false} />
            </div>
            <button type="submit" className="wk-submit-sm">Ajouter le pays</button>
          </form>
        </div>
      </Section>

      {c ? (
        <Card
          title="Campay — réglages techniques (secours)"
          hint="Campay n'est utilisé qu'en secours, actuellement pour le Cameroun uniquement. Ces limites s'appliquent aux environnements sandbox et production de ce fournisseur, pas aux pays directement."
          updatedAt={fmtUpdated(c.updated_at)}
          action={updateCampayConfig}
        >
          <Field label="Dépôt min (sandbox)" name="sandbox_min_deposit" defaultValue={c.sandbox_min_deposit} />
          <Field label="Dépôt max (sandbox)" name="sandbox_max_deposit" defaultValue={c.sandbox_max_deposit ?? ""} hint="Laisser vide = illimité." />
          <Field label="Dépôt min (production)" name="production_min_deposit" defaultValue={c.production_min_deposit} />
          <Field label="Dépôt max (production)" name="production_max_deposit" defaultValue={c.production_max_deposit ?? ""} hint="Laisser vide = illimité." />
        </Card>
      ) : (
        <div className="wk-alert-bad">Section Campay : aucune ligne trouvée dans campay_config (id=1).</div>
      )}

      <div className="wk-hint" style={{ marginTop: 4 }}>
        Les actifs (supported_assets, 13 lignes) auront leur propre écran de gestion, à venir.
      </div>
    </div>
  );
}
