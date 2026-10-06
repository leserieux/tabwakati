import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/data";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { applyTransactionFilters, applyTransactionSearch, txTypeLabel, txStatusLabel, type TxFilters } from "@/lib/transactions";

export const runtime = "nodejs";

const MAX_ROWS = 5000;

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  // Cette route n'est pas sous /dashboard : le middleware ne la protège pas, on vérifie donc la session ici.
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const filters: TxFilters = {
    q: params.get("q") || undefined,
    type: params.get("type") || undefined,
    status: params.get("status") || undefined,
    asset: params.get("asset") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined
  };

  const db = getSupabaseAdmin();
  let query = db
    .from("transactions")
    .select("id, user_id, type, asset_symbol, amount, fee, status, tx_hash, network, created_at");
  query = applyTransactionFilters(query as any, filters);
  if (filters.q) query = await applyTransactionSearch(db, query as any, filters.q);
  query = query.order("created_at", { ascending: false }).limit(MAX_ROWS) as any;

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const userIds = [...new Set(rows.map((t: any) => t.user_id).filter(Boolean))];
  const { data: users } = userIds.length
    ? await db.from("admin_users_overview").select("id, username").in("id", userIds)
    : { data: [] as any[] };
  const nameOf = new Map((users || []).map((u: any) => [u.id, u.username || ""]));

  const header = ["date_utc", "id", "utilisateur", "user_id", "type", "actif", "montant", "frais", "statut", "reseau", "tx_hash"];
  const lines = [header.join(",")];
  for (const t of rows as any[]) {
    lines.push(
      [
        t.created_at,
        t.id,
        nameOf.get(t.user_id) || "",
        t.user_id,
        txTypeLabel(t.type),
        t.asset_symbol,
        t.amount,
        t.fee ?? "",
        txStatusLabel(t.status),
        t.network ?? "",
        t.tx_hash ?? ""
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const csv = "\uFEFF" + lines.join("\n"); // BOM pour qu'Excel détecte l'UTF-8 correctement
  const filename = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
