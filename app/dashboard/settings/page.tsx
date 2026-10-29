import React from "react";
import { getSupabaseAdmin, q } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { Field, TextField, AssetSelect, SelectField, RadioGroup, Toggle, SettingsCard as Card } from "@/components/settings-form";
import {
  updatePaymentCountry,
  addPaymentCountry,
  deletePaymentCountry,
  updateCampayConfig,
  updateAsset,
  addAsset
} from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string; error?: string; msg?: string } }) {
  const db = getSupabaseAdmin();
  const [campay, assets, countries, providers, assetsFull] = await Promise.all([
    q<any>(db.from("campay_config").select("*").eq("id", 1).limit(1)),
    q<{ symbol: string; name: string; is_active: boolean }>(db.from("supported_assets").select("symbol, name, is_active").order("symbol")),
    q<any>(db.from("payment_countries").select("*").order("sort_order")),
    q<{ code: string; name: string; is_active: boolean }>(db.from("payment_providers").select("code, name, is_active").order("code")),
    q<any>(db.from("supported_assets").select("*").order("symbol"))
  ]);

  const c = campay.rows[0];

  const queryErrors = [campay.error, assets.error, countries.error, providers.error, assetsFull.error].filter(Boolean).join(" · ");
  const fmtUpdated = (iso?: string) => (iso ? formatDateTime(new Date(iso)) : null);

  return (
    <div>
      <PageHeader
        title="Paramètres"
        subtitle="Réglages communs à toute la plateforme : pays et paiement mobile money, fournisseur Campay, actifs. Chaque section s'enregistre séparément."
        updatedAt={formatDateTime(new Date())}
      />

      {queryErrors && <div className="wk-alert-bad">Certains réglages n'ont pas pu être lus : {queryErrors}</div>}
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.saved} enregistré.</div>}
      {searchParams.error && (
        <div className="wk-alert-bad">
          Échec de l'enregistrement ({searchParams.error}){searchParams.msg ? ` : ${searchParams.msg}` : "."}
        </div>
      )}


      <div className="wk-callout">
        Les réglages de chaque produit ont déménagé à côté de son suivi : <a className="wk-link" href="/dashboard/credit">Prêts</a>, <a className="wk-link" href="/dashboard/wakati/staking">Staking</a>, <a className="wk-link" href="/dashboard/games">Jeux (roue, prédictions)</a> et <a className="wk-link" href="/dashboard/wakati/prix">Prix WAKATI</a>.
      </div>

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
              headerExtra={
                <ConfirmDeleteButton
                  action={deletePaymentCountry}
                  hiddenFields={{ iso_code: ct.iso_code, label: `${ct.name} (${ct.iso_code})` }}
                  confirmText={`Supprimer définitivement ${ct.name} (${ct.iso_code}) ? Cette action est irréversible.`}
                />
              }
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

      <Section title="Actifs" hint="Devises et cryptos supportées par la plateforme. Pas de suppression possible : un actif est référencé par les transactions, soldes et historiques existants — on le désactive au lieu de le supprimer.">
        {assetsFull.rows.length === 0 ? (
          <div className="wk-alert-bad">Aucun actif trouvé dans supported_assets.</div>
        ) : (
          assetsFull.rows.map((a: any) => (
            <Card
              key={a.symbol}
              title={`${a.name} (${a.symbol})`}
              hint={`Réseau ${a.network}${a.is_native ? " · natif" : ""} — ${a.decimals} décimales. Champs techniques (adresse de contrat, décimales, réseau) non éditables ici pour éviter de casser des soldes déjà en circulation.`}
              action={updateAsset}
            >
              <input type="hidden" name="symbol" value={a.symbol} />
              <input type="hidden" name="label" value={`${a.name} (${a.symbol})`} />
              <TextField label="Nom" name="name" defaultValue={a.name} />
              <Toggle label="Actif (global)" name="is_active" defaultChecked={a.is_active} />
              <Toggle label="Dépôts activés" name="can_be_deposited" defaultChecked={a.can_be_deposited} />
              <Toggle label="Retraits activés" name="can_be_withdrawn" defaultChecked={a.can_be_withdrawn} />
              <Toggle label="Échange (swap) activé" name="can_be_swapped" defaultChecked={a.can_be_swapped} />
              <Toggle label="Transfert P2P activé" name="can_be_p2p" defaultChecked={a.can_be_p2p} />
              <Field label="Dépôt min" name="min_deposit" defaultValue={a.min_deposit ?? ""} hint="Vide = pas de minimum." />
              <Field label="Dépôt max" name="max_deposit" defaultValue={a.max_deposit ?? ""} hint="Vide = illimité." />
              <Field label="Retrait min" name="min_withdraw" defaultValue={a.min_withdraw ?? ""} hint="Vide = pas de minimum." />
              <Field label="Retrait max" name="max_withdraw" defaultValue={a.max_withdraw ?? ""} hint="Vide = illimité." />
              <Field label="Frais de retrait (fixe)" name="withdraw_fee" defaultValue={a.withdraw_fee} />
              <Field label="Frais de retrait (%)" name="withdraw_fee_percentage" defaultValue={a.withdraw_fee_percentage ?? ""} hint="Vide = pas de frais en %." />
              <Field label="Frais de transfert P2P (%)" name="transfer_fee_percentage" defaultValue={a.transfer_fee_percentage} />
              <Field label="Frais d'échange / swap (%)" name="swap_fee_percentage" defaultValue={a.swap_fee_percentage} />
              <Field label="Transfert P2P min" name="min_p2p_transfer" defaultValue={a.min_p2p_transfer ?? ""} hint="Vide = pas de minimum." />
              <Field label="Transfert P2P max" name="max_p2p_transfer" defaultValue={a.max_p2p_transfer ?? ""} hint="Vide = illimité." />
              <Field label="Seuil de sweep" name="min_sweep" defaultValue={a.min_sweep} hint="Montant minimum avant remontée vers le trésor." />
            </Card>
          ))
        )}

        <div className="wk-settings-card">
          <div className="wk-settings-head">
            <div>
              <h3 className="wk-settings-title">Ajouter un actif</h3>
              <p className="wk-settings-hint">
                Réservé aux champs techniques (réseau, décimales, contrat) qui ne se modifient qu'à la création. L'actif est créé désactivé par défaut — vérifie les réglages avant de l'activer.
              </p>
            </div>
          </div>
          <form action={addAsset}>
            <div className="wk-form-grid">
              <TextField label="Symbole (ex : SOL)" name="symbol" defaultValue="" />
              <TextField label="Nom" name="name" defaultValue="" />
              <TextField label="Réseau (ex : Solana, Fiat, BSC)" name="network" defaultValue="" />
              <TextField label="Symbole ledger (interne)" name="ledger_symbol" defaultValue="" hint="Vide = même valeur que le symbole." />
              <TextField label="Adresse de contrat" name="contract_address" defaultValue="" hint="Laisser vide pour un actif natif ou fiat." />
              <Field label="Décimales" name="decimals" step="1" defaultValue={18} />
              <Toggle label="Actif natif du réseau" name="is_native" defaultChecked={false} />
              <TextField label="ID CoinGecko" name="coingecko_id" defaultValue="" hint="Pour la récupération automatique du prix, si applicable." />
              <Toggle label="Dépôts activés" name="can_be_deposited" defaultChecked={true} />
              <Toggle label="Retraits activés" name="can_be_withdrawn" defaultChecked={true} />
              <Toggle label="Échange (swap) activé" name="can_be_swapped" defaultChecked={true} />
              <Toggle label="Transfert P2P activé" name="can_be_p2p" defaultChecked={true} />
              <Field label="Dépôt min" name="min_deposit" defaultValue="" hint="Vide = pas de minimum." />
              <Field label="Dépôt max" name="max_deposit" defaultValue="" hint="Vide = illimité." />
              <Field label="Retrait min" name="min_withdraw" defaultValue="" hint="Vide = pas de minimum." />
              <Field label="Retrait max" name="max_withdraw" defaultValue="" hint="Vide = illimité." />
              <Field label="Frais de retrait (fixe)" name="withdraw_fee" defaultValue={0} />
              <Field label="Frais de retrait (%)" name="withdraw_fee_percentage" defaultValue="" hint="Vide = pas de frais en %." />
              <Field label="Frais de transfert P2P (%)" name="transfer_fee_percentage" defaultValue={0.5} />
              <Field label="Frais d'échange / swap (%)" name="swap_fee_percentage" defaultValue={0.5} />
              <Field label="Transfert P2P min" name="min_p2p_transfer" defaultValue="" hint="Vide = pas de minimum." />
              <Field label="Transfert P2P max" name="max_p2p_transfer" defaultValue="" hint="Vide = illimité." />
              <Field label="Seuil de sweep" name="min_sweep" defaultValue={0} />
              <Toggle label="Actif (global)" name="is_active" defaultChecked={false} />
            </div>
            <button type="submit" className="wk-submit-sm">Ajouter l'actif</button>
          </form>
        </div>
      </Section>
    </div>
  );
}
