import { cache } from "react";
import { getSupabaseAdmin, q } from "@/lib/data";
import { getTokenBalance, getTokenTotalSupply } from "@/lib/chain";

export const EXPLORER = "https://polygonscan.com";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";

export interface Holder {
  userId: string;
  available: number;
  staking: number;
  pending: number;
  total: number;
}

export interface WakatiData {
  asset: { contract: string; network: string; decimals: number; canDeposit: boolean; canWithdraw: boolean; canSwap: boolean; minWithdraw: number | null; maxWithdraw: number | null } | null;
  price: number;
  change24h: number;
  state: { reserveUsd: number; profitSharePct: number; maxDailyChangePct: number; floorUsd: number; isActive: boolean; lastComputedAt: string | null } | null;
  history: { date: string; netProfit: number; contribution: number; reserveAfter: number; circulating: number; rawPrice: number; finalPrice: number; capped: boolean }[];
  wallet: { balance: number; collected: number; withdrawn: number; burned: number } | null;
  holders: Holder[];
  inApp: { total: number; available: number; staking: number; pending: number; holders: number };
  pool: { name: string; apr: number; minStake: number; totalStaked: number; rewardsDistributed: number; pendingRewards: number; stakers: number; isActive: boolean } | null;
  flows: { tx: { type: string; count: number; total: number }[]; fees: { type: string; count: number; total: number }[]; days: number };
  chain: { totalSupply: number | null; treasury: number | null; burned: number | null; error?: string };
  // Valeurs dérivées
  external: number | null; // tokens hors trésorerie et non brûlés (portefeuilles externes)
  freeReserve: number | null; // trésorerie on-chain moins ce qui est dû en app
  underCovered: boolean;
  circulating: number | null;
  marketCap: number | null;
  fdv: number | null;
  errors: string[];
}

/** Chargeur unique et partagé : mémorisé pour la durée d'une requête (layout + pages). */
export const loadWakati = cache(async (): Promise<WakatiData> => {
  const db = getSupabaseAdmin();
  const errors: string[] = [];

  const [assetR, priceR, stateR, historyR, walletR, balancesR, poolR, flowsR] = await Promise.all([
    q<any>(db.from("supported_assets").select("contract_address, network, decimals, can_be_deposited, can_be_withdrawn, can_be_swapped, min_withdraw, max_withdraw").eq("symbol", "WAKATI").limit(1)),
    q<any>(db.from("asset_prices").select("price_usd, change_24h").eq("asset_symbol", "WAKATI").limit(1)),
    q<any>(db.from("wakati_reserve_state").select("reserve_usd, profit_share_pct, max_daily_change_pct, price_floor_usd, is_active, last_computed_at").eq("id", 1).limit(1)),
    q<any>(db.from("wakati_price_history").select("computed_for_date, net_profit_usd, reserve_contribution_usd, reserve_usd_after, circulating_supply, raw_price_usd, final_price_usd, was_capped").order("computed_for_date", { ascending: false }).limit(30)),
    q<any>(db.from("treasury_wallets").select("balance, total_collected, total_withdrawn, total_burned").eq("asset_symbol", "WAKATI").limit(1)),
    q<any>(db.from("user_balances").select("user_id, available_balance, staking_balance, pending_balance").eq("asset_symbol", "WAKATI")),
    q<any>(db.from("admin_staking_overview").select("pool_name, apr, min_stake, total_staked, total_rewards_distributed, total_pending_rewards, active_stakers, is_active").eq("asset_symbol", "WAKATI").limit(1)),
    db.rpc("get_wakati_flows", { p_days: 30 })
  ]);
  for (const r of [assetR, priceR, stateR, historyR, walletR, balancesR, poolR]) if (r.error) errors.push(r.error);
  if (flowsR.error) errors.push(flowsR.error.message);

  const a = assetR.rows[0];
  const asset = a
    ? { contract: a.contract_address as string, network: a.network as string, decimals: Number(a.decimals || 18), canDeposit: a.can_be_deposited !== false, canWithdraw: !!a.can_be_withdrawn, canSwap: !!a.can_be_swapped, minWithdraw: a.min_withdraw !== null ? Number(a.min_withdraw) : null, maxWithdraw: a.max_withdraw !== null ? Number(a.max_withdraw) : null }
    : null;

  const s = stateR.rows[0];
  const state = s ? { reserveUsd: Number(s.reserve_usd), profitSharePct: Number(s.profit_share_pct), maxDailyChangePct: Number(s.max_daily_change_pct), floorUsd: Number(s.price_floor_usd), isActive: !!s.is_active, lastComputedAt: s.last_computed_at as string | null } : null;

  const history = historyR.rows.map((h) => ({
    date: String(h.computed_for_date),
    netProfit: Number(h.net_profit_usd),
    contribution: Number(h.reserve_contribution_usd),
    reserveAfter: Number(h.reserve_usd_after),
    circulating: Number(h.circulating_supply),
    rawPrice: Number(h.raw_price_usd),
    finalPrice: Number(h.final_price_usd),
    capped: !!h.was_capped
  }));

  const w = walletR.rows[0];
  const wallet = w ? { balance: Number(w.balance), collected: Number(w.total_collected), withdrawn: Number(w.total_withdrawn), burned: Number(w.total_burned) } : null;

  const holders: Holder[] = balancesR.rows
    .map((b) => {
      const available = Number(b.available_balance || 0);
      const staking = Number(b.staking_balance || 0);
      const pending = Number(b.pending_balance || 0);
      return { userId: b.user_id as string, available, staking, pending, total: available + staking + pending };
    })
    .filter((h) => h.total > 0)
    .sort((x, y) => y.total - x.total);

  const inApp = {
    total: holders.reduce((n, h) => n + h.total, 0),
    available: holders.reduce((n, h) => n + h.available, 0),
    staking: holders.reduce((n, h) => n + h.staking, 0),
    pending: holders.reduce((n, h) => n + h.pending, 0),
    holders: holders.length
  };

  const p = poolR.rows[0];
  const pool = p ? { name: p.pool_name as string, apr: Number(p.apr), minStake: Number(p.min_stake), totalStaked: Number(p.total_staked), rewardsDistributed: Number(p.total_rewards_distributed), pendingRewards: Number(p.total_pending_rewards), stakers: Number(p.active_stakers), isActive: !!p.is_active } : null;

  const fl: any = flowsR.data || { tx: [], fees: [], days: 30 };
  const flows = {
    days: Number(fl.days || 30),
    tx: ((fl.tx || []) as any[]).map((t) => ({ type: t.type as string, count: Number(t.count), total: Number(t.total) })),
    fees: ((fl.fees || []) as any[]).map((t) => ({ type: t.type as string, count: Number(t.count), total: Number(t.total) }))
  };

  // Lectures on-chain (offre totale, trésorerie, adresse de burn)
  const chain: WakatiData["chain"] = { totalSupply: null, treasury: null, burned: null };
  if (asset?.contract) {
    const net = asset.network.toLowerCase();
    const [ts, tr, bu] = await Promise.allSettled([
      getTokenTotalSupply(net, asset.contract, asset.decimals),
      TREASURY_EVM_ADDRESS ? getTokenBalance(net, asset.contract, TREASURY_EVM_ADDRESS, asset.decimals) : Promise.reject(new Error("TREASURY_EVM_ADDRESS non configurée")),
      getTokenBalance(net, asset.contract, DEAD, asset.decimals)
    ]);
    if (ts.status === "fulfilled") chain.totalSupply = ts.value;
    if (tr.status === "fulfilled") chain.treasury = tr.value;
    if (bu.status === "fulfilled") chain.burned = bu.value;
    const fail = [ts, tr, bu].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (fail) chain.error = String(fail.reason?.message || fail.reason);
  } else {
    chain.error = "Adresse du contrat introuvable";
  }

  const price = priceR.rows[0] ? Number(priceR.rows[0].price_usd) : 0;
  const change24h = priceR.rows[0] ? Number(priceR.rows[0].change_24h || 0) : 0;

  const { totalSupply, treasury, burned } = chain;
  const external = totalSupply !== null && treasury !== null && burned !== null ? Math.max(totalSupply - treasury - burned, 0) : null;
  const freeReserve = treasury !== null ? Math.max(treasury - inApp.total, 0) : null;
  const underCovered = treasury !== null ? treasury < inApp.total - 0.00000001 : false;
  const circulating = external !== null ? inApp.total + external : null;
  const marketCap = circulating !== null ? circulating * price : null;
  const fdv = totalSupply !== null ? (totalSupply - (burned ?? 0)) * price : null;

  return { asset, price, change24h, state, history, wallet, holders, inApp, pool, flows, chain, external, freeReserve, underCovered, circulating, marketCap, fdv, errors };
});

/** WAKATI côté plateforme uniquement (soldes des utilisateurs dans l'appli). Aucune lecture blockchain. */
export interface WakatiInApp {
  total: number;
  available: number;
  staking: number;
  pending: number;
  holders: number;
  stock: number | null; // liquidité interne de la plateforme (treasury_wallets)
  price: number;
  error?: string;
}

export const loadWakatiInApp = cache(async (): Promise<WakatiInApp> => {
  const db = getSupabaseAdmin();
  const [bal, wal, price] = await Promise.all([
    q<any>(db.from("user_balances").select("available_balance, staking_balance, pending_balance").eq("asset_symbol", "WAKATI")),
    q<any>(db.from("treasury_wallets").select("balance").eq("asset_symbol", "WAKATI").limit(1)),
    q<any>(db.from("asset_prices").select("price_usd").eq("asset_symbol", "WAKATI").limit(1))
  ]);
  let available = 0;
  let staking = 0;
  let pending = 0;
  let holders = 0;
  for (const b of bal.rows) {
    const a = Number(b.available_balance || 0);
    const s = Number(b.staking_balance || 0);
    const p = Number(b.pending_balance || 0);
    available += a;
    staking += s;
    pending += p;
    if (a + s + p > 0) holders++;
  }
  return {
    total: available + staking + pending,
    available,
    staking,
    pending,
    holders,
    stock: wal.rows[0] ? Number(wal.rows[0].balance) : null,
    price: price.rows[0] ? Number(price.rows[0].price_usd) : 0,
    error: bal.error || wal.error || price.error
  };
});
