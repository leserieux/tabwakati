import { NextRequest, NextResponse } from "next/server";

// Note: la vérification cryptographique complète (HMAC) se fait dans les
// pages/API routes elles-mêmes (Node runtime). Ici, en Edge runtime, on
// vérifie juste la présence du cookie pour rediriger rapidement ; la
// validation forte a lieu dans lib/auth.ts côté serveur Node.
export function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has("wakati_admin_session");

  if (req.nextUrl.pathname.startsWith("/dashboard") && !hasCookie) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"]
};
