import { getSupabaseAdmin, loadPrices } from "@/lib/data";
import {
  getNativeBalance,
  getTokenBalance,
  getBtcBalance,
  getNativeBalances,
  getTokenBalances,
  getBtcBalances
} from "@/lib/chain";
import { toAlpha2 } from "@/lib/countries";
import { formatNumber, formatUsd } from "@/lib/format";
import { TableShell, Th, Td, Badge, EmptyState } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREASURY_EVM_ADDRESS = process.env.TREASURY_EVM_ADDRESS || "";
const TREASURY_BTC_ADDRESS = process.env.TREASURY_BTC_ADDRESS || "";

// Tokens gérés en interne : aucune réserve à couvrir ici
const INTERNAL_ONLY_ASSETS = new Set(["WAKATI"]);
const EPS = 0.00000001;

type Liab = { total: number; count: number };
type Status = "covered" | "short" | "sweep" | "error";

/** Une ligne = un actif : ce que j'ai, ce que je dois, le résultat. */
interface Line {
  asset: string;
  label: string; // ex. "BNB (BSC)"
  have: number | null;
  owe: number;
  note?: string; // ex. "dont 2 sur les adresses des utilisateurs"
  status: Status;
  priceUsd: number | null;
  error?: string;
  details?: { label: string; value: number }[];
}

// ─────────────────────────── Chargement des données ───────────────────────────

async function loadLiabilities(): Promise<Map<string, Liab>> {
  const { data, error } = await getSupabaseAdmin().rpc("get_asset_liabilities");
  if (error) throw new Error(`Impossible de lire ce qui est dû aux utilisateurs (${error.message})`);
  const map = new Map<string, Liab>();
  for (const l of (data as any[]) || []) {
    map.set(l.asset_symbol, { total: Number(l.total_liability), count: Number(l.user_count) });
  }
  return map;
}

function computeStatus(have: number | null, owe: number, treasuryOnly: number | null): Status {
  if (have === null) return "error";
  if (have < owe - EPS) return "short";
  if (treasuryOnly !== null && treasuryOnly < owe - EPS) return "sweep";
  return "covered";
}

async function loadCrypto(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[]; internal: Liab & { priceUsd: number | null } | null }> {
  const db = getSupabaseAdmin();
  const [{ data: assets, error: assetsError }, { data: userAddrs }] = await Promise.all([
    db.from("supported_assets").select("symbol, network, contract_address, decimals").neq("network", "Fiat").eq("is_active", true),
    db.from("user_addresses").select("asset_symbol, address").eq("is_active", true)
  ]);
  if (assetsError) throw new Error(`Impossible de lire les actifs (${assetsError.message})`);

  const treasuryLower = new Set([TREASURY_EVM_ADDRESS, TREASURY_BTC_ADDRESS].filter(Boolean).map((a) => a.toLowerCase()));
  const addrMap = new Map<string, string[]>();
  for (const a of userAddrs || []) {
    if (!a.address || treasuryLower.has(String(a.address).toLowerCase())) continue;
    const list = addrMap.get(a.asset_symbol) || [];
    if (!list.includes(a.address)) list.push(a.address);
    addrMap.set(a.asset_symbol, list);
  }

  let internal: (Liab & { priceUsd: number | null }) | null = null;
  const toRead = (assets || []).filter((a) => {
    const l = liab.get(a.symbol) || { total: 0, count: 0 };
    if (INTERNAL_ONLY_ASSETS.has(a.symbol)) {
      internal = { ...l, priceUsd: prices.get(a.symbol) ?? null };
      return false;
    }
    return !(l.total === 0 && l.count === 0);
  });

  const lines = await Promise.all(
    toRead.map(async (asset): Promise<Line> => {
      const owe = liab.get(asset.symbol)?.total ?? 0;
      const addresses = addrMap.get(asset.symbol) || [];
      const network = asset.network.toLowerCase();
      const decimals = asset.decimals || 18;

      let treasury: number | null = null;
      let users: number | null = null;
      let usersFailed = 0;
      let error: string | undefined;

      await Promise.all([
        (async () => {
          try {
            if (asset.symbol === "BTC") {
              if (!TREASURY_BTC_ADDRESS) throw new Error("TREASURY_BTC_ADDRESS non configurée");
              treasury = await getBtcBalance(TREASURY_BTC_ADDRESS);
            } else {
              if (!TREASURY_EVM_ADDRESS) throw new Error("TREASURY_EVM_ADDRESS non configurée");
              treasury = asset.contract_address
                ? await getTokenBalance(network, asset.contract_address, TREASURY_EVM_ADDRESS, decimals)
                : await getNativeBalance(network, TREASURY_EVM_ADDRESS);
            }
          } catch (e: any) {
            error = e?.message || "Erreur inconnue";
          }
        })(),
        (async () => {
          try {
            const r =
              asset.symbol === "BTC"
                ? await getBtcBalances(addresses)
                : asset.contract_address
                  ? await getTokenBalances(network, asset.contract_address, addresses, decimals)
                  : await getNativeBalances(network, addresses);
            users = r.total;
            usersFailed = r.failed;
          } catch {
            users = null;
            usersFailed = addresses.length;
          }
        })()
      ]);

      const have = treasury !== null ? treasury + (users ?? 0) : null;
      const noteParts: string[] = [];
      if ((users ?? 0) > EPS) noteParts.push(`dont ${formatNumber(users ?? 0)} encore sur les adresses des utilisateurs`);
      if (usersFailed > 0) noteParts.push(`${usersFailed} adresse(s) non lue(s)`);

      return {
        asset: asset.symbol,
        label: `${asset.symbol} (${asset.network})`,
        have,
        owe,
        note: noteParts.join(" · ") || undefined,
        status: computeStatus(have, owe, treasury),
        priceUsd: prices.get(asset.symbol) ?? null,
        error
      };
    })
  );

  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  return { lines, internal };
}

interface Wallet {
  country: string; // alpha-2
  currency: string;
  balance: number;
}

async function fetchPawapayWallets(): Promise<{ wallets: Wallet[]; error?: string }> {
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

    const wallets: Wallet[] = body.balances.map((b: any) => ({
      country: toAlpha2(String(b.country || "")),
      currency: String(b.currency || ""),
      balance: Number(b.balance) || 0
    }));
    return { wallets };
  } catch (e: any) {
    return { wallets: [], error: e?.message || "Erreur réseau vers PawaPay" };
  }
}

async function loadMobileMoney(liab: Map<string, Liab>, prices: Map<string, number>): Promise<{ lines: Line[]; error?: string }> {
  const { data: countries, error } = await getSupabaseAdmin()
    .from("payment_countries")
    .select("iso_code, currency_code, wallet_asset_symbol")
    .eq("is_active", true);
  if (error) throw new Error(`Impossible de lire les pays (${error.message})`);

  const { wallets, error: pawapayError } = await fetchPawapayWallets();

  const byAsset = new Map<string, { iso: string; currency: string }[]>();
  for (const c of countries || []) {
    const list = byAsset.get(c.wallet_asset_symbol) || [];
    list.push({ iso: String(c.iso_code).toUpperCase(), currency: c.currency_code });
    byAsset.set(c.wallet_asset_symbol, list);
  }

  const lines: Line[] = [];
  for (const [asset, list] of byAsset) {
    const owe = liab.get(asset)?.total ?? 0;
    const details = list.map((c) => ({
      label: `${c.iso} (${c.currency})`,
      value: wallets.filter((w) => w.country === c.iso).reduce((n, w) => n + w.balance, 0)
    }));
    const have = pawapayError ? null : details.reduce((n, d) => n + d.value, 0);
    lines.push({
      asset,
      label: `${asset} (PawaPay)`,
      have,
      owe,
      status: computeStatus(have, owe, null),
      priceUsd: prices.get(asset) ?? null,
      error: pawapayError,
      details
    });
  }
  lines.sort((a, b) => a.asset.localeCompare(b.asset));
  return { lines, error: pawapayError };
}

// ─────────────────────────────────── Page ───────────────────────────────────

const ok = (n: number | null) => (n === null ? "—" : formatNumber(n));

function gap(l: Line): number | null {
  return l.have === null ? null : l.have - l.owe;
}

function usd(l: Line, amount: number): string {
  return l.priceUsd !== null ? formatUsd(amount * l.priceUsd) : "";
}

export default async function SolvencyPage() {
  let crypto: Line[] = [];
  let mobile: Line[] = [];
  let internal: (Liab & { priceUsd: number | null }) | null = null;
  let loadError: string | null = null;

  const prices = await loadPrices();
  try {
    const liab = await loadLiabilities();
    const [c, m] = await Promise.all([loadCrypto(liab, prices), loadMobileMoney(liab, prices)]);
    crypto = c.lines;
    internal = c.internal;
    mobile = m.lines;
  } catch (e: any) {
    loadError = e?.message || "Erreur de chargement";
  }

  const all = [...crypto, ...mobile];
  const short = all.filter((l) => l.status === "short");
  const errors = all.filter((l) => l.status === "error");
  const toSweep = all.filter((l) => l.status === "sweep");
  const missingUsd = short.reduce((n, l) => n + (l.priceUsd !== null ? -(gap(l) ?? 0) * l.priceUsd : 0), 0);

  // Actions concrètes, en français simple
  const todo: string[] = [];
  for (const l of short) {
    const missing = -(gap(l) ?? 0);
    const u = usd(l, missing);
    todo.push(
      l.label.includes("PawaPay")
        ? `Il manque ${formatNumber(missing)} ${l.asset}${u ? ` (≈ ${u})` : ""} chez PawaPay : approvisionne le compte marchand.`
        : `Il manque ${formatNumber(missing)} ${l.asset}${u ? ` (≈ ${u})` : ""} : envoie-les sur l'adresse du treasury.`
    );
  }
  for (const l of toSweep) todo.push(`${l.asset} : les fonds sont couverts, mais une partie est encore sur les adresses des utilisateurs (lance le balayage).`);
  for (const l of errors) todo.push(`${l.label} : lecture impossible — ${l.error || "erreur inconnue"}.`);

  const banner =
    loadError || (all.length === 0 && errors.length === 0)
      ? { tone: "#7f1d1d", color: "#fecaca", title: "Impossible de calculer la solvabilité", text: loadError || "Aucune donnée." }
      : short.length > 0
        ? { tone: "#7f1d1d", color: "#fecaca", title: "Il manque de l'argent", text: missingUsd > 0 ? `Il manque environ ${formatUsd(missingUsd)} au total pour couvrir tout le monde.` : "Certains actifs ne sont pas couverts." }
        : errors.length > 0
          ? { tone: "#78350f", color: "#fde68a", title: "Certaines lectures ont échoué", text: "Le reste est couvert, mais je n'ai pas pu vérifier tous les soldes." }
          : { tone: "#14532d", color: "#bbf7d0", title: "Tout est couvert", text: "Tu détiens assez pour rembourser tous les utilisateurs." };

  return (
    <div>
      <h1 style={{ color: "#f8fafc", marginBottom: "0.25rem" }}>Ai-je assez pour rembourser tout le monde ?</h1>
      <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Chaque ligne compare l'argent réel que tu détiens à ce que tu dois aux utilisateurs. Actualisé à chaque chargement.
      </p>

      <div style={{ background: banner.tone, color: banner.color, padding: "1rem 1.25rem", borderRadius: "12px", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{banner.title}</div>
        <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>{banner.text}</div>
      </div>

      {todo.length > 0 && (
        <div style={{ background: "#1e293b", borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ color: "#f8fafc", fontWeight: 600, marginBottom: "0.5rem" }}>À faire</div>
          <ul style={{ color: "#cbd5e1", fontSize: "0.9rem", margin: 0, paddingLeft: "1.2rem", lineHeight: 1.7 }}>
            {todo.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Crypto" hint="J'ai = treasury + fonds encore sur les adresses des utilisateurs.">
        <LinesTable lines={crypto} empty="Aucune crypto due aux utilisateurs." />
      </Section>

      <Section title="Argent mobile (PawaPay)" hint="J'ai = solde de ton compte marchand PawaPay, tous pays du même actif additionnés.">
        <LinesTable lines={mobile} empty="Aucun pays actif." />
      </Section>

      {internal && (
        <Section title="Token WAKATI" hint="Géré en interne : aucune réserve à couvrir ici.">
          <div style={{ background: "#1e293b", borderRadius: "12px", padding: "1rem 1.25rem", color: "#cbd5e1", fontSize: "0.9rem" }}>
            Tu dois <strong style={{ color: "#f8fafc" }}>{formatNumber(internal.total)} WAKATI</strong> à {internal.count} utilisateur(s)
            {internal.priceUsd !== null ? ` (≈ ${formatUsd(internal.total * internal.priceUsd)}).` : "."}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "2rem" }}>
      <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: 0 }}>{title}</h2>
      {hint && <p style={{ color: "#64748b", fontSize: "0.8rem", margin: "0.2rem 0 0.75rem" }}>{hint}</p>}
      {children}
    </div>
  );
}

function StatusBadge({ s }: { s: Status }) {
  if (s === "covered") return <Badge tone="ok">Couvert</Badge>;
  if (s === "sweep") return <Badge tone="warn">À balayer</Badge>;
  if (s === "short") return <Badge tone="bad">Il manque</Badge>;
  return <Badge tone="bad">Erreur</Badge>;
}

function LinesTable({ lines, empty }: { lines: Line[]; empty: string }) {
  if (lines.length === 0) return <EmptyState text={empty} />;
  return (
    <TableShell>
      <thead>
        <tr style={{ background: "#0f172a" }}>
          <Th>Actif</Th>
          <Th align="right">J'ai</Th>
          <Th align="right">Je dois</Th>
          <Th align="right">Écart</Th>
          <Th>Résultat</Th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const g = gap(l);
          const isShort = l.status === "short";
          return (
            <tr key={l.label} style={{ borderTop: "1px solid #334155", verticalAlign: "top" }}>
              <Td>
                <strong style={{ color: "#f8fafc" }}>{l.label}</strong>
                {l.details && l.details.length > 0 && (
                  <details style={{ marginTop: "0.25rem" }}>
                    <summary style={{ color: "#64748b", fontSize: "0.75rem", cursor: "pointer" }}>détail par pays</summary>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", lineHeight: 1.6 }}>
                      {l.details.map((d) => (
                        <div key={d.label}>
                          {d.label} : {formatNumber(d.value)}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </Td>
              <Td align="right">
                {l.error ? <span style={{ color: "#f87171", fontSize: "0.8rem" }}>{l.error}</span> : ok(l.have)}
                {l.note && <div style={{ color: "#64748b", fontSize: "0.7rem" }}>{l.note}</div>}
              </Td>
              <Td align="right">{formatNumber(l.owe)}</Td>
              <Td align="right">
                {g === null ? (
                  "—"
                ) : (
                  <span style={{ color: isShort ? "#f87171" : "#4ade80" }}>
                    {g >= 0 ? "+" : ""}
                    {formatNumber(g)}
                    {usd(l, g) && <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>{g >= 0 ? "+" : ""}{usd(l, g)}</div>}
                  </span>
                )}
              </Td>
              <Td>
                <StatusBadge s={l.status} />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
