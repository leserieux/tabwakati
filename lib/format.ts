export function formatNumber(n: number, max = 8): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: max });
}

export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  return (
    n.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: abs > 0 && abs < 1 ? 6 : 2
    }) + " $"
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) + " UTC";
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function formatPct(n: number, digits = 1): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " %";
}

export function formatCompactUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M$";
  if (abs >= 10_000) return (n / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " k$";
  if (abs >= 1_000) return (n / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k$";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " $";
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString("fr-FR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
}
