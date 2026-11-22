/** Écran de chargement affiché pendant la lecture des données (soldes on-chain, requêtes) : évite la page blanche. */
export default function Loading() {
  const bar = (w: string, h = 14) => <div style={{ width: w, height: h, borderRadius: 6, background: "var(--border, #2a2f3a)", opacity: 0.55, animation: "wk-pulse 1.4s ease-in-out infinite" }} />;
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 14, padding: "8px 0" }}>
      <style>{"@keyframes wk-pulse{0%,100%{opacity:.25}50%{opacity:.6}}"}</style>
      {bar("220px", 26)}
      {bar("60%")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 10 }}>
        {bar("100%", 84)}{bar("100%", 84)}{bar("100%", 84)}{bar("100%", 84)}
      </div>
      {bar("100%", 180)}
      <span className="wk-hint">Lecture des données en cours… les soldes on-chain peuvent prendre quelques secondes.</span>
    </div>
  );
}
