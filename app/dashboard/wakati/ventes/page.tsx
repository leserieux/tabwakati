import { getSupabaseAdmin, fetchAll, loadPrices, q } from "@/lib/data";
import { loadFeesReport } from "@/lib/fees";
import { formatUsd, formatNumber, formatCompactUsd, formatToken, formatDateTime, shortId } from "@/lib/format";
import { Section, TableWrap, Th, Td, Empty, ErrorNote } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sale = {
  id: string;
  user_id: string;
  created_at: string;
  asset: string;
  base: number; // payé hors frais, dans l'actif
  fee: number; // frais, dans l'actif
  wakati: number;
  usd: number; // valeur de ce qui a été payé (hors frais)
  feeUsd: number;
  estimated: boolean; // valorisé au prix actuel (prix de l'époque non enregistré)
};

type Agg = { count: number; base: number; fee: number; usd: number; feeUsd: number; wakati: number; last: string };
const emptyAgg = (): Agg => ({ count: 0, base: 0, fee: 0, usd: 0, feeUsd: 0, wakati: 0, last: "" });
function add(a: Agg, s: Sale) {
  a.count += 1; a.base += s.base; a.fee += s.fee; a.usd += s.usd; a.feeUsd += s.feeUsd; a.wakati += s.wakati;
  if (s.created_at > a.last) a.last = s.created_at;
}

export default async function SalesPage() {
  const db = getSupabaseAdmin();
  const [salesRes, prices, treasury, fees, reserve] = await Promise.all([
    fetchAll<any>((from, to) =>
      db.from("transactions").select("id, user_id, amount, created_at, metadata").eq("type", "buy_wakati").eq("status", "completed").order("created_at", { ascending: false }).order("id").range(from, to)
    ),
    loadPrices(),
    q<any>(db.from("treasury_wallets").select("asset_symbol, balance, total_collected").order("asset_symbol")),
    loadFeesReport(),
    q<any>(db.from("wakati_reserve_state").select("reserve_usd").eq("id", 1).limit(1))
  ]);

  const unpriced = new Set<string>();
  const sales: Sale[] = salesRes.rows.map((r) => {
    const m = r.metadata || {};
    const asset = String(m.from_asset || "?");
    const base = Number(m.base_amount || 0);
    const fee = Number(m.fee_amount || 0);
    const hasUsd = m.usd_value !== undefined && m.usd_value !== null;
    const price = prices.get(asset);
    if (!hasUsd && !price) unpriced.add(asset);
    const usd = hasUsd ? Number(m.usd_value) : price ? base * price : 0;
    const feeUsd = base > 0 ? (usd * fee) / base : 0;
    return { id: r.id, user_id: r.user_id, created_at: r.created_at, asset, base, fee, wakati: Number(r.amount || 0), usd, feeUsd, estimated: !hasUsd };
  });

  const total = emptyAgg();
  const byAsset = new Map<string, Agg>();
  const byUser = new Map<string, Agg>();
  for (const s of sales) {
    add(total, s);
    add(byAsset.get(s.asset) ?? byAsset.set(s.asset, emptyAgg()).get(s.asset)!, s);
    add(byUser.get(s.user_id) ?? byUser.set(s.user_id, emptyAgg()).get(s.user_id)!, s);
  }
  const assetRows = [...byAsset.entries()].sort((a, b) => b[1].usd - a[1].usd);
  const userRows = [...byUser.entries()].sort((a, b) => b[1].usd - a[1].usd);
  const topUsers = userRows.slice(0, 20);
  const latest = sales.slice(0, 15);
  const estimatedCount = sales.filter((s) => s.estimated).length;

  // Noms des utilisateurs affichés (20 meilleurs acheteurs + 15 derniers achats)
  const ids = [...new Set([...topUsers.map(([id]) => id), ...latest.map((s) => s.user_id)])];
  const usersRes = ids.length ? await q<any>(db.from("admin_users_overview").select("id, username, email").in("id", ids)) : { rows: [] as any[] };
  const names = new Map<string, string>(usersRes.rows.map((u) => [u.id, u.username || u.email || shortId(u.id)]));
  const who = (id: string) => (
    <a className="wk-link" href={`/dashboard/users/${id}`}>
      <div>{names.get(id) ?? shortId(id)}</div>
    </a>
  );

  const reserveUsd = reserve.rows[0] ? Number(reserve.rows[0].reserve_usd) : null;
  const wakatiPrice = prices.get("WAKATI") ?? 0;
  const purchaseFees = fees.byType.find((t) => t.key === "wakati_purchase_fee");
  const errors = [salesRes.error, treasury.error, fees.error, reserve.error, usersRes.error, unpriced.size ? `sans prix valide : ${[...unpriced].join(", ")}` : null].filter(Boolean).join(" · ");

  return (
    <div>
      <ErrorNote text={errors ? `Certaines données sont incomplètes : ${errors}` : null} />

      <div className="wk-strip">
        <StatCard label="Argent encaissé (ventes)" value={formatCompactUsd(total.usd)} sub={`${total.count} achat(s), hors frais`} />
        <StatCard label="WAKATI vendus" value={formatToken(total.wakati)} sub={`≈ ${formatUsd(total.wakati * wakatiPrice)} au prix actuel`} />
        <StatCard label="Frais d'achat encaissés" value={formatUsd(purchaseFees?.usd ?? total.feeUsd)} sub="0,5 % de chaque achat" />
        <StatCard label="Acheteurs" value={String(byUser.size)} sub={total.last ? `Dernier achat : ${formatDateTime(new Date(total.last))}` : "Aucun achat"} />
      </div>
      {estimatedCount > 0 && (
        <p className="wk-hint" style={{ marginBottom: 16 }}>
          {estimatedCount} achat(s) sur {sales.length} datent d'avant l'enregistrement du prix : ils sont valorisés au prix actuel de l'actif (estimation). Les nouveaux achats gardent leur prix exact.
        </p>
      )}

      <div className="wk-callout" style={{ marginBottom: 20 }}>
        L'argent des ventes entre dans la caisse mais ne sert pas à calculer le prix WAKATI : le calcul du prix lit seulement les frais encaissés.
        {reserveUsd !== null && <> Réserve du prix actuelle : <b>{formatUsd(reserveUsd)}</b>.</>}
      </div>

      <Section
        title="Ce que la caisse détient"
        hint={`Soldes de la trésorerie par actif et frais cumulés (hors mises brutes des jeux). Frais encaissés au total : ${formatUsd(fees.totalUsd)}, dont ${formatUsd(fees.last30Usd)} sur 30 jours. Le détail par type est dans l'onglet Frais.`}
      >
        {treasury.rows.length === 0 ? (
          <Empty text="La trésorerie est vide." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif</Th>
                <Th right>Solde en caisse</Th>
                <Th right hideSm>Valeur (USD)</Th>
                <Th right>Frais cumulés</Th>
                <Th right hideSm>Total encaissé</Th>
              </tr>
            </thead>
            <tbody>
              {treasury.rows.map((t) => {
                const price = prices.get(t.asset_symbol);
                const feeNative = fees.byAsset.find((a) => a.key === t.asset_symbol)?.native ?? 0;
                return (
                  <tr key={t.asset_symbol}>
                    <Td label="Actif">{t.asset_symbol}</Td>
                    <Td right label="Solde en caisse">{formatNumber(Number(t.balance))}</Td>
                    <Td right hideSm label="Valeur (USD)">{price ? formatUsd(Number(t.balance) * price) : "—"}</Td>
                    <Td right label="Frais cumulés">{formatNumber(feeNative)}</Td>
                    <Td right hideSm label="Total encaissé">{formatNumber(Number(t.total_collected))}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Argent encaissé par actif" hint="Ce que les utilisateurs ont payé pour acheter du WAKATI, par actif.">
        {assetRows.length === 0 ? (
          <Empty text="Aucun achat de WAKATI pour l'instant." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Actif payé</Th>
                <Th right>Achats</Th>
                <Th right>Encaissé</Th>
                <Th right hideSm>Valeur (USD)</Th>
                <Th right hideSm>Frais</Th>
                <Th right>WAKATI vendus</Th>
              </tr>
            </thead>
            <tbody>
              {assetRows.map(([asset, a]) => (
                <tr key={asset}>
                  <Td label="Actif payé">{asset}</Td>
                  <Td right label="Achats">{a.count}</Td>
                  <Td right label="Encaissé">{formatNumber(a.base)}</Td>
                  <Td right hideSm label="Valeur (USD)">{formatUsd(a.usd)}</Td>
                  <Td right hideSm label="Frais">{formatNumber(a.fee)} <span className="wk-asset-sub">{asset}</span></Td>
                  <Td right label="WAKATI vendus">{formatToken(a.wakati)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Achats par utilisateur" hint={`${byUser.size} acheteur(s). Les 20 plus gros sont affichés, du plus gros au plus petit.`}>
        {topUsers.length === 0 ? (
          <Empty text="Aucun acheteur pour l'instant." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th right>Achats</Th>
                <Th right>Payé (USD)</Th>
                <Th right>WAKATI reçus</Th>
                <Th right hideSm>Frais (USD)</Th>
                <Th right hideSm>Dernier achat</Th>
              </tr>
            </thead>
            <tbody>
              {topUsers.map(([id, a]) => (
                <tr key={id}>
                  <Td label="Utilisateur">{who(id)}</Td>
                  <Td right label="Achats">{a.count}</Td>
                  <Td right label="Payé (USD)">{formatUsd(a.usd)}</Td>
                  <Td right label="WAKATI reçus">{formatToken(a.wakati)}</Td>
                  <Td right hideSm label="Frais (USD)">{formatUsd(a.feeUsd)}</Td>
                  <Td right hideSm label="Dernier achat">{formatDateTime(new Date(a.last))}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="Derniers achats">
        {latest.length === 0 ? (
          <Empty text="Aucun achat." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Utilisateur</Th>
                <Th right>Payé</Th>
                <Th right hideSm>Frais</Th>
                <Th right>WAKATI reçus</Th>
              </tr>
            </thead>
            <tbody>
              {latest.map((s) => (
                <tr key={s.id}>
                  <Td label="Date">{formatDateTime(new Date(s.created_at))}</Td>
                  <Td label="Utilisateur">{who(s.user_id)}</Td>
                  <Td right label="Payé">{formatNumber(s.base)} <span className="wk-asset-sub">{s.asset}</span></Td>
                  <Td right hideSm label="Frais">{formatNumber(s.fee)} <span className="wk-asset-sub">{s.asset}</span></Td>
                  <Td right label="WAKATI reçus">{formatToken(s.wakati)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="wk-strip-item">
      <div className="wk-strip-label">{label}</div>
      <div className="wk-strip-value">{value}</div>
      <div className="wk-strip-sub">{sub}</div>
    </div>
  );
}
