import { formatNumber } from "@/lib/format";
import { Pill } from "@/components/ui";
import { formatDays, untilLabel, type FundingLine, type StressCase } from "@/lib/funding";

/** Autonomie : combien de temps ce qui est prêt à partir paie les retraits. */
export function RunwayCell({ days, empty }: { days: number | null; empty: string }) {
  if (days === null) return <span className="wk-asset-sub">{empty}</span>;
  const tone = days < 1 ? "wk-bad" : days < 3 ? "" : "wk-ok";
  return (
    <span>
      <span className={tone}>{formatDays(days)}</span>
      {untilLabel(days) && <div className="wk-asset-sub">{untilLabel(days)}</div>}
    </span>
  );
}

/** Résultat d'un cas du test de stress, en un mot et une couleur. */
export function StressPill({ c, asset }: { c: StressCase | undefined; asset: string }) {
  if (!c) return <span className="wk-asset-sub">—</span>;
  if (c.verdict === "unknown") return <Pill tone="bad">Illisible</Pill>;
  if (c.verdict === "ok") return <Pill tone="ok">Payable</Pill>;
  if (c.verdict === "move") return <span><Pill tone="warn">Après déplacement</Pill><div className="wk-asset-sub">manque {formatNumber(c.shortfall)} {asset} tout de suite</div></span>;
  return <span><Pill tone="bad">Insuffisant</Pill><div className="wk-asset-sub">manque {formatNumber(c.shortfallAll)} {asset} même en tout ramenant</div></span>;
}

/** Les trois cas du test de stress d'un actif, sous forme de tableau. */
export function StressRows({ f }: { f: FundingLine }) {
  return (
    <>
      {f.stress.map((c) => (
        <tr key={c.key}>
          <td className="wk-td" data-label="Cas">{c.label}{c.users > 1 ? <div className="wk-asset-sub">{c.users} utilisateurs</div> : null}</td>
          <td className="wk-td wk-right" data-label="À payer">{formatNumber(c.need)} {f.plan.asset}</td>
          <td className="wk-td" data-label="Résultat"><StressPill c={c} asset={f.plan.asset} /></td>
        </tr>
      ))}
    </>
  );
}
