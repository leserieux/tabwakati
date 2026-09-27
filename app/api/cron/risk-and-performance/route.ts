import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/data";

// Route déclenchée automatiquement par Vercel Cron (voir vercel.json).
// Vercel envoie `Authorization: Bearer <CRON_SECRET>` automatiquement quand la
// variable d'environnement CRON_SECRET est définie sur le projet — il suffit de
// l'ajouter dans Vercel (Settings > Environment Variables), rien d'autre à configurer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // On recalcule hier (journée complète) ET aujourd'hui (journée en cours, sera
  // recalculée demain une dernière fois) : la fonction est idempotente (ON CONFLICT).
  const perfYesterday = await db.rpc("compute_user_performance_daily", { p_date: yesterday });
  const perfToday = await db.rpc("compute_user_performance_daily", { p_date: today });
  const risk = await db.rpc("compute_user_risk_scores");

  const result = {
    performance_yesterday: { date: yesterday, rows_written: perfYesterday.data, error: perfYesterday.error?.message ?? null },
    performance_today: { date: today, rows_written: perfToday.data, error: perfToday.error?.message ?? null },
    risk_scores: { users_scored: risk.data, error: risk.error?.message ?? null }
  };

  const hasError = !!(perfYesterday.error || perfToday.error || risk.error);
  return NextResponse.json({ ok: !hasError, ...result }, { status: hasError ? 500 : 200 });
}
