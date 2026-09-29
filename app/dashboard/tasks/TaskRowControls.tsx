"use client";

export function StatusSelect({
  action,
  id,
  title,
  status
}: {
  action: (formData: FormData) => void;
  id: string;
  title: string;
  status: string;
}) {
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="title" value={title} />
      <select name="status" defaultValue={status} className="wk-input" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="todo">À faire</option>
        <option value="in_progress">En cours</option>
        <option value="done">Terminé</option>
        <option value="wontfix">Ne sera pas fait</option>
      </select>
    </form>
  );
}

export function DeleteTaskButton({ action, id, title }: { action: (formData: FormData) => void; id: string; title: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Supprimer « ${title} » ?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="title" value={title} />
      <button type="submit" className="wk-danger-link">Supprimer</button>
    </form>
  );
}
