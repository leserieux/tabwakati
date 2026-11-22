import { NextRequest, NextResponse } from "next/server";
import { identifyRole, createSessionToken, SESSION_COOKIE_NAME, type Role } from "@/lib/auth";
import { authenticateAdmin } from "@/lib/admin-accounts";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const BAD = { error: "Identifiant ou mot de passe incorrect" };

export async function POST(req: NextRequest) {
  try {
    const { password, name } = await req.json();

    if (typeof name !== "string" || name.trim().length < 2 || typeof password !== "string") {
      return NextResponse.json({ error: "Indique ton identifiant et ton mot de passe." }, { status: 400 });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || undefined;

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
        await getSupabaseAdmin().from("admin_audit_log").insert({ actor: name.trim().slice(0, 40), action: "auth.login_failed", summary: "Échec de connexion", status: "error", ip: ip ?? null, user_agent: req.headers.get("user-agent") });
      } catch { /* le journal ne bloque jamais la connexion */ }
      return NextResponse.json(BAD, { status: 401 });
    }

    try {
      await getSupabaseAdmin().from("admin_audit_log").insert({ actor, actor_id: actorId, actor_role: role, action: "auth.login", summary: actorId ? "Connexion (compte nominatif)" : "Connexion (accès partagé)", status: "success", ip: ip ?? null, user_agent: req.headers.get("user-agent") });
    } catch { /* idem */ }

    const token = createSessionToken(actor, role);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
    return res;
  } catch (e) {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
