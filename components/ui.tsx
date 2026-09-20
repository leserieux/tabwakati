import React from "react";

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h1 style={{ color: "#f8fafc", marginBottom: "0.25rem" }}>{title}</h1>
      {subtitle && <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: "1.5rem", fontSize: "0.9rem" }}>{subtitle}</p>}
    </>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ margin: "2rem 0 0.75rem" }}>
      <h2 style={{ color: "#f8fafc", fontSize: "1.1rem", margin: 0 }}>{children}</h2>
      {hint && <p style={{ color: "#64748b", fontSize: "0.8rem", margin: "0.2rem 0 0" }}>{hint}</p>}
    </div>
  );
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "12px", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

export function Th({ children, align }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align || "left",
        padding: "0.75rem 1rem",
        color: "#94a3b8",
        fontSize: "0.8rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </th>
  );
}

export function Td({ children, align, mono }: { children?: React.ReactNode; align?: "left" | "right"; mono?: boolean }) {
  return (
    <td
      style={{
        textAlign: align || "left",
        padding: "0.75rem 1rem",
        color: "#cbd5e1",
        fontSize: "0.9rem",
        fontFamily: mono ? "ui-monospace, monospace" : undefined
      }}
    >
      {children}
    </td>
  );
}

export function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "bad" | "info" }) {
  const t = {
    ok: { color: "#4ade80", bg: "#14532d" },
    warn: { color: "#fbbf24", bg: "#78350f" },
    bad: { color: "#f87171", bg: "#7f1d1d" },
    info: { color: "#94a3b8", bg: "#334155" }
  }[tone];
  return (
    <span style={{ background: t.bg, color: t.color, padding: "0.2rem 0.6rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: "#1e293b", borderRadius: "12px", padding: "1.5rem", color: "#64748b", fontSize: "0.9rem" }}>{text}</div>
  );
}

export function ErrorBox({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div style={{ background: "#7f1d1d", color: "#fecaca", padding: "0.75rem 1rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85rem" }}>
      Erreur : {text}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "#f87171" : tone === "warn" ? "#fbbf24" : tone === "ok" ? "#4ade80" : "#f8fafc";
  return (
    <div style={{ background: "#1e293b", borderRadius: "12px", padding: "1rem 1.25rem" }}>
      <div style={{ color: "#94a3b8", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ color, fontSize: "1.5rem", fontWeight: 700, margin: "0.25rem 0" }}>{value}</div>
      {sub && <div style={{ color: "#64748b", fontSize: "0.75rem" }}>{sub}</div>}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "1rem" }}>{children}</div>;
}

export function Alert({ tone, children }: { tone: "warn" | "bad" | "info"; children: React.ReactNode }) {
  const t = {
    warn: { color: "#fde68a", bg: "#78350f" },
    bad: { color: "#fecaca", bg: "#7f1d1d" },
    info: { color: "#bfdbfe", bg: "#1e3a5f" }
  }[tone];
  return <div style={{ background: t.bg, color: t.color, padding: "0.75rem 1rem", borderRadius: "8px", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{children}</div>;
}
