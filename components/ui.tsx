import React from "react";
import { formatPct } from "@/lib/format";

export type Tone = "ok" | "warn" | "bad" | "info";

type IconName = "check" | "alert" | "x" | "clock" | "refresh" | "shield" | "activity";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "check":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></svg>);
    case "alert":
      return (<svg {...common}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.3v.01" /></svg>);
    case "x":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>);
    case "clock":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
    case "refresh":
      return (<svg {...common}><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4" /></svg>);
    case "shield":
      return (<svg {...common}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></svg>);
    case "activity":
      return (<svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>);
  }
}

export function PageHeader({ title, subtitle, updatedAt }: { title: string; subtitle?: string; updatedAt?: string }) {
  return (
    <header className="wk-head">
      <div>
        <h1 className="wk-title">{title}</h1>
        {subtitle && <p className="wk-sub">{subtitle}</p>}
      </div>
      <div className="wk-head-side">
        {updatedAt && <span>Actualisé le {updatedAt}</span>}
        <a className="wk-btn" href="">
          <Icon name="refresh" size={15} />
          Actualiser
        </a>
      </div>
    </header>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="wk-section">
      <div className="wk-section-head">
        <h2 className="wk-h2">{title}</h2>
        {hint && <p className="wk-hint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="wk-tablewrap">
      <table className="wk-table">{children}</table>
    </div>
  );
}

export function Th({ children, right, hideSm }: { children?: React.ReactNode; right?: boolean; hideSm?: boolean }) {
  return <th className={["wk-th", right ? "wk-right" : "", hideSm ? "wk-hide-sm" : ""].filter(Boolean).join(" ")}>{children}</th>;
}

export function Td({ children, right, hideSm, label }: { children?: React.ReactNode; right?: boolean; hideSm?: boolean; label?: string }) {
  return (
    <td data-label={label ?? ""} className={["wk-td", right ? "wk-right" : "", hideSm ? "wk-hide-sm" : ""].filter(Boolean).join(" ")}>
      {children}
    </td>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`wk-pill wk-pill-${tone}`}>
      <span className="wk-dot" />
      {children}
    </span>
  );
}

/** Barre de couverture : part de ce qui est dû qui est couverte (0 à 100 %). */
export function CoverageBar({ ratio, tone }: { ratio: number; tone: "ok" | "warn" | "bad" | "info" }) {
  const width = Math.max(0, Math.min(ratio, 1)) * 100;
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--faint)";
  const label = ratio > 9.99 ? "> 999 %" : formatPct(ratio * 100, ratio >= 1 ? 0 : 1);
  return (
    <div className="wk-cover">
      <div className="wk-cover-track">
        <div className="wk-cover-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      <span className="wk-cover-pct">{label}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="wk-empty">{text}</div>;
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return <div className="wk-alert-bad">{text}</div>;
}
