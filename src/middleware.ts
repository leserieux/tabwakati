import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/token";
import { verifySessionEdgeParsed } from "@/core/auth/edge";
import { isSessionActiveEdge } from "@/core/auth/session-check-edge";
import { hasPermission } from "@/core/auth/permissions";
import { requiredPermission } from "@/core/auth/page-access";
import { clientIp, isIpAllowed, parseAllowlist } from "@/core/auth/access";

/**
 * Barrière unique, dans cet ordre :
 *  1. restriction par IP (option ADMIN_IP_ALLOWLIST) ;
 *  2. jeton de session correctement SIGNÉ et non expiré ;
 *  3. session non révoquée (table admin_sessions) ;
 *  4. permission du rôle pour cette URL (core/auth/page-access.ts), actions serveur et routes /api comprises.
 * Les pages, actions et routes revérifient ensuite (defense en profondeur). /api/cron/* se protège par CRON_SECRET.
 */
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout"]);

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  if (path.startsWith("/api/cron/")) return NextResponse.next();

  const allowlist = parseAllowlist(process.env.ADMIN_IP_ALLOWLIST);
  if (allowlist && !isIpAllowed(clientIp(req.headers), allowlist)) {
    return isApi ? NextResponse.json({ error: "Accès refusé depuis cette adresse" }, { status: 403 }) : new NextResponse("Accès refusé depuis cette adresse.", { status: 403 });
  }

  if (PUBLIC_PATHS.has(path)) return NextResponse.next();

  const unauthenticated = () => {
    if (isApi) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const res = NextResponse.redirect(new URL("/login", req.url));
    if (req.cookies.has(SESSION_COOKIE_NAME)) res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 }); // cookie invalide ou révoqué : on le purge
    return res;
  };

  const session = await verifySessionEdgeParsed(req.cookies.get(SESSION_COOKIE_NAME)?.value, process.env.SESSION_SECRET);
  if (!session) return unauthenticated();
  if (session.sid && !(await isSessionActiveEdge(session.sid, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY))) return unauthenticated();

  if (!hasPermission(session.role, requiredPermission(path))) {
    if (isApi) return NextResponse.json({ error: "Ton rôle ne permet pas cette opération." }, { status: 403 });
    const url = new URL("/dashboard/forbidden", req.url);
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/api/:path*"]
};
