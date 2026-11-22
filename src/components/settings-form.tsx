import React from "react";

/**
 * Champs et cartes de formulaire des réglages, partagés entre la page Paramètres et les pages produit
 * (Prêts, Staking, Jeux, Prix WAKATI). `returnTo` fait revenir l'enregistrement sur la page d'origine.
 */

export function Field({ label, name, defaultValue, step = "any", hint }: { label: string; name: string; defaultValue: number | string; step?: string; hint?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step={step} defaultValue={defaultValue} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function TextField({ label, name, defaultValue, hint }: { label: string; name: string; defaultValue: string; hint?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type="text" defaultValue={defaultValue} className="wk-input" />
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function AssetSelect({ label, name, defaultValue, assets }: { label: string; name: string; defaultValue: string; assets: { symbol: string; name: string; is_active: boolean }[] }) {
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

export function SelectField({ label, name, defaultValue, options, hint }: { label: string; name: string; defaultValue: string; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <div>
      <label className="wk-label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="wk-input">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** Pour un choix à 2-3 options courtes : plus lisible en un coup d'œil qu'un menu déroulant. */
export function RadioGroup({ label, name, defaultValue, options, hint }: { label: string; name: string; defaultValue: string; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <div>
      <span className="wk-label">{label}</span>
      <div className="wk-radio-group">
        {options.map((o) => (
          <label key={o.value} className="wk-radio-option">
            <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <div className="wk-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Toggle({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="wk-field-toggle">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ width: 16, height: 16 }} />
      {label}
    </label>
  );
}

export function SettingsCard({ title, hint, updatedAt, headerExtra, action, returnTo, children }: { title: string; hint: string; updatedAt?: string | null; headerExtra?: React.ReactNode; action: (formData: FormData) => void; returnTo?: string; children: React.ReactNode }) {
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
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
        <div className="wk-form-grid">{children}</div>
        <button type="submit" className="wk-submit-sm">Enregistrer</button>
      </form>
    </div>
  );
}

/** Messages « enregistré » / « échec » affichés après une sauvegarde (query string posée par les actions). */
export function SettingsMessages({ searchParams }: { searchParams?: { saved?: string; error?: string; msg?: string } }) {
  if (!searchParams) return null;
  return (
    <>
      {searchParams.saved && <div className="wk-alert-ok">{searchParams.saved} enregistré.</div>}
      {searchParams.error && (
        <div className="wk-alert-bad">
          Échec de l'enregistrement ({searchParams.error}){searchParams.msg ? ` : ${searchParams.msg}` : "."}
        </div>
      )}
    </>
  );
}
