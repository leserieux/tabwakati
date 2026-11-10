import { getSupabaseAdmin, q } from "@/lib/data";

/**
 * Trading futures (marge isolée, long / short, levier) — lecture pour le dashboard.
 * Toutes les données viennent des objets SQL `admin_futures_*` (migration 20261108_futures_admin.sql,
 * réservés au service_role). Les montants sont dans la devise du jeu (config.currency_symbol, WAKATI par défaut).
 */

export interface FuturesConfigRow {
  id: number;
  is_active: boolean;
  asset_symbol: string;
  asset_name: string;
  currency_symbol: string;
  margin_default: number;
  margin_min: number;
  margin_max: number;
  leverage_default: number;
  leverage_min: number;
  leverage_max: number;
  leverage_presets: number[];
  open_fee_pct: number;
  close_fee_pct: number;
  fee_interval_seconds: number;
  fee_rate_pct: number;
  maintenance_margin_pct: number;
  max_open_positions: number;
  tp_sl_enabled: boolean;
  /** 0 = illimité */
  max_notional_per_user: number;
  /** 0 = illimité */
  max_total_notional: number;
  updated_at: string | null;
  updated_by: string | null;
}

export interface FuturesPeriod {
  trades: number; traders: number; wins: number; liquidations: number; tp: number; sl: number; manual: number;
  volume: number; fees_open: number; fees_funding: number; fees_close: number;
  trader_net: number; house_result: number; margin_lost_liq: number;
}

export interface FuturesOpenAgg {
  positions: number; traders: number; margin: number; notional: number;
  long_notional: number; short_notional: number; long_count: number; short_count: number;
  fees_funding: number; fees_open: number; unrealized_pnl: number; near_liq: number;
  worst_liq_distance_pct: number | null; oldest_open_at: string | null;
}

export interface FuturesOverview {
  config: FuturesConfigRow;
  price: number | null;
  price_age_s: number | null;
  open: FuturesOpenAgg;
  today: FuturesPeriod; d7: FuturesPeriod; d30: FuturesPeriod; all: FuturesPeriod;
}

export interface MoneyPeriod {
  fees_open: number; fees_funding: number; fees_close: number; fees_total: number;
  trading_pnl: number; net: number; trades: number; liquidations: number; volume: number;
}
export interface FuturesMoney {
  today: MoneyPeriod; d7: MoneyPeriod; d30: MoneyPeriod; all: MoneyPeriod;
  pending: { open_positions: number; margin_locked: number; accrued_funding: number; unrealized_platform_pnl: number };
}
export interface MoneyDay { day: string; fees_open: number; fees_funding: number; fees_close: number; trading_pnl: number; net: number; trades: number; liquidations: number }

export interface FuturesHealth {
  stale_markets: string | null;
  price: number | null; price_age_s: number | null;
  cron_found: boolean; cron_active: boolean; cron_schedule: string | null;
  cron_last_run: string | null; cron_last_age_s: number | null; cron_last_status: string | null; cron_last_message: string | null;
  stale_open_positions: number;
  ledger_expected_net: number; ledger_actual_net: number; ledger_diff: number;
}

export interface OpenPositionRow {
  id: string; user_id: string; username: string | null; email: string | null; asset_symbol: string;
  side: "LONG" | "SHORT"; leverage: number; margin: number; notional: number; qty: number;
  entry_price: number; mark_price: number | null; unrealized_pnl: number | null;
  liq_price: number; tp_price: number | null; sl_price: number | null; liq_distance_pct: number | null;
  fees_open: number; fees_funding: number; fee_interval_seconds: number; fee_rate_pct: number;
  opened_at: string; last_fee_at: string; last_checked_at: string;
}

export interface ClosedPositionRow {
  id: string; user_id: string; username: string | null; asset_symbol: string; side: "LONG" | "SHORT"; leverage: number; margin: number;
  entry_price: number; exit_price: number | null; close_reason: string | null;
  realized_pnl: number | null; payout: number | null; fees_open: number; fees_funding: number; fees_close: number;
  opened_at: string; closed_at: string | null;
}

export interface DailyRow { day: string; trades: number; liquidations: number; volume_notional: number; fees: number; house_result: number; traders: number }

export interface TraderRow {
  user_id: string; username: string | null; email: string | null; trades: number; open_positions: number; wins: number;
  liquidations: number; net_pnl: number; fees_paid: number; volume_notional: number; last_trade_at: string | null;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function period(p: any): FuturesPeriod {
  return {
    trades: n(p?.trades), traders: n(p?.traders), wins: n(p?.wins), liquidations: n(p?.liquidations),
    tp: n(p?.tp), sl: n(p?.sl), manual: n(p?.manual), volume: n(p?.volume),
    fees_open: n(p?.fees_open), fees_funding: n(p?.fees_funding), fees_close: n(p?.fees_close),
    trader_net: n(p?.trader_net), house_result: n(p?.house_result), margin_lost_liq: n(p?.margin_lost_liq)
  };
}

function config(c: any): FuturesConfigRow {
  return {
    id: n(c?.id), is_active: !!c?.is_active, asset_symbol: String(c?.asset_symbol ?? "BTC"), asset_name: String(c?.asset_name ?? "Bitcoin"),
    currency_symbol: String(c?.currency_symbol ?? "WAKATI"),
    margin_default: n(c?.margin_default), margin_min: n(c?.margin_min), margin_max: n(c?.margin_max),
    leverage_default: n(c?.leverage_default), leverage_min: n(c?.leverage_min), leverage_max: n(c?.leverage_max),
    leverage_presets: Array.isArray(c?.leverage_presets) ? c.leverage_presets.map(n) : [],
    open_fee_pct: n(c?.open_fee_pct), close_fee_pct: n(c?.close_fee_pct),
    fee_interval_seconds: n(c?.fee_interval_seconds), fee_rate_pct: n(c?.fee_rate_pct),
    maintenance_margin_pct: n(c?.maintenance_margin_pct), max_open_positions: n(c?.max_open_positions), tp_sl_enabled: !!c?.tp_sl_enabled,
    max_notional_per_user: n(c?.max_notional_per_user),
    max_total_notional: n(c?.max_total_notional),
    updated_at: c?.updated_at ?? null, updated_by: c?.updated_by ?? null
  };
}

export async function loadFuturesOverview(): Promise<{ data: FuturesOverview | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_futures_summary");
    if (error) return { data: null, error: error.message };
    const d: any = data;
    const o = d?.open ?? {};
    return {
      data: {
        config: config(d?.config),
        price: d?.price == null ? null : n(d.price),
        price_age_s: d?.price_age_s == null ? null : n(d.price_age_s),
        open: {
          positions: n(o.positions), traders: n(o.traders), margin: n(o.margin), notional: n(o.notional),
          long_notional: n(o.long_notional), short_notional: n(o.short_notional), long_count: n(o.long_count), short_count: n(o.short_count),
          fees_funding: n(o.fees_funding), fees_open: n(o.fees_open), unrealized_pnl: n(o.unrealized_pnl), near_liq: n(o.near_liq),
          worst_liq_distance_pct: o.worst_liq_distance_pct == null ? null : n(o.worst_liq_distance_pct), oldest_open_at: o.oldest_open_at ?? null
        },
        today: period(d?.today), d7: period(d?.d7), d30: period(d?.d30), all: period(d?.all)
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}

export async function loadFuturesHealth(): Promise<{ data: FuturesHealth | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_futures_health");
    if (error) return { data: null, error: error.message };
    const d: any = data;
    return {
      data: {
        price: d?.price == null ? null : n(d.price), price_age_s: d?.price_age_s == null ? null : n(d.price_age_s),
        cron_found: !!d?.cron_found, cron_active: !!d?.cron_active, cron_schedule: d?.cron_schedule ?? null,
        cron_last_run: d?.cron_last_run ?? null, cron_last_age_s: d?.cron_last_age_s == null ? null : n(d.cron_last_age_s),
        cron_last_status: d?.cron_last_status ?? null, cron_last_message: d?.cron_last_message ?? null,
        stale_markets: d?.stale_markets ?? null,
        stale_open_positions: n(d?.stale_open_positions),
        ledger_expected_net: n(d?.ledger_expected_net), ledger_actual_net: n(d?.ledger_actual_net), ledger_diff: n(d?.ledger_diff)
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}

export interface LeverageBucket { bucket: string; trades: number; liquidations: number; volume: number; user_net: number }

/** Répartition par tranche de levier (positions clôturées) : fournie par admin_futures_overview. */
export async function loadByLeverage(): Promise<{ rows: LeverageBucket[]; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_futures_overview");
    if (error) return { rows: [], error: error.message };
    const arr: any[] = Array.isArray((data as any)?.by_leverage) ? (data as any).by_leverage : [];
    return { rows: arr.map((x) => ({ bucket: String(x.bucket), trades: n(x.trades), liquidations: n(x.liquidations), volume: n(x.volume), user_net: n(x.user_net) })) };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Erreur inconnue" };
  }
}

export async function loadOpenPositions(): Promise<{ rows: OpenPositionRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  const res = await q<any>(db.from("admin_futures_open_positions").select("*").order("liq_distance_pct", { ascending: true, nullsFirst: false }).limit(200));
  // La vue n'expose pas l'actif : on le récupère sur la table (id → asset_symbol).
  const assets = new Map<string, string>();
  if (res.rows.length) {
    const a = await q<any>(db.from("futures_positions").select("id, asset_symbol").in("id", res.rows.map((r) => r.id)));
    a.rows.forEach((x) => assets.set(x.id, x.asset_symbol));
  }
  return {
    rows: res.rows.map((r) => ({
      ...r, asset_symbol: assets.get(r.id) ?? "BTC",
      margin: n(r.margin), notional: n(r.notional), qty: n(r.qty), leverage: n(r.leverage),
      entry_price: n(r.entry_price), mark_price: r.mark_price == null ? null : n(r.mark_price),
      unrealized_pnl: r.unrealized_pnl == null ? null : n(r.unrealized_pnl),
      liq_price: n(r.liq_price), tp_price: r.tp_price == null ? null : n(r.tp_price), sl_price: r.sl_price == null ? null : n(r.sl_price),
      liq_distance_pct: r.liq_distance_pct == null ? null : n(r.liq_distance_pct),
      fees_open: n(r.fees_open), fees_funding: n(r.fees_funding), fee_interval_seconds: n(r.fee_interval_seconds), fee_rate_pct: n(r.fee_rate_pct)
    })),
    error: res.error
  };
}

/** Dernières positions clôturées, avec le nom d'utilisateur (futures_positions pointe vers auth.users, pas public.users). */
export async function loadRecentClosed(limit = 25): Promise<{ rows: ClosedPositionRow[]; error?: string }> {
  const db = getSupabaseAdmin();
  const res = await q<any>(
    db.from("futures_positions")
      .select("id, user_id, asset_symbol, side, leverage, margin, entry_price, exit_price, close_reason, realized_pnl, payout, fees_open, fees_funding, fees_close, opened_at, closed_at")
      .eq("status", "closed").order("closed_at", { ascending: false }).limit(limit)
  );
  const ids = Array.from(new Set(res.rows.map((r) => r.user_id)));
  const names = new Map<string, string>();
  if (ids.length) {
    const u = await q<any>(db.from("users").select("id, username").in("id", ids));
    u.rows.forEach((x) => names.set(x.id, x.username));
  }
  return {
    rows: res.rows.map((r) => ({
      ...r, username: names.get(r.user_id) ?? null,
      leverage: n(r.leverage), margin: n(r.margin), entry_price: n(r.entry_price),
      exit_price: r.exit_price == null ? null : n(r.exit_price),
      realized_pnl: r.realized_pnl == null ? null : n(r.realized_pnl), payout: r.payout == null ? null : n(r.payout),
      fees_open: n(r.fees_open), fees_funding: n(r.fees_funding), fees_close: n(r.fees_close)
    })),
    error: res.error
  };
}

export async function loadDaily(days = 14): Promise<{ rows: DailyRow[]; error?: string }> {
  const res = await q<any>(getSupabaseAdmin().from("admin_futures_daily").select("*").order("day", { ascending: false }).limit(days));
  return {
    rows: res.rows.map((r) => ({ day: String(r.day), trades: n(r.trades), liquidations: n(r.liquidations), volume_notional: n(r.volume_notional), fees: n(r.fees), house_result: n(r.house_result), traders: n(r.traders) })),
    error: res.error
  };
}

export async function loadTraders(limit = 15): Promise<{ rows: TraderRow[]; error?: string }> {
  const res = await q<any>(getSupabaseAdmin().from("admin_futures_traders").select("*").order("volume_notional", { ascending: false }).limit(limit));
  return {
    rows: res.rows.map((r) => ({
      ...r, trades: n(r.trades), open_positions: n(r.open_positions), wins: n(r.wins), liquidations: n(r.liquidations),
      net_pnl: n(r.net_pnl), fees_paid: n(r.fees_paid), volume_notional: n(r.volume_notional)
    })),
    error: res.error
  };
}

/** Positions d'un utilisateur (fiche utilisateur). */
export async function loadUserFutures(userId: string, limit = 15): Promise<{ rows: ClosedPositionRow[]; openCount: number; error?: string }> {
  const db = getSupabaseAdmin();
  const res = await q<any>(
    db.from("futures_positions")
      .select("id, user_id, asset_symbol, side, leverage, margin, entry_price, exit_price, close_reason, realized_pnl, payout, fees_open, fees_funding, fees_close, opened_at, closed_at, status")
      .eq("user_id", userId).order("opened_at", { ascending: false }).limit(limit)
  );
  return {
    rows: res.rows.map((r) => ({
      ...r, username: null, leverage: n(r.leverage), margin: n(r.margin), entry_price: n(r.entry_price),
      exit_price: r.exit_price == null ? null : n(r.exit_price),
      realized_pnl: r.realized_pnl == null ? null : n(r.realized_pnl), payout: r.payout == null ? null : n(r.payout),
      fees_open: n(r.fees_open), fees_funding: n(r.fees_funding), fees_close: n(r.fees_close)
    })),
    openCount: res.rows.filter((r) => r.status === "open").length,
    error: res.error
  };
}

export interface FuturesAlert { tone: "ok" | "warn" | "bad" | "info"; text: string }

const mp = (p: any): MoneyPeriod => ({
  fees_open: n(p?.fees_open), fees_funding: n(p?.fees_funding), fees_close: n(p?.fees_close), fees_total: n(p?.fees_total),
  trading_pnl: n(p?.trading_pnl), net: n(p?.net), trades: n(p?.trades), liquidations: n(p?.liquidations), volume: n(p?.volume)
});

/** Chiffres d'argent du futures, point de vue de la PLATEFORME (+ = elle gagne). Ne lève jamais. */
export async function loadFuturesMoney(): Promise<{ data: FuturesMoney | null; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_futures_money");
    if (error) return { data: null, error: error.message };
    const d: any = data;
    return {
      data: {
        today: mp(d?.today), d7: mp(d?.d7), d30: mp(d?.d30), all: mp(d?.all),
        pending: {
          open_positions: n(d?.pending?.open_positions), margin_locked: n(d?.pending?.margin_locked),
          accrued_funding: n(d?.pending?.accrued_funding), unrealized_platform_pnl: n(d?.pending?.unrealized_platform_pnl)
        }
      }
    };
  } catch (e: any) {
    return { data: null, error: e?.message || "Erreur inconnue" };
  }
}

export async function loadMoneyDaily(days = 14): Promise<{ rows: MoneyDay[]; error?: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("admin_futures_money_daily", { p_days: days });
    if (error) return { rows: [], error: error.message };
    return {
      rows: ((data as any[]) ?? []).map((r) => ({
        day: String(r.day), fees_open: n(r.fees_open), fees_funding: n(r.fees_funding), fees_close: n(r.fees_close),
        trading_pnl: n(r.trading_pnl), net: n(r.net), trades: n(r.trades), liquidations: n(r.liquidations)
      }))
    };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Erreur inconnue" };
  }
}

/** Alertes de santé du moteur (page Futures + « À traiter » de l'accueil). Ne lève jamais. */
export function buildAlerts(ov: FuturesOverview | null, health: FuturesHealth | null): FuturesAlert[] {
  const out: FuturesAlert[] = [];
  if (!health) { out.push({ tone: "warn", text: "Santé du moteur futures illisible (migration 20261108_futures_admin.sql appliquée ?)." }); return out; }
  const open = ov?.open.positions ?? 0;

  if (!health.cron_found) out.push({ tone: "bad", text: "La surveillance automatique n'existe pas (tâche « futures-settle » absente) : liquidations, TP/SL et frais ne sont traités que lorsqu'un joueur ouvre l'app." });
  else if (!health.cron_active) out.push({ tone: "bad", text: "La surveillance automatique est désactivée : liquidations, TP/SL et frais ne sont plus traités en continu." });
  else if (health.cron_last_status && health.cron_last_status !== "succeeded") out.push({ tone: "bad", text: `Dernier passage de la surveillance en échec (${health.cron_last_status}) : ${health.cron_last_message || "sans détail"}.` });
  else if (health.cron_last_age_s !== null && health.cron_last_age_s > 30) out.push({ tone: "bad", text: `La surveillance n'a pas tourné depuis ${Math.round(health.cron_last_age_s)} s (prévu toutes les 5 s).` });

  if (health.price === null) out.push({ tone: open > 0 ? "bad" : "warn", text: "Aucun prix disponible pour l'actif futures : ouvertures et fermetures sont refusées." });
  else if (health.price_age_s !== null && health.price_age_s > 30) out.push({ tone: open > 0 ? "bad" : "warn", text: `Prix en retard : ${health.stale_markets ?? `${Math.round(health.price_age_s)} s`} (limite d'ouverture/fermeture : 15 s). Vérifiez le relevé des prix.` });

  if (open > 0 && health.stale_open_positions > 0) out.push({ tone: "warn", text: `${health.stale_open_positions} position(s) ouverte(s) non contrôlée(s) depuis plus de 60 s.` });
  if (Math.abs(health.ledger_diff) > 0.01) out.push({ tone: "bad", text: `Écart de rapprochement : le ledger des transactions et les positions diffèrent de ${health.ledger_diff.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}.` });

  if (ov) {
    const c = ov.config;
    if (!c.is_active) out.push({ tone: "info", text: "Trading désactivé : aucune nouvelle position ne peut être ouverte (les positions ouvertes restent surveillées et fermables)." });
    if (ov.open.near_liq > 0) out.push({ tone: "info", text: `${ov.open.near_liq} position(s) à moins de 3 % de la liquidation.` });
    const gross = ov.open.long_notional + ov.open.short_notional;
    if (gross > 0) {
      const share = Math.max(ov.open.long_notional, ov.open.short_notional) / gross;
      if (gross >= 1000 && share >= 0.9) out.push({ tone: "warn", text: `Exposition très déséquilibrée : ${(share * 100).toFixed(0)} % des tailles ouvertes sont du même côté (${ov.open.long_notional > ov.open.short_notional ? "long" : "short"}). La plateforme est la contrepartie.` });
    }
    if (c.max_total_notional > 0 && ov.open.notional / c.max_total_notional >= 0.9) out.push({ tone: "warn", text: `Capacité totale utilisée à ${((ov.open.notional / c.max_total_notional) * 100).toFixed(0)} % (plafond ${c.max_total_notional.toLocaleString("fr-FR")} ${c.currency_symbol}).` });
  }
  return out;
}

/** Lignes « À traiter » de l'accueil : seulement ce qui demande une action (bad / warn). */
export async function futuresTodos(): Promise<{ tone: "ok" | "warn" | "bad" | "info"; text: string; href: string }[]> {
  try {
    const [ov, health] = await Promise.all([loadFuturesOverview(), loadFuturesHealth()]);
    if (!ov.data && !health.data) return [];
    return buildAlerts(ov.data, health.data)
      .filter((a) => a.tone === "bad" || a.tone === "warn")
      .map((a) => ({ tone: a.tone, text: `Futures : ${a.text}`, href: "/dashboard/futures" }));
  } catch {
    return [];
  }
}
