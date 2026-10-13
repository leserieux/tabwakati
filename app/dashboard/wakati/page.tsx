import { loadWakati } from "@/lib/wakati";
import { formatToken, formatCompactNumber, formatCompactUsd, formatUsd, formatPct } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill, Empty, SegmentBar, Swatch, SEG } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REWARD_TYPES = ["game_win", "referral_bonus", "staking_reward"];

const FLOW_LABELS: Record<string, string> = {
  buy_wakati: "Achats de WAKATI dans l'appli",
  stake: "Mis en staking",
  unstake: "Retirés du staking",
  game_win: "Gains aux jeux",
  referral_bonus: "Bonus de parrainage",
  staking_reward: "Récompenses de staking"
};

function usd(n: number, price: number): string {
  const v = n * price;
  return Math.abs(v) >= 10000 ? formatCompactUsd(v) : formatUsd(v);
}

export default async function TokenomicsPage() {
  const w = await loadWakati();
  const { inApp, wallet } = w;
  const total = w.supply;

  const segments = [
    { key: "stock", label: "Stock interne de la plateforme", value: w.stock, color: SEG.reserve, desc: "WAKATI gardés par la plateforme (treasury_wallets), pas encore chez les utilisateurs." },
    { key: "available", label: "Disponible en app", value: inApp.available, color: SEG.available, desc: "Tokens que les utilisateurs peuvent utiliser ou retirer." },
    { key: "staking", label: "En staking", value: inApp.staking, color: SEG.staking, desc: "Tokens verrouillés dans le pool de staking." },
    { key: "pending", label: "En attente", value: inApp.pending, color: SEG.pending, desc: "Tokens en cours de traitement." }
  ];

  const circulating = w.circulating;
  const circSegments = [
    { key: "available", label: "Disponible en app", value: inApp.available, color: SEG.available },
    { key: "staking", label: "En staking", value: inApp.staking, color: SEG.staking },
    { key: "pending", label: "En attente", value: inApp.pending, color: SEG.pending }
  ];
  const stakingRate = inApp.total > 0 ? inApp.staking / inApp.total : 0;

  // Flux sur la période
  const txMap = new Map(w.flows.tx.map((t) => [t.type, t]));
  const sum = (types: string[]) => types.reduce((n, t) => n + (txMap.get(t)?.total ?? 0), 0);
  const cnt = (types: string[]) => types.reduce((n, t) => n + (txMap.get(t)?.count ?? 0), 0);
  const rewards = sum(REWARD_TYPES);
  const fees = w.flows.fees.reduce((n, f) => n + f.total, 0);
  const feesCount = w.flows.fees.reduce((n, f) => n + f.count, 0);
  const net = fees - rewards;

  const flowRows: { label: string; count: number; total: number; sub?: boolean }[] = [
    { label: FLOW_LABELS.buy_wakati, count: cnt(["buy_wakati"]), total: sum(["buy_wakati"]) },
    { label: FLOW_LABELS.stake, count: cnt(["stake"]), total: sum(["stake"]) },
    { label: FLOW_LABELS.unstake, count: cnt(["unstake"]), total: sum(["unstake"]) },
    { label: "Récompenses distribuées", count: cnt(REWARD_TYPES), total: rewards },
    ...REWARD_TYPES.map((t) => ({ label: FLOW_LABELS[t], count: cnt([t]), total: sum([t]), sub: true })),
    { label: "Frais collectés en WAKATI", count: feesCount, total: fees }
  ];

  return (
    <div>
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}

      <div className="wk-strip">
        <div className="wk-strip-item">
          <div className="wk-strip-label">Offre dans l'app</div>
          <div className="wk-strip-value">{formatCompactNumber(total)}</div>
          <div className="wk-strip-sub">utilisateurs + stock interne</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">En circulation</div>
          <div className="wk-strip-value">{formatCompactNumber(circulating)}</div>
          <div className="wk-strip-sub">{total > 0 ? `${formatPct((circulating / total) * 100, 2)} de l'offre in-app` : "en app uniquement"}</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Capitalisation</div>
          <div className="wk-strip-value">{formatCompactUsd(circulating * w.price)}</div>
          <div className="wk-strip-sub">circulation × prix interne</div>
        </div>
        <div className="wk-strip-item">
          <div className="wk-strip-label">Valeur totalement diluée</div>
          <div className="wk-strip-value">{formatCompactUsd(w.fdv)}</div>
          <div className="wk-strip-sub">offre in-app × prix interne</div>
        </div>
      </div>

      <Section title="Répartition de l'offre" hint="Où se trouvent les WAKATI de l'application : chez les utilisateurs ou dans le stock interne de la plateforme.">
        <div className="wk-panel">
          <SegmentBar segments={segments} label="Répartition de l'offre totale" />
        </div>
        <div style={{ marginTop: 12 }}>
          <TableWrap>
            <thead>
              <tr>
                <Th>Catégorie</Th>
                <Th right>Quantité</Th>
                <Th right>Part de l'offre</Th>
                <Th right>Valeur</Th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.key}>
                  <Td>
                    <div className="wk-legend-name">
                      <Swatch color={s.color} />
                      {s.label}
                    </div>
                    <div className="wk-legend-desc">{s.desc}</div>
                  </Td>
                  <Td right label="Quantité">{formatToken(s.value)}</Td>
                  <Td right label="Part">{total > 0 ? (s.value > 0 && (s.value / total) * 100 < 0.0001 ? "< 0,0001 %" : formatPct((s.value / total) * 100, s.value / total < 0.001 && s.value > 0 ? 4 : 2)) : "—"}</Td>
                  <Td right label="Valeur">{usd(s.value, w.price)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </Section>

      <Section title="Ce qui est en circulation" hint="La part de l'offre qui est entre les mains des utilisateurs, hors stock interne de la plateforme.">
        <div className="wk-panel">
          <SegmentBar segments={circSegments} label="Répartition de la circulation" />
          <div className="wk-kv" style={{ marginTop: 18 }}>
            <div className="wk-kv-row">
              <span>Total détenu en app</span>
              <span>{formatToken(inApp.total)} WAKATI</span>
            </div>
            <div className="wk-kv-row">
              <span>Taux de staking</span>
              <span>{formatPct(stakingRate * 100)} des WAKATI en app</span>
            </div>
            <div className="wk-kv-row">
              <span>Détenteurs</span>
              <span>{inApp.holders}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Stock interne de la plateforme" hint="Ce que la plateforme garde en interne (treasury_wallets). Lecture de la base uniquement : rien n'est lu sur la blockchain.">
        {wallet === null ? (
          <Empty text="Aucun stock WAKATI enregistré." />
        ) : (
          <div className="wk-panel">
            <div className="wk-kv">
              <div className="wk-kv-row"><span>Stock actuel</span><span>{formatToken(wallet.balance)} WAKATI</span></div>
              <div className="wk-kv-row"><span>Total collecté</span><span>{formatToken(wallet.collected)} WAKATI</span></div>
              <div className="wk-kv-row"><span>Total retiré</span><span>{formatToken(wallet.withdrawn)} WAKATI</span></div>
              <div className="wk-kv-row"><span>Brûlé (comptable)</span><span>{formatToken(wallet.burned)} WAKATI</span></div>
            </div>
          </div>
        )}
      </Section>

      <Section title={`Flux sur ${w.flows.days} jours`} hint="Ce qui est entré et sorti côté WAKATI. Utile pour voir si les récompenses distribuées dépassent les frais gagnés.">
        {flowRows.every((r) => r.total === 0) ? (
          <Empty text="Aucun mouvement WAKATI sur la période." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Mouvement</Th>
                  <Th right>Opérations</Th>
                  <Th right>Quantité</Th>
                  <Th right>Valeur</Th>
                </tr>
              </thead>
              <tbody>
                {flowRows.map((r) => (
                  <tr key={r.label}>
                    <Td>
                      <span style={r.sub ? { paddingLeft: 18, color: "var(--muted)" } : { fontWeight: 500, color: "var(--ink)" }}>{r.label}</span>
                    </Td>
                    <Td right label="Opérations">{r.count}</Td>
                    <Td right label="Quantité">{formatToken(r.total)}</Td>
                    <Td right label="Valeur">{usd(r.total, w.price)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div style={{ marginTop: 12 }}>
              <div className={`wk-callout ${net >= 0 ? "wk-callout-ok" : "wk-callout-warn"}`}>
                {net >= 0 ? (
                  <>Les frais gagnés dépassent les récompenses distribuées de <strong>{formatToken(net)} WAKATI</strong> sur {w.flows.days} jours.</>
                ) : (
                  <>Les récompenses distribuées dépassent les frais gagnés de <strong>{formatToken(-net)} WAKATI</strong> sur {w.flows.days} jours.</>
                )}
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
