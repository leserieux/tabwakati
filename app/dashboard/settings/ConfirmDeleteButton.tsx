"use client";

export function ConfirmDeleteButton({
  action,
  hiddenFields,
  confirmText,
  buttonLabel = "Supprimer"
}: {
  action: (formData: FormData) => void;
  hiddenFields: Record<string, string>;
  confirmText: string;
  buttonLabel?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmText)) {
          e.preventDefault();
        }
      }}
    >
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className="wk-danger-link">{buttonLabel}</button>
    </form>
  );
}
