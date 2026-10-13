import { getSupabaseAdmin, fetchAll } from "@/lib/data";
import { loadValuer } from "@/lib/pnl";

/**
 * Coût d'acquisition et rentabilité des inscrits.
 *
 * Le seul coût d'acquisition présent en base est le bonus de parrainage (WAKATI), versé au filleul et au parrain
 * (les montants ont changé avec le temps : 300 ou 500 pour le filleul, 200 ou 500 pour le parrain).
 * Les dépenses externes (publicité, influenceurs, etc.) ne sont PAS dans la base : elles ne sont pas comptées ici.
 * Chaque bonus est rattaché à l'utilisateur acquis grâce à metadata (recipient_type / referred_user_id).
 * Les anciens bonus de parrain sans referred_user_id ne peuvent pas être rattachés à un filleul précis : ils restent dans le
 * coût total et dans la ligne de leur parrain, mais pas dans le détail par mois d'inscription.
 * Valorisation du bonus : prix du jour du WAKATI quand il est connu (depuis le 2026-09-04), sinon cours actuel.
 */

export interface CostValuation { wakati: number; usdDay: number; usdNow: number; usdPeak: number | null; dayWakati: number }
const zero = (): CostValuation => ({ wakati: 0, usdDay: 0, usdNow: 0, usdPeak: 0, dayWakati: 0 });

export interface AcqCohort {
  month: string; signups: number; referred: number; referredActivated: number;
  cost: CostValuation; revenueReferredUsd: number; netUsd: number; cacUsd: number | null; ltvOverCac: number | null;
}
export interface Referrer {
  id: string; username: string; referred: number; activated: number; cost: CostValuation; revenueUsd: number; maxSameDay: number;
}
export interface AcquisitionReport {
  totalUsers: number; referredUsers: number; organicUsers: number;
  referredActivated: number; organicActivated: number;
  cost: CostValuation; unattributedBonuses: number; unattributedCost: CostValuation;
  revenueReferredUsd: number; revenueOrganicUsd: number;
  cohorts: AcqCohort[]; referrers: Referrer[];
  wakatiNow: number | null; wakatiPeak: number | null;
  errors: string[];
}

const monthOf = (iso: string) => iso.slice(0, 7) + "-01";

export async function loadAcquisition(): Promise<AcquisitionReport> {
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  const [users, bonuses, value, valuer] = await Promise.all([
    fetchAll<any>((a, b) => db.from("users").select("id, username, created_at, referred_by").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("transactions").select("id, user_id, amount, asset_symbol, created_at, metadata").eq("type", "referral_bonus").eq("status", "completed").order("id").range(a, b)),
    db.rpc("admin_user_value"),
    loadValuer()
  ]);
  for (const e of [users.error, bonuses.error, value.error?.message, valuer.error]) if (e) errors.push(e);

  const uv = new Map<string, { activated: boolean; revenue: number }>();
  for (const r of ((value.data as any[]) || [])) uv.set(String(r.user_id), { activated: !!r.activated, revenue: Number(r.revenue_usd || 0) });

  const userById = new Map<string, any>(users.rows.map((u) => [String(u.id), u]));
  const peak = valuer.wakatiPeak;

  // Coût par utilisateur acquis
  const costBy = new Map<string, CostValuation>();
  let unattributed = 0;
  const total = zero();
  const unattr = zero();
  const unattrByReferrer = new Map<string, CostValuation>();
  const add = (c: CostValuation, wakati: number, usdDay: number, usdNow: number, usdPeak: number | null, day: boolean) => {
    c.wakati += wakati; c.usdDay += usdDay; c.usdNow += usdNow; c.usdPeak = c.usdPeak === null || usdPeak === null ? null : c.usdPeak + usdPeak;
    if (day) c.dayWakati += wakati;
  };
  for (const b of bonuses.rows) {
    const md = (b.metadata ?? {}) as any;
    const acquired = md.recipient_type === "referred" ? String(b.user_id) : md.referred_user_id ? String(md.referred_user_id) : null;
    const asset = String(b.asset_symbol); const amount = Number(b.amount || 0);
    const ts = new Date(b.created_at).getTime();
    const { price, basis } = valuer.priceAtEx(asset, ts);
    const now = valuer.prices.get(asset) ?? null;
    const usdDay = price === null ? 0 : amount * price;
    const usdNow = now === null ? 0 : amount * now;
    const usdPeak = asset === "WAKATI" ? (peak === null ? null : amount * peak) : usdDay;
    if (!acquired || !userById.has(acquired)) {
      // Coût réel mais non rattachable à un filleul : gardé dans le total et chez le parrain (s'il est connu).
      unattributed++;
      add(unattr, amount, usdDay, usdNow, usdPeak, basis === "day");
      add(total, amount, usdDay, usdNow, usdPeak, basis === "day");
      if (md.recipient_type === "referrer") {
        const rc = unattrByReferrer.get(String(b.user_id)) ?? zero();
        add(rc, amount, usdDay, usdNow, usdPeak, basis === "day");
        unattrByReferrer.set(String(b.user_id), rc);
      }
      continue;
    }
    const c = costBy.get(acquired) ?? zero();
    add(c, amount, usdDay, usdNow, usdPeak, basis === "day");
    costBy.set(acquired, c);
    add(total, amount, usdDay, usdNow, usdPeak, basis === "day");
  }

  // Cohortes d'inscription
  const cohorts = new Map<string, AcqCohort>();
  const referrers = new Map<string, Referrer & { days: Map<string, number> }>();
  let referredN = 0, referredAct = 0, organicAct = 0, revRef = 0, revOrg = 0;

  for (const u of users.rows) {
    if (!u.created_at) continue;
    const id = String(u.id);
    const v = uv.get(id) ?? { activated: false, revenue: 0 };
    const key = monthOf(String(u.created_at));
    const c = cohorts.get(key) ?? { month: key, signups: 0, referred: 0, referredActivated: 0, cost: zero(), revenueReferredUsd: 0, netUsd: 0, cacUsd: null, ltvOverCac: null };
    c.signups++;
    if (u.referred_by) {
      referredN++; c.referred++;
      if (v.activated) { referredAct++; c.referredActivated++; }
      revRef += v.revenue; c.revenueReferredUsd += v.revenue;
      const cost = costBy.get(id);
      if (cost) { add(c.cost, cost.wakati, cost.usdDay, cost.usdNow, cost.usdPeak, false); c.cost.dayWakati += cost.dayWakati; }

      const rid = String(u.referred_by);
      const ru = userById.get(rid);
      const r = referrers.get(rid) ?? { id: rid, username: ru?.username ?? "inconnu", referred: 0, activated: 0, cost: zero(), revenueUsd: 0, maxSameDay: 0, days: new Map<string, number>() };
      r.referred++; if (v.activated) r.activated++;
      r.revenueUsd += v.revenue;
      if (cost) { add(r.cost, cost.wakati, cost.usdDay, cost.usdNow, cost.usdPeak, false); r.cost.dayWakati += cost.dayWakati; }
      const day = String(u.created_at).slice(0, 10);
      const n = (r.days.get(day) ?? 0) + 1; r.days.set(day, n); r.maxSameDay = Math.max(r.maxSameDay, n);
      referrers.set(rid, r);
    } else {
      if (v.activated) organicAct++;
      revOrg += v.revenue;
    }
    cohorts.set(key, c);
  }

  for (const [rid, c] of unattrByReferrer) {
    const ru = userById.get(rid);
    const r = referrers.get(rid) ?? { id: rid, username: ru?.username ?? "inconnu", referred: 0, activated: 0, cost: zero(), revenueUsd: 0, maxSameDay: 0, days: new Map<string, number>() };
    add(r.cost, c.wakati, c.usdDay, c.usdNow, c.usdPeak, false); r.cost.dayWakati += c.dayWakati;
    referrers.set(rid, r);
  }

  const cohortList = [...cohorts.values()].sort((a, b) => a.month.localeCompare(b.month)).map((c) => {
    const netUsd = c.revenueReferredUsd - c.cost.usdDay;
    return { ...c, netUsd, cacUsd: c.referred > 0 ? c.cost.usdDay / c.referred : null, ltvOverCac: c.cost.usdDay > 0 ? c.revenueReferredUsd / c.cost.usdDay : null };
  });

  return {
    totalUsers: users.rows.length, referredUsers: referredN, organicUsers: users.rows.length - referredN,
    referredActivated: referredAct, organicActivated: organicAct,
    cost: total, unattributedBonuses: unattributed, unattributedCost: unattr,
    revenueReferredUsd: revRef, revenueOrganicUsd: revOrg,
    cohorts: cohortList,
    referrers: [...referrers.values()].map(({ days, ...r }) => r).sort((a, b) => b.referred - a.referred).slice(0, 15),
    wakatiNow: valuer.wakatiNow, wakatiPeak: peak,
    errors
  };
}
