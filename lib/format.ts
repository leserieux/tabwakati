export function formatNumber(n: number, max = 8): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: max });
}

export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: abs > 0 && abs < 1 ? 6 : 2
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }) + " UTC";
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
