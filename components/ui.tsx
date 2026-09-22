import React from "react";
import { formatPct } from "@/lib/format";

export type Tone = "ok" | "warn" | "bad" | "info";

type IconName = "check" | "alert" | "x" | "clock" | "refresh" | "shield" | "activity" | "coin" | "price" | "layers" | "users" | "grid" | "gear" | "log";

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
    case "coin":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8.2 9.5l1.6 5 2.2-4.2 2.2 4.2 1.6-5" /></svg>);
    case "price":
      return (<svg {...common}><path d="M4 17l5-5 4 3 7-8" /><path d="M15 7h5v5" /></svg>);
    case "layers":
      return (<svg {...common}><path d="M12 4l9 5-9 5-9-5z" /><path d="M3 14l9 5 9-5" /></svg>);
    case "users":
      return (<svg {...common}><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 3-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><path d="M16 6.3a3 3 0 0 1 0 5.6M18.2 14.6c1.6.6 2.6 2 3 4.4" /></svg>);
    case "grid":
      return (<svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.3" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.3" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.3" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.3" /></svg>);
    case "gear":
      return (<svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3" /></svg>);
    case "log":
      return (<svg {...common}><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 15.5h6M9 8.5h3" /></svg>);
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

/** Couleurs des segments de l'offre WAKATI. */
export const SEG = {
  reserve: "#b7d3d8",
  available: "#0b5563",
  staking: "#2f8f83",
  pending: "#d8a24a",
  external: "#6b7fc4",
  burned: "#3a4556"
};

/** Barre segmentée : chaque segment est proportionnel à sa valeur (largeur minimale visible). */
export function SegmentBar({ segments, label }: { segments: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className="wk-supply" role="img" aria-label={label}>
      {visible.map((s) => (
        <div key={s.key} className="wk-supply-seg" style={{ flexGrow: s.value, background: s.color }} title={s.label} />
      ))}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="wk-swatch" style={{ background: color }} />;
}
