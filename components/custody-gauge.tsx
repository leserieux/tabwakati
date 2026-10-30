import { gaugePos, gaugeScale, type PlanLine } from "@/lib/custody-plan";
import { formatNumber } from "@/lib/format";
import type { Tone } from "@/components/ui";

/**
 * Jauge du portefeuille de retrait. Trois zones, lisibles sans explication :
 *  orange = presque vide · vert = la bonne quantité · gris = trop plein.
 * Le rond montre où on en est ; le trait noir montre la cible.
 */
export function HotGauge({ plan, tone }: { plan: PlanLine; tone: Tone }) {
  if (plan.withdrawable === null || plan.state === "unknown" || plan.state === "nothing") return null;
  const scale = gaugeScale(plan);
  const lowP = gaugePos(plan.low, scale) * 100;
  const highP = gaugePos(plan.high, scale) * 100;
  const targetP = gaugePos(plan.target, scale) * 100;
  const hotP = gaugePos(plan.withdrawable, scale) * 100;
  const label = `Disponible pour les retraits : ${formatNumber(plan.withdrawable)} ${plan.asset}. Zone idéale : de ${formatNumber(plan.low)} à ${formatNumber(plan.high)}. Cible : ${formatNumber(plan.target)}.`;
  return (
    <div className="wk-gauge" role="img" aria-label={label}>
      <div className="wk-gauge-track">
        <div className="wk-gauge-zone wk-gauge-low" style={{ left: 0, width: `${lowP}%` }} />
        <div className="wk-gauge-zone wk-gauge-good" style={{ left: `${lowP}%`, width: `${Math.max(highP - lowP, 0)}%` }} />
        <div className="wk-gauge-zone wk-gauge-high" style={{ left: `${highP}%`, width: `${Math.max(100 - highP, 0)}%` }} />
        <div className="wk-gauge-target" style={{ left: `${targetP}%` }} />
        <div className={`wk-gauge-marker wk-gauge-marker-${tone}`} style={{ left: `${hotP}%` }} />
        <div className="wk-gauge-now" style={{ left: `${Math.min(Math.max(hotP, 8), 92)}%` }}>Maintenant</div>
      </div>
      <div className="wk-gauge-labels" aria-hidden="true">
        <span style={{ left: `${Math.max(lowP / 2, 7)}%` }}>Presque vide</span>
        <span style={{ left: `${(lowP + highP) / 2}%` }}>Bonne quantité</span>
        <span style={{ left: `${Math.min((highP + 100) / 2, 93)}%` }}>Trop plein</span>
      </div>
    </div>
  );
}
