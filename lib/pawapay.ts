import { getSupabaseAdmin } from "@/lib/data";
import { toAlpha2 } from "@/lib/countries";

export interface PawapayWallet {
  country: string; // alpha-2
  currency: string;
  balance: number;
}

export async function fetchPawapayWallets(): Promise<{ wallets: PawapayWallet[]; error?: string }> {
  const secret = (process.env.DASHBOARD_API_SECRET || "").trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!secret || !supabaseUrl) return { wallets: [], error: "DASHBOARD_API_SECRET ou SUPABASE_URL manquant dans Vercel" };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/dashboard-pawapay-balance`, {
      headers: { "x-dashboard-secret": secret },
      cache: "no-store"
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { wallets: [], error: body.error || `PawaPay a répondu ${res.status}` };
    if (!Array.isArray(body.balances)) return { wallets: [], error: "Réponse PawaPay inattendue" };

    const wallets: PawapayWallet[] = body.balances.map((b: any) => ({
      country: toAlpha2(String(b.country || "")),
      currency: String(b.currency || ""),
      balance: Number(b.balance) || 0
    }));
    return { wallets };
  } catch (e: any) {
    return { wallets: [], error: e?.message || "Erreur réseau vers PawaPay" };
  }
}

export interface FiatCustody {
  total: number | null; // null si la lecture PawaPay a échoué
  error?: string;
  details: { label: string; value: number }[];
}

/** Solde PawaPay regroupé par actif interne (wallet_asset_symbol), ex: FCFA, CDF — mêmes chiffres que la page Solvabilité. */
export async function loadFiatCustody(): Promise<Map<string, FiatCustody>> {
  const db = getSupabaseAdmin();
  const { data: countries } = await db.from("payment_countries").select("iso_code, currency_code, wallet_asset_symbol").eq("is_active", true);
  const { wallets, error: pawapayError } = await fetchPawapayWallets();

  const byAsset = new Map<string, { iso: string; currency: string }[]>();
  for (const c of countries || []) {
    const list = byAsset.get(c.wallet_asset_symbol) || [];
    list.push({ iso: String(c.iso_code).toUpperCase(), currency: c.currency_code });
    byAsset.set(c.wallet_asset_symbol, list);
  }

  const result = new Map<string, FiatCustody>();
  for (const [asset, list] of byAsset) {
    const details = list.map((c) => ({
      label: `${c.iso} (${c.currency})`,
      value: wallets.filter((w) => w.country === c.iso).reduce((n, w) => n + w.balance, 0)
    }));
    const total = pawapayError ? null : details.reduce((n, d) => n + d.value, 0);
    result.set(asset, { total, error: pawapayError, details });
  }
  return result;
}
