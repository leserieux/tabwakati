import { Pill, Section } from "@/components/ui";

export interface SignalItem { tone: "ok" | "warn" | "bad" | "info"; title: string; detail: string }

export function Signals({ items, title = "À retenir pour décider", hint }: { items: SignalItem[]; title?: string; hint?: string }) {
  return (
    <Section title={title} hint={hint}>
      <div style={{ display: "grid", gap: 12 }}>
        {items.length === 0 ? <div className="wk-panel">Pas assez de données sur cette période.</div> : items.map((s, i) => (
          <div key={i} className="wk-panel">
            <div style={{ marginBottom: 6 }}><Pill tone={s.tone}>{s.title}</Pill></div>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>{s.detail}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function PeriodTabs({ base, periods, current }: { base: string; periods: { value: number; label: string }[]; current: number }) {
  return (
    <div className="wk-tabs" role="tablist" aria-label="Période">
      {periods.map((x) => (
        <a key={x.value} href={`${base}?p=${x.value}`} role="tab" aria-selected={current === x.value} className={`wk-tab ${current === x.value ? "active" : ""}`}>{x.label}</a>
      ))}
    </div>
  );
}

export function parsePeriod(raw: string | undefined, allowed: number[], fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return allowed.includes(n) ? n : fallback;
}
