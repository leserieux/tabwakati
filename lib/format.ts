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

/** 9 994 972 450 -> "9,99 Md", 1 250 000 -> "1,25 M", 12 300 -> "12,3 k" */
export function formatCompactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " Md";
  if (abs >= 1e6) return (n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M";
  if (abs >= 1e4) return (n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Montant de token : 2 décimales au plus (évite 191 870,83024558). */
export function formatToken(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

/** Prix d'un token : garde assez de décimales pour les très petits prix. */
export function formatPrice(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 5 : 8;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: digits }) + " $";
}

export function formatDay(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
}

export function shortAddress(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—";
}
