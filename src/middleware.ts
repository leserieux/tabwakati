import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/token";
import { verifySessionEdge } from "@/core/auth/edge";

/**
 * Première barrière : tout /dashboard exige un jeton de session correctement SIGNÉ et non expiré
 * (vérifié ici avec Web Crypto, compatible Edge). Les pages et actions serveur revérifient ensuite
 * (core/auth/session.ts) : défense en profondeur. Les routes /api/* se protègent elles-mêmes (core/auth/guards.ts).
 */
export async function middleware(req: NextRequest) {
  const ok = await verifySessionEdge(req.cookies.get(SESSION_COOKIE_NAME)?.value, process.env.SESSION_SECRET);
  if (ok) return NextResponse.next();

  const res = NextResponse.redirect(new URL("/login", req.url));
  if (req.cookies.has(SESSION_COOKIE_NAME)) res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 }); // cookie invalide : on le purge
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*"]
};
