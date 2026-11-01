import { getSupabaseAdmin, fetchAll, q } from "@/lib/data";
import { loadValuer } from "@/lib/pnl";

const DAY = 86_400_000;

export type Origin = "user" | "provider" | "system" | "unknown";
export const ORIGINS: Record<Origin, { label: string; tone: "ok" | "warn" | "bad" | "info"; who: string }> = {
  user: { label: "Utilisateur", tone: "info", who: "Le client : PIN non saisi, solde, numéro erroné, plafond de l'opérateur." },
  provider: { label: "Prestataire / opérateur", tone: "warn", who: "PawaPay ou l'opérateur mobile money : panne, refus sans détail, erreur non spécifiée." },
  system: { label: "Votre système", tone: "bad", who: "Votre configuration, vos validations ou vos fonctions : à corriger de votre côté." },
  unknown: { label: "Indéterminé", tone: "info", who: "Pas de code ni de motif enregistré, ou clôture automatique sans retour du prestataire." }
};

export interface CauseDef { key: string; label: string; origin: Origin; fixable: boolean; hint: string }
const C = (key: string, label: string, origin: Origin, fixable: boolean, hint: string): CauseDef => ({ key, label, origin, fixable, hint });
export const CAUSES: Record<string, CauseDef> = {
  provider_config: C("provider_config", "Configuration du prestataire", "system", true, "Opérateur/devise non activé chez PawaPay, mode démo, paramètre invalide : action requise de votre côté."),
  system_error: C("system_error", "Erreur technique chez vous", "system", true, "Timeout, exception ou erreur serveur avant/pendant l'appel au prestataire : regardez les logs de l'edge function."),
  bad_account: C("bad_account", "Numéro ou compte invalide", "user", true, "Numéro mal saisi ou n'appartenant pas à l'opérateur choisi : validez le format et l'opérateur avant l'envoi."),
  customer: C("customer", "Client : solde ou plafond", "user", false, "Solde insuffisant, plafond de l'opérateur atteint ou portefeuille bloqué."),
  abandoned: C("abandoned", "Paiement non validé par le client", "user", false, "Le client n'a pas validé sur son téléphone (PIN non saisi à temps) : rappels et instructions dans l'app."),
  provider_outage: C("provider_outage", "Panne de l'opérateur", "provider", false, "Opérateur temporairement indisponible. Vérifiez la page de statut PawaPay ; ne pas blâmer le client."),
  provider_unspecified: C("provider_unspecified", "Échec non spécifié du prestataire", "provider", false, "L'opérateur a échoué sans détail (UNSPECIFIED_FAILURE / OTHER_ERROR). Si le taux monte, ouvrez un ticket PawaPay avec les depositId."),
  refused: C("refused", "Refusé par le prestataire", "provider", false, "Rejet sans détail exploitable."),
  stale: C("stale", "Clôturé sans retour du prestataire", "unknown", false, "Votre job a fermé la demande faute de callback. Soit le client n'a rien validé, soit le webhook n'est pas arrivé : recoupez avec le statut PawaPay (check deposit status)."),
  test: C("test", "Test technique", "unknown", false, "Essai interne."),
  unknown: C("unknown", "Sans motif enregistré", "unknown", false, "Aucun code conservé : le webhook doit enregistrer failure_code à chaque échec.")
};

/** Codes d'échec PawaPay (failureCode) -> cause. Doc : docs.pawapay.io/v2/docs/failure_codes */
const CODE_MAP: Record<string, string> = {
  PAYMENT_NOT_APPROVED: "abandoned",
  INSUFFICIENT_BALANCE: "customer", PAYER_LIMIT_REACHED: "customer",
  PAYER_NOT_FOUND: "bad_account", INVALID_PHONE_NUMBER: "bad_account", INVALID_PAYER_FORMAT: "bad_account",
  PROVIDER_TEMPORARILY_UNAVAILABLE: "provider_outage", CORRESPONDENT_TEMPORARILY_UNAVAILABLE: "provider_outage",
  UNSPECIFIED_FAILURE: "provider_unspecified", OTHER_ERROR: "provider_unspecified",
  DEPOSITS_NOT_ALLOWED: "provider_config", INVALID_PROVIDER: "provider_config", INVALID_CURRENCY: "provider_config",
  INVALID_AMOUNT: "provider_config", INVALID_PARAMETER: "provider_config", DUPLICATE_METADATA_FIELD: "provider_config",
  // codes propres à votre edge function (observés en base)
  CAMPAY_DEMO_LIMIT: "provider_config", ALL_PROVIDERS_FAILED: "system_error"
};

/** Extrait code, message et opérateur (ex. ORANGE_CMR, lu dans technical_detail) quel que soit le format stocké. */
export function failureInfo(md: any): { code: string; message: string; operator: string } {
  const m = md ?? {};
  const fr = m.failure_reason ?? m.closed_reason;
  const obj = fr && typeof fr === "object" ? fr : null;
  const code = String(m.failure_code ?? m.failureCode ?? obj?.failureCode ?? obj?.failure_code ?? "").toUpperCase();
  const detail = String(m.technical_detail ?? "");
  const message = obj ? String(obj.failureMessage ?? obj.message ?? JSON.stringify(obj)) : String(fr ?? m.failure_message ?? detail);
  const operator = String(m.operator ?? m.correspondent ?? "") || (detail.match(/provider '([A-Z0-9_]+)'/)?.[1] ?? "");
  return { code, message, operator };
}

export function classify(reason: string, code = ""): CauseDef {
  const c = code.toUpperCase();
  if (c && CODE_MAP[c]) return CAUSES[CODE_MAP[c]];
  const r = reason.toLowerCase();
  if (!r && !c) return CAUSES.unknown;
  if (r.includes("not been configured") || r.includes("configuration de paiement") || r.includes("demo system")) return CAUSES.provider_config;
  if (r.includes("expired_no_confirmation") || r.includes("stale")) return CAUSES.stale;
  if (r.includes("user inactive") || r.includes("invalid phone") || r.includes("msisdn")) return CAUSES.bad_account;
  if (r.includes("incorrect pin") || r.includes("not approved") || r.includes("did not approve") || r.includes("timed out")) return CAUSES.abandoned;
  if (r.includes("enough funds") || r.includes("insufficient") || r.includes("locked") || r.includes("limit")) return CAUSES.customer;
  if (r.includes("unavailable") || r.includes("outage")) return CAUSES.provider_outage;
  if (r.includes("timeout") || r.includes("timed out") || r.includes("fetch failed") || r.includes("network") || r.includes("internal") || r.includes("exception") || r.includes("rpc") || /\b5\d\d\b/.test(r)) return CAUSES.system_error;
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
  origins: { origin: Origin; count: number; share: number }[];
  recentFailures: { id: string; at: string; username: string; amount: number; provider: string; operator: string; country: string; code: string; message: string; cause: CauseDef }[];
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
  const reasonOf = (t: Dep) => failureInfo(t.metadata).message;
  const causeOf = (t: Dep) => { const f = failureInfo(t.metadata); return classify(f.message, f.code); };

  const okNative = ok.map((t) => Number(t.amount));
  const medianOkNative = median(okNative);
  const fcfaPrice = valuer.prices.get("FCFA") ?? null;
  const medianOkUsd = medianOkNative !== null && fcfaPrice !== null ? medianOkNative * fcfaPrice : null;
  const depositedUsd = ok.reduce((s, t) => { const p = valuer.priceAt(t.asset_symbol, new Date(t.created_at).getTime()); return s + (p === null ? 0 : Number(t.amount) * p); }, 0);

  const causeMap = new Map<string, { def: CauseDef; count: number }>();
  for (const t of ko) { const def = causeOf(t); const c = causeMap.get(def.key) ?? { def, count: 0 }; c.count += 1; causeMap.set(def.key, c); }
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
  const recentKo = [...ko].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 25);
  const wantIds = [...new Set([...blockedIds, ...outlierTx.map((t) => t.user_id), ...recentKo.map((t) => t.user_id)])];
  const names = new Map<string, string>();
  if (wantIds.length) {
    const u = await q<any>(db.from("users").select("id, username").in("id", wantIds.slice(0, 200)));
    for (const r of u.rows) names.set(String(r.id), String(r.username || r.id).slice(0, 40));
  }
  const nameOf = (id: string) => names.get(id) ?? id.slice(0, 8);
  const blockedUsers = blockedIds.map((id) => {
    const l = (failedByUser.get(id) || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { userId: id, username: nameOf(id), attempts: l.length, lastReason: causeOf(l[0]).label, lastAt: l[0].created_at };
  }).sort((a, b) => b.attempts - a.attempts).slice(0, 15);
  const outliers = outlierTx.map((t) => ({ amount: Number(t.amount), username: nameOf(t.user_id), at: t.created_at, reason: causeOf(t).label }));

  const originMap = new Map<Origin, number>();
  for (const t of ko) { const o = causeOf(t).origin; originMap.set(o, (originMap.get(o) ?? 0) + 1); }
  const origins = (["user", "provider", "system", "unknown"] as Origin[]).map((origin) => ({ origin, count: originMap.get(origin) ?? 0, share: ko.length ? ((originMap.get(origin) ?? 0) / ko.length) * 100 : 0 }));
  const recentFailures = recentKo.map((t) => { const f = failureInfo(t.metadata); return { id: t.id, at: t.created_at, username: nameOf(t.user_id), amount: Number(t.amount), provider: String(t.metadata?.provider ?? "?"), operator: f.operator, country: String(t.metadata?.country_iso ?? "?"), code: f.code, message: f.message.slice(0, 160), cause: classify(f.message, f.code) }; });

  const avoidable = ko.filter((t) => causeOf(t).fixable).length;
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
  const sys = origins.find((o) => o.origin === "system");
  if (sys && sys.count > 0) signals.push({ tone: "bad", title: `${sys.count} échec(s) viennent de votre système (${sys.share.toFixed(0)} %)`, detail: "Configuration PawaPay ou erreur technique : corrigeable de votre côté." });
  const prov = origins.find((o) => o.origin === "provider");
  if (prov && prov.share >= 20 && prov.count >= 3) signals.push({ tone: "warn", title: `${prov.share.toFixed(0)} % des échecs viennent du prestataire / opérateur`, detail: "Pannes ou échecs non spécifiés : comparez par opérateur et contactez PawaPay avec les identifiants de dépôt." });
  const outageByOp = new Map<string, number>();
  for (const t of ko) { const f = failureInfo(t.metadata); if (classify(f.message, f.code).key === "provider_outage") outageByOp.set(f.operator || "?", (outageByOp.get(f.operator || "?") ?? 0) + 1); }
  const topOp = [...outageByOp.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topOp && topOp[1] >= 3) signals.push({ tone: "warn", title: `${topOp[0]} : ${topOp[1]} dépôt(s) échoués pour indisponibilité de l'opérateur`, detail: "PawaPay déclare cet opérateur indisponible. Consultez leur page de statut ; si la panne se répète, contactez-les avec les identifiants de dépôt." });
  const best = providers.filter((p) => p.ok + p.ko >= 5 && p.rate !== null);
  if (best.length >= 2) { const s = [...best].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)); signals.push({ tone: "info", title: `${s[0].name} réussit à ${(s[0].rate ?? 0).toFixed(0)} % contre ${(s[s.length - 1].rate ?? 0).toFixed(0)} % pour ${s[s.length - 1].name}`, detail: "Comparez les prestataires : orientez les clients vers le plus fiable ou corrigez le moins bon." }); }
  if (outliers.length) signals.push({ tone: "warn", title: `${outliers.length} tentative(s) au-dessus du plafond de ${maxDepositCfg?.toLocaleString("fr-FR")}`, detail: "Le plafond configuré n'est pas appliqué avant l'envoi au prestataire : un montant aberrant (faute de frappe) part tel quel. Ajoutez un contrôle côté serveur." });
  if (blockedUsers.length) signals.push({ tone: "info", title: `${blockedUsers.length} utilisateur(s) n'ont jamais réussi à déposer`, detail: "Ils ont essayé au moins une fois sans succès : une relance (message, aide) peut les récupérer." });

  return {
    periodDays, attempts: inPeriod.length, success: ok.length, failed: ko.length, successRate: succ,
    medianOkNative, medianOkUsd, depositedUsd, causes, providers, countries: countriesOut, months,
    origins, recentFailures, blockedUsers, outliers, maxDeposit: maxDepositCfg, avoidable, avoidableUsd, activation, signals,
    error: [txRes.error, valuer.error, countries.error, spinners.error, stakers.error, completedAny.error].filter(Boolean).join(" · ") || undefined
  };
}
