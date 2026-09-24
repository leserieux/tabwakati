import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/data";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { txStatusLabel, txTypeLabel } from "@/lib/transactions";

export const runtime = "nodejs";
const MAX_ROWS = 5000;

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const asset = req.nextUrl.searchParams.get("asset") || undefined;
  const db = getSupabaseAdmin();
  let query = db
    .from("transactions")
    .select("id, type, asset_symbol, amount, fee, status, network, tx_hash, created_at")
    .eq("user_id", params.id)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (asset) query = query.eq("asset_symbol", asset);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = ["date_utc", "id", "type", "actif", "montant", "frais", "statut", "reseau", "tx_hash"];
  const lines = [header.join(",")];
  for (const row of (data || []) as any[]) {
    lines.push([
      row.created_at,
      row.id,
      txTypeLabel(row.type),
      row.asset_symbol,
      row.amount,
      row.fee ?? "",
      txStatusLabel(row.status),
      row.network ?? "",
      row.tx_hash ?? ""
    ].map(csvEscape).join(","));
  }

  const suffix = asset ? `_${asset.toLowerCase()}` : "";
  return new NextResponse("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="user_${params.id}${suffix}_transactions.csv"`
    }
  });
}
