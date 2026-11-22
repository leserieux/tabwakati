"use client";

export function DeleteCountryButton({
  action,
  isoCode,
  label
}: {
  action: (formData: FormData) => void;
  isoCode: string;
  label: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Supprimer définitivement ${label} ? Cette action est irréversible.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="iso_code" value={isoCode} />
      <input type="hidden" name="label" value={label} />
      <button type="submit" className="wk-danger-link">Supprimer</button>
    </form>
  );
}
