import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/core/auth/auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
