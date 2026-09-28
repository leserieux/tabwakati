import { getSupabaseAdmin, q } from "@/lib/data";
import { formatNumber, formatDateTime, shortId } from "@/lib/format";
import { PageHeader, Section, TableWrap, Th, Td, Pill, Empty, ErrorNote, type Tone } from "@/components/ui";
import { SweepRunner } from "./SweepRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Address = {
  id: string;
  user_id: string;
  asset_symbol: string;
  network: string;
  address: string;
  cached_balance: number;
  last_balance_check: string | null;
};

type Asset = { symbol: string; network: string; min_sweep: number };

type SweepLogRow = {
  id: string;
  asset_symbol: string;
  network: string;
  from_address: string;
  to_address: string | null;
  amount: number;
  tx_hash: string | null;
  status: string;
  error_message: string | null;
  dry_run: boolean;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  would_sweep: "Aurait été balayé (aperçu)",
  swept: "Balayé",
  skipped: "Ignoré",
  error: "Erreur",
  gas_topped_up: "Gas rechargé"
};

const STATUS_TONE: Record<string, Tone> = {
  would_sweep: "info",
  swept: "ok",
  skipped: "info",
  error: "bad",
  gas_topped_up: "warn"
};

const EXPLORER: Record<string, string> = {
  Polygon: "https://polygonscan.com/tx/",
  BSC: "https://bscscan.com/tx/",
  Ethereum: "https://etherscan.io/tx/"
};

function ageLabel(iso: string | null): string {
  if (!iso) return "jamais";
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 60) return `il y a ${Math.round(mins)} min`;
  if (mins < 24 * 60) return `il y a ${Math.round(mins / 60)} h`;
  return `il y a ${Math.round(mins / 1440)} j`;
}

export default async function SweepPage() {
  const db = getSupabaseAdmin();

  const [addressesRes, assetsRes, logRes] = await Promise.all([
    q<Address>(db.from("user_addresses").select("id, user_id, asset_symbol, network, address, cached_balance, last_balance_check").eq("is_active", true).gt("cached_balance", 0)),
    q<Asset>(db.from("supported_assets").select("symbol, network, min_sweep")),
    q<SweepLogRow>(db.from("sweep_log").select("*").order("created_at", { ascending: false }).limit(100))
  ]);

  const errors = [addressesRes.error, assetsRes.error, logRes.error].filter(Boolean).join(" · ");

  const minSweepBy = new Map(assetsRes.rows.map((a) => [`${a.symbol}::${a.network}`, Number(a.min_sweep)]));
  const toSweep = addressesRes.rows
    .filter((a) => Number(a.cached_balance) >= (minSweepBy.get(`${a.asset_symbol}::${a.network}`) ?? Infinity))
    .sort((a, b) => Number(b.cached_balance) - Number(a.cached_balance));

  const realLogs = logRes.rows.filter((l) => !l.dry_run);
  const lastRealSweep = realLogs.find((l) => l.status === "swept");
  const recentErrors = realLogs.filter((l) => l.status === "error" && Date.now() - new Date(l.created_at).getTime() < 7 * 86400000);

  return (
    <div>
      <PageHeader
        title="Balayage"
        subtitle="Transfère les fonds reçus sur les adresses de dépôt des utilisateurs vers la trésorerie. Appelle directement la fonction sweep-deposits (mouvements on-chain réels)."
        updatedAt={formatDateTime(new Date())}
      />
      <ErrorNote text={errors ? `Certaines données n'ont pas pu être lues : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Adresses à balayer maintenant" value={String(toSweep.length)} sub="Solde en cache au-dessus du seuil configuré" tone={toSweep.length > 0 ? "warn" : "ok"} />
        <StatCard label="Dernier balayage réel" value={lastRealSweep ? ageLabel(lastRealSweep.created_at) : "jamais"} sub={lastRealSweep ? `${lastRealSweep.asset_symbol} · ${lastRealSweep.network}` : "Aucune transaction réelle enregistrée"} />
        <StatCard label="Erreurs (7 derniers jours)" value={String(recentErrors.length)} sub="Tentatives réelles en échec" tone={recentErrors.length > 0 ? "bad" : "ok"} />
        <StatCard label="Balayages réels au total" value={String(realLogs.filter((l) => l.status === "swept").length)} sub={`Sur ${realLogs.length} tentative(s) réelle(s) au total`} />
      </div>

      <Section
        title="Adresses à balayer maintenant"
        hint="Basé sur le solde mis en cache par le job de vérification des soldes (rafraîchi en continu), pas sur un appel on-chain en direct — donc instantané, mais peut avoir quelques minutes de retard sur la réalité. Un aperçu (dry-run) vérifie toujours le solde réel avant d'agir."
      >
        {toSweep.length === 0 ? (
          <Empty text="Aucune adresse au-dessus du seuil de balayage en ce moment." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th>Actif</Th>
                <Th>Réseau</Th>
                <Th>Adresse</Th>
                <Th right>Solde en cache</Th>
                <Th hideSm>Dernière vérification</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {toSweep.map((a) => (
                <tr key={a.id}>
                  <Td label="Utilisateur"><a className="wk-link" href={`/dashboard/users/${a.user_id}`}><span className="wk-asset-sub">{shortId(a.user_id)}</span></a></Td>
                  <Td label="Actif">{a.asset_symbol}</Td>
                  <Td label="Réseau">{a.network}</Td>
                  <Td label="Adresse"><span className="wk-asset-sub">{a.address.slice(0, 6)}…{a.address.slice(-4)}</span></Td>
                  <Td right label="Solde en cache">{formatNumber(Number(a.cached_balance))}</Td>
                  <Td hideSm label="Dernière vérification"><span className="wk-asset-sub">{ageLabel(a.last_balance_check)}</span></Td>
                  <Td label="Action"><SweepRunner userAddressId={a.id} label={`${a.asset_symbol} (${a.network})`} /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Balayage manuel" hint="Lance un aperçu (dry-run, sans risque) sur tout un réseau ou tous les réseaux, avant d'envisager un balayage réel.">
        <SweepRunner />
      </Section>

      <Section title="Historique des balayages" hint="100 dernières tentatives, aperçus (dry-run) et réels confondus.">
        {logRes.rows.length === 0 ? (
          <Empty text="Aucune tentative de balayage enregistrée." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Actif</Th>
                <Th>Réseau</Th>
                <Th right>Montant</Th>
                <Th>Statut</Th>
                <Th>Mode</Th>
                <Th>Détail</Th>
              </tr>
            </thead>
            <tbody>
              {logRes.rows.map((l) => (
                <tr key={l.id}>
                  <Td label="Date">{formatDateTime(new Date(l.created_at))}</Td>
                  <Td label="Actif">{l.asset_symbol}</Td>
                  <Td label="Réseau">{l.network}</Td>
                  <Td right label="Montant">{formatNumber(Number(l.amount))}</Td>
                  <Td label="Statut"><Pill tone={STATUS_TONE[l.status] || "info"}>{STATUS_LABEL[l.status] || l.status}</Pill></Td>
                  <Td label="Mode">{l.dry_run ? <Pill tone="info">Aperçu</Pill> : <Pill tone="warn">Réel</Pill>}</Td>
                  <Td label="Détail">
                    {l.tx_hash ? (
                      <a className="wk-link" href={`${EXPLORER[l.network] || "#"}${l.tx_hash}`} target="_blank" rel="noreferrer">{l.tx_hash.slice(0, 10)}…</a>
                    ) : (
                      <span className="wk-asset-sub">{l.error_message || "—"}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className={`wk-strip-value${tone ? ` wk-${tone}` : ""}`}>{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
