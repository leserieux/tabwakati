import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { loadSnapshots } from "@/lib/custody-policy";
import { isValidPrice } from "@/lib/valuation";

// Hors /dashboard : le middleware ne protège pas cette route, on vérifie la session ici.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Relevé mensuel de couverture : une ligne par jour et par actif (CSV, séparateur « ; », ouvrable dans Excel). */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "Paramètre month invalide (attendu : AAAA-MM)" }, { status: 400 });
  }
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // dernier jour du mois

  const { rows, error } = await loadSnapshots(from, to);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const header = [
    "Date", "Actif", "Type", "Dû aux utilisateurs", "Détenu", "Couverture (%)", "Portefeuille de retrait", "Coffre",
    "Pas encore ramassé", "Stock des swaps", "Prix (USD)", "Dû (USD)", "Détenu (USD)"
  ];
  const lines = [header.map(esc).join(";")];
  for (const r of [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.asset_symbol.localeCompare(b.asset_symbol))) {
    const priced = isValidPrice(r.price_usd);
    const cover = r.have === null ? null : r.owe > 0 ? Math.round((r.have / r.owe) * 10000) / 100 : 100;
    lines.push(
      [
        r.snapshot_date, r.asset_symbol, r.kind === "mobile" ? "argent mobile" : "crypto", r.owe, r.have, cover, r.hot, r.vault,
        r.on_users, r.swap_stock, r.price_usd, priced ? r.owe * (r.price_usd as number) : null,
        priced && r.have !== null ? r.have * (r.price_usd as number) : null
      ].map((v) => esc(v as any)).join(";")
    );
  }
  const body = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const sha = createHash("sha256").update(body).digest("hex");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="releve-couverture-${month}.csv"`,
      "X-Content-SHA256": sha,
      "Cache-Control": "no-store"
    }
  });
}
