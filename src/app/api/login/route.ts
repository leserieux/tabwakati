import { NextRequest, NextResponse } from "next/server";
import { identifyRole, createSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_MS, type Role } from "@/core/auth/auth";
import { authenticateAdmin } from "@/core/auth/admin-accounts";
import { createAdminSession } from "@/core/auth/sessions";
import { clientIp, isLoginBlocked, LOGIN_WINDOW_MS } from "@/core/auth/access";
import { getSupabaseAdmin } from "@/core/db/supabase";

export const runtime = "nodejs";

const BAD = { error: "Identifiant ou mot de passe incorrect" };

export async function POST(req: NextRequest) {
  try {
    const { password, name } = await req.json();

    if (typeof name !== "string" || name.trim().length < 2 || typeof password !== "string") {
      return NextResponse.json({ error: "Indique ton identifiant et ton mot de passe." }, { status: 400 });
    }
    const ip = clientIp(req.headers);
    const userAgent = req.headers.get("user-agent");

    // 0) Trop d'échecs récents depuis cette adresse : on refuse avant même de tester le mot de passe.
    if (ip) {
      const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
      const { count } = await getSupabaseAdmin().from("admin_audit_log").select("id", { count: "exact", head: true })
        .eq("action", "auth.login_failed").eq("ip", ip).gte("created_at", since);
      if (isLoginBlocked(count ?? 0)) {
        return NextResponse.json({ error: "Trop de tentatives depuis cette adresse. Réessaie dans 15 minutes." }, { status: 429 });
      }
    }

    let role: Role | null = null;
    let actor = name;
    let actorId: string | null = null;

    // 1) Compte nominatif (admin_users). Si l'identifiant existe, c'est le seul chemin possible.
    const acc = await authenticateAdmin(name, password, ip);
    if (acc.status === "ok") { role = acc.role; actor = acc.actor; actorId = acc.id; }
    else if (acc.status === "denied") { role = null; }
    else if (process.env.ADMIN_LEGACY_LOGIN !== "off") {
      // 2) Ancien accès par mot de passe partagé (à couper avec ADMIN_LEGACY_LOGIN=off une fois les comptes créés).
      role = identifyRole(password);
    }

    if (!role) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        await getSupabaseAdmin().from("admin_audit_log").insert({ actor: name.trim().slice(0, 40), action: "auth.login_failed", summary: "Échec de connexion", status: "error", ip: ip ?? null, user_agent: userAgent });
      } catch { /* le journal ne bloque jamais la connexion */ }
      return NextResponse.json(BAD, { status: 401 });
    }

    // Session en base : c'est elle qui rend le jeton révocable. Sans elle on n'émet PAS de jeton (jamais de session irrévocable par accident).
    const sid = await createAdminSession({ actor, adminUserId: actorId, role, ip, userAgent });
    if (!sid) return NextResponse.json({ error: "Impossible d'ouvrir la session pour le moment. Réessaie." }, { status: 503 });

    try {
      await getSupabaseAdmin().from("admin_audit_log").insert({ actor, actor_id: actorId, actor_role: role, action: "auth.login", summary: actorId ? "Connexion (compte nominatif)" : "Connexion (accès partagé)", status: "success", ip: ip ?? null, user_agent: userAgent });
    } catch { /* idem */ }

    const token = createSessionToken(actor, role, sid);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    return res;
  } catch (e) {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
