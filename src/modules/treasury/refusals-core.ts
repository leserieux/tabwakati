/**
 * Swaps refusés pour manque de liquidité (table asset_liquidity_events, un enregistrement par refus).
 *
 * Un refus = un utilisateur a voulu échanger `from_asset` contre `asset_symbol`, mais la caisse n'avait pas assez de
 * `asset_symbol` à verser. L'utilisateur n'est pas débité : c'est une vente manquée, pas une perte d'argent.
 *
 * Calcul pur (sans base de données) pour pouvoir le tester : le chargement est dans refusals.ts.
 */

export interface RefusalRow {
  id: number;
  asset_symbol: string; // actif que la caisse devait verser (celui qui manque)
  user_id: string;
  from_asset: string; // ce que l'utilisateur donnait
  from_amount: number;
  requested_amount: number; // ce que l'utilisateur voulait recevoir
  reserve_amount: number; // ce que la caisse avait à ce moment
  shortfall_amount: number; // ce qui manquait
  requested_usd: number | null;
  shortfall_usd: number | null;
  created_at: string;
}

export interface ShortageFlag {
  asset_symbol: string;
  liquidity_shortage_since: string | null;
}

export type RefusalKind = "wakati_sale" | "wakati_purchase" | "swap";

/** Vente de WAKATI (l'utilisateur donne du WAKATI), achat de WAKATI (la caisse devait verser du WAKATI) ou autre swap. */
export function refusalKind(r: Pick<RefusalRow, "asset_symbol" | "from_asset">): RefusalKind {
  if (r.from_asset === "WAKATI") return "wakati_sale";
  if (r.asset_symbol === "WAKATI") return "wakati_purchase";
  return "swap";
}

export const KIND_LABEL: Record<RefusalKind, string> = {
  wakati_sale: "Vente de WAKATI",
  wakati_purchase: "Achat de WAKATI",
  swap: "Swap"
};

export interface AssetRefusals {
  asset: string; // actif qui manque en caisse
  count: number;
  users: number;
  requestedUsd: number; // valeur des opérations refusées (ventes manquées)
  shortfallUsd: number; // plus gros manque constaté (ce qu'il aurait fallu ajouter pour tout servir)
  shortfallAmount: number; // idem, dans l'actif
  lastAt: string;
  /** Le signal « manque de liquidité » est encore levé : des opérations sont refusées maintenant. */
  active: boolean;
  since: string | null;
}

export interface RefusalsReport {
  rows: RefusalRow[]; // du plus récent au plus ancien, fenêtre `days`
  days: number;
  last24h: number;
  last7d: number;
  usd7d: number; // valeur des opérations refusées sur 7 jours
  byAsset: AssetRefusals[]; // fenêtre `days`, les plus urgents d'abord
  active: string[]; // actifs actuellement bloqués
  error?: string;
}

const DAY = 86_400_000;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function summarizeRefusals(rows: RefusalRow[], flags: ShortageFlag[], now: number, days = 30): RefusalsReport {
  const cutoff = now - days * DAY;
  const inWindow = rows
    .filter((r) => Date.parse(r.created_at) >= cutoff)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const flagBy = new Map(flags.map((f) => [f.asset_symbol, f]));

  const groups = new Map<string, AssetRefusals & { _users: Set<string> }>();
  for (const r of inWindow) {
    const g =
      groups.get(r.asset_symbol) ??
      {
        asset: r.asset_symbol, count: 0, users: 0, requestedUsd: 0, shortfallUsd: 0, shortfallAmount: 0, lastAt: "",
        active: flagBy.has(r.asset_symbol), since: flagBy.get(r.asset_symbol)?.liquidity_shortage_since ?? null,
        _users: new Set<string>()
      };
    g.count += 1;
    g._users.add(r.user_id);
    g.requestedUsd += num(r.requested_usd);
    g.shortfallUsd = Math.max(g.shortfallUsd, num(r.shortfall_usd));
    g.shortfallAmount = Math.max(g.shortfallAmount, num(r.shortfall_amount));
    if (r.created_at > g.lastAt) g.lastAt = r.created_at;
    groups.set(r.asset_symbol, g);
  }
  // Un actif encore bloqué sans refus récent dans la fenêtre reste signalé.
  for (const f of flags) {
    if (!groups.has(f.asset_symbol)) {
      groups.set(f.asset_symbol, { asset: f.asset_symbol, count: 0, users: 0, requestedUsd: 0, shortfallUsd: 0, shortfallAmount: 0, lastAt: "", active: true, since: f.liquidity_shortage_since, _users: new Set() });
    }
  }

  const byAsset: AssetRefusals[] = [...groups.values()]
    .map(({ _users, ...g }) => ({ ...g, users: _users.size }))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));

  const last24h = inWindow.filter((r) => now - Date.parse(r.created_at) <= DAY).length;
  const week = inWindow.filter((r) => now - Date.parse(r.created_at) <= 7 * DAY);
  return {
    rows: inWindow, days, last24h, last7d: week.length,
    usd7d: week.reduce((n, r) => n + num(r.requested_usd), 0),
    byAsset,
    active: flags.map((f) => f.asset_symbol).sort()
  };
}
