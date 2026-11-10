import { formatUsd } from "@/lib/format";
import type { FuturesMoney, MoneyPeriod } from "@/lib/futures";

/**
 * Le chiffre qui compte : l'app gagne-t-elle de l'argent avec le futures, et combien exactement ?
 * Tout est du point de vue de la PLATEFORME (+ = elle gagne). Frais encaissés et PNL de trading sont séparés.
 */
/** Toujours 2 décimales : un admin compare des chiffres, pas des formats. */
const abs2 = (v: number) => Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const sg = (v: number) => `${v > 0.004 ? "+" : v < -0.004 ? "−" : ""}${abs2(v)}`;
const cls = (v: number) => (v > 0.004 ? "wk-money-pos" : v < -0.004 ? "wk-money-neg" : "");

function verdict(net: number): { label: string; mark: string; tone: "pos" | "neg" | "zero" } {
  if (net > 0.004) return { label: "L'APP GAGNE", mark: "▲", tone: "pos" };
  if (net < -0.004) return { label: "L'APP PERD", mark: "▼", tone: "neg" };
  return { label: "ÉQUILIBRE", mark: "■", tone: "zero" };
}

export default function MoneyHero({ money, currency, usdPrice, compact = false }: { money: FuturesMoney; currency: string; usdPrice: number | null; compact?: boolean }) {
  const usd = (v: number) => (usdPrice ? `≈ ${v < -0.004 ? "−" : v > 0.004 ? "+" : ""}${formatUsd(Math.abs(v * usdPrice))}` : "");
  const periods: { label: string; p: MoneyPeriod }[] = [
    { label: "Aujourd'hui", p: money.today }, { label: "7 jours", p: money.d7 }, { label: "30 jours", p: money.d30 }, { label: "Depuis le début", p: money.all }
  ];
  const pend = money.pending;

  return (
    <div className="wk-money">
      <div className="wk-money-grid">
        {periods.map(({ label, p }) => {
          const v = verdict(p.net);
          return (
            <div key={label} className={`wk-money-card wk-money-card-${v.tone}`}>
              <div className="wk-money-period">{label}</div>
              <div className={`wk-money-verdict wk-money-verdict-${v.tone}`}>{v.mark} {v.label}</div>
              <div className={`wk-money-net ${cls(p.net)}`}>{sg(p.net)} <small>{currency}</small></div>
              <div className="wk-money-usd">{usd(p.net) || " "}</div>
              <div className="wk-money-rows">
                <div className="wk-money-row wk-money-row-strong"><span>Frais encaissés</span><b className={cls(p.fees_total)}>{sg(p.fees_total)}</b></div>
                {!compact && (
                  <>
                    <div className="wk-money-row wk-money-row-sub"><span>Ouverture</span><span>{abs2(p.fees_open)}</span></div>
                    <div className="wk-money-row wk-money-row-sub"><span>Périodiques</span><span>{abs2(p.fees_funding)}</span></div>
                    <div className="wk-money-row wk-money-row-sub"><span>Fermeture</span><span>{abs2(p.fees_close)}</span></div>
                  </>
                )}
                <div className="wk-money-row wk-money-row-strong"><span>PNL de trading</span><b className={cls(p.trading_pnl)}>{sg(p.trading_pnl)}</b></div>
                {!compact && <div className="wk-money-row wk-money-row-sub"><span>Positions clôturées</span><span>{p.trades}{p.liquidations > 0 ? ` (${p.liquidations} liquidée${p.liquidations > 1 ? "s" : ""})` : ""}</span></div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="wk-money-pending">
        <span>Positions ouvertes ({pend.open_positions})</span>
        <span>Frais périodiques en cours <b>{abs2(pend.accrued_funding)}</b></span>
        <span>PNL latent plateforme <b className={cls(pend.unrealized_platform_pnl)}>{sg(pend.unrealized_platform_pnl)}</b></span>
        <span>Marge immobilisée <b>{abs2(pend.margin_locked)}</b></span>
        <span className="wk-money-cur">{currency}</span>
      </div>
    </div>
  );
}
