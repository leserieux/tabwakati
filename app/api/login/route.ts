import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    if (typeof password !== "string" || !checkPassword(password)) {
      // Léger délai pour limiter le bruteforce naïf
      await new Promise((r) => setTimeout(r, 400));
      return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
    }

    const token = createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
