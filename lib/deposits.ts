import { getSupabaseAdmin, fetchAll, q } from "@/lib/data";
import { loadValuer } from "@/lib/pnl";

const DAY = 86_400_000;

export interface CauseDef { key: string; label: string; fixable: boolean; hint: string }
export const CAUSES: Record<string, CauseDef> = {
  provider_config: { key: "provider_config", label: "Configuration du prestataire", fixable: true, hint: "Opérateur non activé chez le prestataire, mode démo, configuration manquante : action requise de votre côté." },
  bad_account: { key: "bad_account", label: "Numéro ou compte invalide", fixable: true, hint: "Numéro trop court, compte inactif : vérifiez le numéro avant d'envoyer la demande." },
  refused: { key: "refused", label: "Refusé par le prestataire", fixable: false, hint: "Le prestataire a rejeté le paiement sans détail exploitable." },
  customer: { key: "customer", label: "Client : PIN, fonds ou portefeuille", fixable: false, hint: "Mauvais code PIN, solde insuffisant ou portefeuille bloqué." },
  abandoned: { key: "abandoned", label: "Abandonné (pas de confirmation)", fixable: false, hint: "Le client n'a pas validé le paiement sur son téléphone à temps. À améliorer par l'expérience (rappels, instructions)." },
  test: { key: "test", label: "Test technique", fixable: false, hint: "Essai interne." },
  unknown: { key: "unknown", label: "Sans motif enregistré", fixable: false, hint: "Aucune raison conservée : enregistrez systématiquement le motif d'échec." }
};

export function classify(reason: string): CauseDef {
  const r = reason.toLowerCase();
  if (!r) return CAUSES.unknown;
  if (r.includes("not been configured") || r.includes("configuration de paiement") || r.includes("demo system")) return CAUSES.provider_config;
  if (r.includes("expired_no_confirmation") || r.includes("stale")) return CAUSES.abandoned;
  if (r.includes("user inactive") || r.includes("invalid phone") || r.includes("msisdn")) return CAUSES.bad_account;
  if (r.includes("incorrect pin") || r.includes("enough funds") || r.includes("locked")) return CAUSES.customer;
  if (r.includes("refus") || r.includes("declined") || r.includes("rejected")) return CAUSES.refused;
  if (r.includes("test")) return CAUSES.test;
  return CAUSES.unknown;
}

type Dep = { id: string; user_id: string; asset_symbol: string; amount: number | string; status: string; created_at: string; metadata: any };

export interface DepositsReport {
  periodDays: number;
  attempts: number; success: number; failed: number; successRate: number | null;
  medianOkNative: number | null; medianOkUsd: number | null; depositedUsd: number;
  causes: { def: CauseDef; count: number; share: number }[];
  providers: { name: string; ok: number; ko: number; rate: number | null }[];
  countries: { name: string; ok: number; ko: number; rate: number | null }[];
  months: { key: string; ok: number; ko: number; rate: number | null }[];
  blockedUsers: { userId: string; username: string; attempts: number; lastReason: string; lastAt: string }[];
  outliers: { amount: number; username: string; at: string; reason: string }[];
  maxDeposit: number | null;
  avoidable: number; avoidableUsd: number | null;
  activation: { label: string; count: number }[];
  signals: { tone: "ok" | "warn" | "bad" | "info"; title: string; detail: string }[];
  error?: string;
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rate = (ok: number, ko: number) => (ok + ko > 0 ? (ok / (ok + ko)) * 100 : null);

export async function loadDeposits(periodDays: number, now = Date.now()): Promise<DepositsReport> {
  const db = getSupabaseAdmin();
  const since = periodDays > 0 ? now - periodDays * DAY : 0;
  const [txRes, valuer, countries, usersAll, emailOk, profileOk, spinners, stakers, completedAny] = await Promise.all([
    fetchAll<Dep>((a, b) => db.from("transactions").select("id, user_id, asset_symbol, amount, status, created_at, metadata").eq("type", "deposit").in("status", ["completed", "failed"]).order("id").range(a, b)),
    loadValuer(),
    q<any>(db.from("payment_countries").select("iso_code, max_deposit").eq("is_active", true)),
    db.from("users").select("id", { count: "exact", head: true }),
    db.from("users").select("id", { count: "exact", head: true }).eq("email_confirmed", true),
    db.from("users").select("id", { count: "exact", head: true }).eq("profile_completed", true),
    fetchAll<{ user_id: string }>((a, b) => db.from("wheel_spins").select("user_id").order("id").range(a, b)),
    fetchAll<{ user_id: string }>((a, b) => db.from("user_stakes").select("user_id").order("id").range(a, b)),
    fetchAll<{ user_id: string }>((a, b) => db.from("transactions").select("user_id").eq("type", "deposit").eq("status", "completed").order("id").range(a, b))
  ]);

  const all = txRes.rows.filter((t) => !!t.metadata?.provider); // mobile money uniquement
  const inPeriod = all.filter((t) => new Date(t.created_at).getTime() >= since);
  const ok = inPeriod.filter((t) => t.status === "completed");
  const ko = inPeriod.filter((t) => t.status === "failed");
  const reasonOf = (t: Dep) => String(t.metadata?.failure_reason ?? t.metadata?.closed_reason ?? "");

  const okNative = ok.map((t) => Number(t.amount));
  const medianOkNative = median(okNative);
  const fcfaPrice = valuer.prices.get("FCFA") ?? null;
  const medianOkUsd = medianOkNative !== null && fcfaPrice !== null ? medianOkNative * fcfaPrice : null;
  const depositedUsd = ok.reduce((s, t) => { const p = valuer.priceAt(t.asset_symbol, new Date(t.created_at).getTime()); return s + (p === null ? 0 : Number(t.amount) * p); }, 0);

  const causeMap = new Map<string, { def: CauseDef; count: number }>();
  for (const t of ko) { const def = classify(reasonOf(t)); const c = causeMap.get(def.key) ?? { def, count: 0 }; c.count += 1; causeMap.set(def.key, c); }
  const causes = [...causeMap.values()].sort((a, b) => b.count - a.count).map((c) => ({ ...c, share: ko.length ? (c.count / ko.length) * 100 : 0 }));

  const group = (key: (t: Dep) => string) => {
    const m = new Map<string, { ok: number; ko: number }>();
    for (const t of inPeriod) { const k = key(t); const g = m.get(k) ?? { ok: 0, ko: 0 }; if (t.status === "completed") g.ok++; else g.ko++; m.set(k, g); }
    return m;
  };
  const providers = [...group((t) => String(t.metadata?.provider ?? "?")).entries()].map(([name, g]) => ({ name, ...g, rate: rate(g.ok, g.ko) })).sort((a, b) => b.ok + b.ko - (a.ok + a.ko));
  const countriesOut = [...group((t) => String(t.metadata?.country_iso ?? "Non renseigné")).entries()].map(([name, g]) => ({ name, ...g, rate: rate(g.ok, g.ko) })).sort((a, b) => b.ok + b.ko - (a.ok + a.ko));
  const months = [...group((t) => t.created_at.slice(0, 7)).entries()].map(([key, g]) => ({ key, ...g, rate: rate(g.ok, g.ko) })).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 6);

  // Utilisateurs bloqués : au moins un échec mobile money et aucun dépôt réussi (tous canaux, toute la période).
  const okUsers = new Set(completedAny.rows.map((r) => r.user_id));
  const failedByUser = new Map<string, Dep[]>();
  for (const t of all.filter((x) => x.status === "failed")) { const l = failedByUser.get(t.user_id) ?? []; l.push(t); failedByUser.set(t.user_id, l); }
  const blockedIds = [...failedByUser.keys()].filter((id) => !okUsers.has(id));
  const maxDepositCfg = countries.rows.length ? Math.max(...countries.rows.map((c) => Number(c.max_deposit || 0))) : null;
  const outlierTx = ko.filter((t) => maxDepositCfg !== null && maxDepositCfg > 0 && Number(t.amount) > maxDepositCfg * 2).sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);
  const wantIds = [...new Set([...blockedIds, ...outlierTx.map((t) => t.user_id)])];
  const names = new Map<string, string>();
  if (wantIds.length) {
    const u = await q<any>(db.from("users").select("id, username").in("id", wantIds.slice(0, 200)));
    for (const r of u.rows) names.set(String(r.id), String(r.username || r.id).slice(0, 40));
  }
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  const blockedUsers = blockedIds.map((id) => {
    const l = (failedByUser.get(id) || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { userId: id, username: nameOf(id), attempts: l.length, lastReason: classify(reasonOf(l[0])).label, lastAt: l[0].created_at };
  }).sort((a, b) => b.attempts - a.attempts).slice(0, 15);
  const outliers = outlierTx.map((t) => ({ amount: Number(t.amount), username: nameOf(t.user_id), at: t.created_at, reason: classify(reasonOf(t)).label }));

  const avoidable = ko.filter((t) => classify(reasonOf(t)).fixable).length;
  const avoidableUsd = medianOkUsd === null ? null : avoidable * medianOkUsd;

  const activation = [
    { label: "Comptes créés", count: usersAll.count ?? 0 },
    { label: "Email confirmé", count: emailOk.count ?? 0 },
    { label: "Profil complété", count: profileOk.count ?? 0 },
    { label: "Au moins un dépôt réussi", count: okUsers.size },
    { label: "A joué à la roue", count: new Set(spinners.rows.map((r) => r.user_id)).size },
    { label: "A staké", count: new Set(stakers.rows.map((r) => r.user_id)).size }
  ];

  const signals: DepositsReport["signals"] = [];
  const succ = rate(ok.length, ko.length);
  if (succ !== null && inPeriod.length >= 5) signals.push({ tone: succ < 30 ? "bad" : succ < 60 ? "warn" : "ok", title: `${succ.toFixed(0)} % des tentatives de dépôt aboutissent`, detail: `${ok.length} réussies, ${ko.length} échouées sur la période.` });
  const cfg = causes.find((c) => c.def.key === "provider_config");
  if (cfg) signals.push({ tone: "bad", title: `${cfg.count} dépôt(s) refusés à cause de la configuration du prestataire`, detail: "Opérateur non activé chez le prestataire ou mode démo. C'est la cause la plus facile à supprimer : elle dépend de vous, pas du client." });
  const best = providers.filter((p) => p.ok + p.ko >= 5 && p.rate !== null);
  if (best.length >= 2) { const s = [...best].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)); signals.push({ tone: "info", title: `${s[0].name} réussit à ${(s[0].rate ?? 0).toFixed(0)} % contre ${(s[s.length - 1].rate ?? 0).toFixed(0)} % pour ${s[s.length - 1].name}`, detail: "Comparez les prestataires : orientez les clients vers le plus fiable ou corrigez le moins bon." }); }
  if (outliers.length) signals.push({ tone: "warn", title: `${outliers.length} tentative(s) au-dessus du plafond de ${maxDepositCfg?.toLocaleString("fr-FR")}`, detail: "Le plafond configuré n'est pas appliqué avant l'envoi au prestataire : un montant aberrant (faute de frappe) part tel quel. Ajoutez un contrôle côté serveur." });
  if (blockedUsers.length) signals.push({ tone: "info", title: `${blockedUsers.length} utilisateur(s) n'ont jamais réussi à déposer`, detail: "Ils ont essayé au moins une fois sans succès : une relance (message, aide) peut les récupérer." });

  return {
    periodDays, attempts: inPeriod.length, success: ok.length, failed: ko.length, successRate: succ,
    medianOkNative, medianOkUsd, depositedUsd, causes, providers, countries: countriesOut, months,
    blockedUsers, outliers, maxDeposit: maxDepositCfg, avoidable, avoidableUsd, activation, signals,
    error: [txRes.error, valuer.error, countries.error, spinners.error, stakers.error, completedAny.error].filter(Boolean).join(" · ") || undefined
  };
}
