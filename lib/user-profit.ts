import { getSupabaseAdmin, fetchAll } from "@/lib/data";
import { loadValuer } from "@/lib/pnl";
import type { SignalItem } from "@/components/signals";

const DAY = 86_400_000;

export interface UserProfit {
  id: string; username: string; net: number;
  fees: number; game: number; staking: number; referral: number; defaults: number;
  deposits: number; withdrawals: number; referred: boolean; flag: string | null;
}

export interface ProfitReport {
  periodDays: number;
  users: UserProfit[];
  top: UserProfit[]; bottom: UserProfit[];
  totalNet: number; positive: number; negative: number; inactive: number;
  topShare: { n: number; pct: number } | null;
  referral: { bonusUsd: number; bonusCount: number; referredCount: number; referredNetUsd: number } | null;
  signals: SignalItem[];
  error?: string;
}

const TX = ["game_bet", "game_win", "staking_reward", "referral_bonus", "score_loan_defaulted", "deposit", "withdrawal"];

export async function loadUserProfit(periodDays: number, now = Date.now()): Promise<ProfitReport> {
  const db = getSupabaseAdmin();
  const sinceIso = new Date(periodDays > 0 ? now - periodDays * DAY : 0).toISOString();
  const [usersRes, txRes, feesRes, valuer] = await Promise.all([
    fetchAll<any>((a, b) => db.from("users").select("id, username, referred_by").order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("transactions").select("user_id, type, asset_symbol, amount, created_at").eq("status", "completed").in("type", TX).gte("created_at", sinceIso).order("id").range(a, b)),
    fetchAll<any>((a, b) => db.from("platform_fees").select("source_user_id, asset_symbol, amount, collected_at").eq("is_test", false).not("fee_type", "in", "(game_house_edge,game_net_loss)").not("source_user_id", "is", null).gte("collected_at", sinceIso).order("id").range(a, b)),
    loadValuer()
  ]);

  const map = new Map<string, UserProfit>();
  for (const u of usersRes.rows) map.set(String(u.id), { id: String(u.id), username: String(u.username || String(u.id).slice(0, 8)), net: 0, fees: 0, game: 0, staking: 0, referral: 0, defaults: 0, deposits: 0, withdrawals: 0, referred: !!u.referred_by, flag: null });

  const usd = (asset: string, amount: number, ts: number) => { const p = valuer.priceAt(asset, ts); return p === null ? 0 : amount * p; };
  for (const t of txRes.rows) {
    const u = map.get(String(t.user_id)); if (!u) continue;
    const v = usd(String(t.asset_symbol), Number(t.amount), new Date(t.created_at).getTime());
    switch (t.type) {
      case "game_bet": u.game += v; break;
      case "game_win": u.game -= v; break;
      case "staking_reward": u.staking -= v; break;
      case "referral_bonus": u.referral -= v; break;
      case "score_loan_defaulted": u.defaults -= v; break;
      case "deposit": u.deposits += v; break;
      case "withdrawal": u.withdrawals += v; break;
    }
  }
  for (const f of feesRes.rows) { const u = map.get(String(f.source_user_id)); if (u) u.fees += usd(String(f.asset_symbol), Number(f.amount), new Date(f.collected_at).getTime()); }

  const users = [...map.values()];
  for (const u of users) {
    u.net = u.fees + u.game + u.staking + u.referral + u.defaults;
    const cost = -(u.staking + u.referral + u.defaults + Math.min(u.game, 0));
    if (u.deposits === 0 && u.net < -0.0005 && cost > 0) u.flag = "Coûte sans avoir déposé";
    else if (u.game < -0.01 && u.net < 0) u.flag = "Gagne plus qu'il ne mise";
  }
  const active = users.filter((u) => Math.abs(u.net) > 0.00005 || u.deposits > 0 || u.withdrawals > 0);
  const byNetDesc = [...active].sort((a, b) => b.net - a.net);
  const positive = active.filter((u) => u.net > 0.00005).length;
  const negative = active.filter((u) => u.net < -0.00005).length;
  const totalNet = users.reduce((s, u) => s + u.net, 0);

  const pos = byNetDesc.filter((u) => u.net > 0.00005);
  const posTotal = pos.reduce((s, u) => s + u.net, 0);
  const nTop = Math.max(1, Math.ceil(pos.length * 0.1));
  const topShare = pos.length >= 5 && posTotal > 0 ? { n: nTop, pct: (pos.slice(0, nTop).reduce((s, u) => s + u.net, 0) / posTotal) * 100 } : null;

  const referredUsers = users.filter((u) => u.referred);
  const bonusUsd = -users.reduce((s, u) => s + u.referral, 0);
  const bonusCount = txRes.rows.filter((t) => t.type === "referral_bonus").length;
  const referral = bonusCount > 0 || referredUsers.length > 0 ? { bonusUsd, bonusCount, referredCount: referredUsers.length, referredNetUsd: referredUsers.reduce((s, u) => s + u.net - u.referral, 0) } : null;

  const f = (x: number) => `${x < 0 ? "-" : ""}${Math.abs(x).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const signals: SignalItem[] = [];
  if (topShare) signals.push({ tone: topShare.pct >= 70 ? "warn" : "info", title: `${topShare.n} utilisateur(s) apportent ${topShare.pct.toFixed(0)} % du revenu`, detail: `Sur ${pos.length} utilisateurs rentables. ${topShare.pct >= 70 ? "Votre revenu dépend de très peu de personnes : fidélisez-les en priorité." : "Le revenu est assez réparti."}` });
  const hunters = users.filter((u) => u.flag === "Coûte sans avoir déposé");
  if (hunters.length) signals.push({ tone: "warn", title: `${hunters.length} compte(s) ont coûté ${f(-hunters.reduce((s, u) => s + u.net, 0))} sans jamais déposer`, detail: "Bonus de parrainage, récompenses de staking ou gains de tours gratuits. À surveiller : comptes multiples ou chasseurs de bonus." });
  if (referral && referral.bonusCount > 0) {
    const worth = referral.referredNetUsd > referral.bonusUsd;
    signals.push({ tone: worth ? "ok" : "warn", title: worth ? "Le parrainage est rentable sur la période" : "Le parrainage coûte plus qu'il ne rapporte", detail: `${referral.bonusCount} bonus versés pour ${f(referral.bonusUsd)}. Les ${referral.referredCount} filleuls ont généré ${f(referral.referredNetUsd)} de résultat net (hors bonus). ${worth ? "" : "Revoyez le montant du bonus ou conditionnez-le à un premier dépôt."}` });
  }
  if (active.length > 0) signals.push({ tone: totalNet >= 0 ? "ok" : "warn", title: `${positive} utilisateur(s) rentables, ${negative} déficitaires`, detail: `Résultat net cumulé de tous les utilisateurs : ${f(totalNet)} sur la période.` });

  return {
    periodDays, users: active, top: byNetDesc.filter((u) => u.net > 0.00005).slice(0, 10), bottom: [...active].sort((a, b) => a.net - b.net).filter((u) => u.net < -0.00005).slice(0, 10),
    totalNet, positive, negative, inactive: users.length - active.length, topShare, referral, signals,
    error: [usersRes.error, txRes.error, feesRes.error, valuer.error].filter(Boolean).join(" · ") || undefined
  };
}
