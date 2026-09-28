"use client";

import { useState } from "react";

import { TableWrap, Th, Td, Pill, type Tone } from "@/components/ui";

type SweepResult = {
  user_address_id: string;
  asset_symbol: string;
  network: string;
  from_address: string;
  amount: string;
  status: "would_sweep" | "swept" | "skipped" | "error" | "gas_topped_up";
  tx_hash?: string;
  error?: string;
};

const STATUS_LABEL: Record<string, string> = {
  would_sweep: "À balayer",
  swept: "Balayé",
  skipped: "Ignoré",
  error: "Erreur",
  gas_topped_up: "Gas rechargé"
};

const STATUS_TONE: Record<string, Tone> = {
  would_sweep: "warn",
  swept: "ok",
  skipped: "info",
  error: "bad",
  gas_topped_up: "warn"
};

const EXPLORER: Record<string, string> = {
  Polygon: "https://polygonscan.com/tx/",
  BSC: "https://bscscan.com/tx/",
  Ethereum: "https://etherscan.io/tx/"
};

const CONFIRM_WORD = "BALAYER";

export function SweepRunner({ userAddressId, network, label }: { userAddressId?: string; network?: string; label?: string }) {
  const [scope, setScope] = useState(network || "");
  const [loading, setLoading] = useState<"dry" | "real" | null>(null);
  const [results, setResults] = useState<SweepResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranDryRun, setRanDryRun] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");

  async function run(dryRun: boolean) {
    setLoading(dryRun ? "dry" : "real");
    setError(null);
    try {
      const res = await fetch("/api/sweep/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, network: scope || undefined, userAddressId })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Échec de l'appel");
      setResults(json.results || []);
      if (dryRun) setRanDryRun(true);
      else {
        setRanDryRun(false);
        setConfirmInput("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  function handleRealExecution() {
    if (confirmInput !== CONFIRM_WORD) return;
    if (!confirm("Cette action envoie de VRAIES transactions on-chain et déplace des fonds réels. Confirmer l'exécution du balayage réel ?")) return;
    run(false);
  }

  const wouldSweepCount = (results || []).filter((r) => r.status === "would_sweep" || r.status === "gas_topped_up").length;

  return (
    <div className="wk-settings-card" style={{ marginTop: userAddressId ? 12 : 0 }}>
      {!userAddressId && (
        <div style={{ marginBottom: 12 }}>
          <label className="wk-label" htmlFor="sweep-network">Réseau</label>
          <select id="sweep-network" className="wk-input" value={scope} onChange={(e) => { setScope(e.target.value); setResults(null); setRanDryRun(false); }}>
            <option value="">Tous les réseaux</option>
            <option value="Polygon">Polygon</option>
            <option value="BSC">BSC</option>
            <option value="Ethereum">Ethereum</option>
          </select>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="wk-submit-sm" disabled={loading !== null} onClick={() => run(true)}>
          {loading === "dry" ? "Analyse en cours…" : label ? `Aperçu — ${label}` : "Aperçu (dry-run)"}
        </button>
        {error && <span className="wk-bad">{error}</span>}
      </div>

      {results !== null && (
        <div style={{ marginTop: 12 }}>
          <div className="wk-asset-sub" style={{ marginBottom: 6 }}>{results.length} adresse(s) analysée(s).</div>
          {results.length === 0 ? (
            <div className="wk-asset-sub">Aucune adresse correspondant aux critères.</div>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Actif</Th>
                  <Th>Réseau</Th>
                  <Th>Adresse</Th>
                  <Th right>Montant</Th>
                  <Th>Statut</Th>
                  <Th>Détail</Th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <Td label="Actif">{r.asset_symbol}</Td>
                    <Td label="Réseau">{r.network}</Td>
                    <Td label="Adresse"><span className="wk-asset-sub">{r.from_address.slice(0, 6)}…{r.from_address.slice(-4)}</span></Td>
                    <Td right label="Montant">{r.amount}</Td>
                    <Td label="Statut"><Pill tone={STATUS_TONE[r.status] || "info"}>{STATUS_LABEL[r.status] || r.status}</Pill></Td>
                    <Td label="Détail">
                      {r.tx_hash ? (
                        <a className="wk-link" href={`${EXPLORER[r.network] || "#"}${r.tx_hash}`} target="_blank" rel="noreferrer">
                          {r.tx_hash.slice(0, 10)}…
                        </a>
                      ) : (
                        <span className="wk-asset-sub">{r.error || "—"}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}

      {ranDryRun && wouldSweepCount > 0 && (
        <div className="wk-alert-bad" style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{wouldSweepCount} adresse(s)</strong> seraient réellement balayées (vraies transactions on-chain, fonds réels envoyés vers la trésorerie). Relis le tableau ci-dessus avant de continuer.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder={`Tape ${CONFIRM_WORD} pour confirmer`}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              className="wk-input"
              style={{ maxWidth: 220 }}
            />
            <button type="button" className="wk-danger-link" disabled={confirmInput !== CONFIRM_WORD || loading !== null} onClick={handleRealExecution}>
              {loading === "real" ? "Exécution en cours…" : "Exécuter le balayage réel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
