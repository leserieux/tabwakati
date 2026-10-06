import { loadWakati } from "@/lib/wakati";
import { formatToken, formatCompactNumber, formatPct, formatUsd, formatPrice } from "@/lib/format";
import { Section, TableWrap, Th, Td, Pill, Empty } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StakingPage() {
  const w = await loadWakati();
  const { pool, inApp } = w;
  const stakingRate = inApp.total > 0 ? inApp.staking / inApp.total : 0;
  const yearly = pool ? pool.totalStaked * (pool.apr / 100) : 0;

  const txMap = new Map(w.flows.tx.map((t) => [t.type, t]));
  const rows = [
    { label: "Mis en staking", t: txMap.get("stake") },
    { label: "Retirés du staking", t: txMap.get("unstake") },
    { label: "Récompenses versées", t: txMap.get("staking_reward") }
  ];

  return (
    <div>
      {w.errors.length > 0 && <div className="wk-alert-bad">Certaines données n'ont pas pu être lues : {w.errors.join(" · ")}</div>}

      {!pool ? (
        <Empty text="Aucun pool de staking WAKATI." />
      ) : (
        <>
          <div className="wk-strip">
            <div className="wk-strip-item">
              <div className="wk-strip-label">En staking</div>
              <div className="wk-strip-value">{formatCompactNumber(pool.totalStaked)}</div>
              <div className="wk-strip-sub">{formatUsd(pool.totalStaked * w.price)}</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Taux de staking</div>
              <div className="wk-strip-value">{formatPct(stakingRate * 100)}</div>
              <div className="wk-strip-sub">des WAKATI détenus en app</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Stakers actifs</div>
              <div className="wk-strip-value">{pool.stakers}</div>
              <div className="wk-strip-sub">sur {inApp.holders} détenteurs</div>
            </div>
            <div className="wk-strip-item">
              <div className="wk-strip-label">Rendement annuel</div>
              <div className="wk-strip-value">{formatPct(pool.apr, 1)}</div>
              <div className="wk-strip-sub">mise minimale {formatToken(pool.minStake)}</div>
            </div>
          </div>

          <Section title="Coût du staking" hint="Ce que le pool coûte en nouveaux WAKATI distribués aux stakers.">
            <div className="wk-grid-2">
              <div className="wk-panel">
                <div className="wk-kv">
                  <div className="wk-kv-row"><span>Émission annuelle estimée</span><span>{formatToken(yearly)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Par jour, environ</span><span>{formatToken(yearly / 365)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Valeur annuelle estimée</span><span>{formatUsd(yearly * w.price)}</span></div>
                  <div className="wk-kv-row"><span>Récompenses en attente</span><span>{formatToken(pool.pendingRewards)} WAKATI</span></div>
                  <div className="wk-kv-row"><span>Récompenses déjà versées</span><span>{formatToken(pool.rewardsDistributed)} WAKATI</span></div>
                </div>
              </div>
              <div className="wk-callout wk-callout-warn">
                Les récompenses de staking s'ajoutent à l'offre en app : plus le pool grossit, plus il distribue de nouveaux WAKATI. Au prix actuel ({formatPrice(w.price)}), cela représente {formatUsd(yearly * w.price)} par an.
              </div>
            </div>
          </Section>

          <Section title="Pool">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pool</Th>
                  <Th right>Rendement</Th>
                  <Th right>Mise min.</Th>
                  <Th right>En staking</Th>
                  <Th right>Stakers</Th>
                  <Th right>Versé</Th>
                  <Th>Statut</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td><strong style={{ color: "var(--ink)" }}>{pool.name}</strong></Td>
                  <Td right label="Rendement">{formatPct(pool.apr, 1)}</Td>
                  <Td right label="Mise min.">{formatToken(pool.minStake)}</Td>
                  <Td right label="En staking">{formatToken(pool.totalStaked)}</Td>
                  <Td right label="Stakers">{pool.stakers}</Td>
                  <Td right label="Versé">{formatToken(pool.rewardsDistributed)}</Td>
                  <Td label="Statut">{pool.isActive ? <Pill tone="ok">Actif</Pill> : <Pill tone="info">Inactif</Pill>}</Td>
                </tr>
              </tbody>
            </TableWrap>
          </Section>

          <Section title={`Mouvements sur ${w.flows.days} jours`}>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Mouvement</Th>
                  <Th right>Opérations</Th>
                  <Th right>Quantité</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td right label="Opérations">{r.t?.count ?? 0}</Td>
                    <Td right label="Quantité">{formatToken(r.t?.total ?? 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>
        </>
      )}
    </div>
  );
}
