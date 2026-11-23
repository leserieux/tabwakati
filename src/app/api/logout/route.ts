import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionActor, getSessionSid } from "@/core/auth/auth";
import { revokeSession } from "@/core/auth/sessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const sid = getSessionSid(token); // null si le jeton est invalide : on ne révoque jamais sur un faux cookie
  if (sid) {
    try { await revokeSession(sid, getSessionActor(token) ?? "admin", "Déconnexion"); } catch { /* le cookie est purgé quoi qu'il arrive */ }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
