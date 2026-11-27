import { getSupabaseAdmin, q } from "@/core/db/data";
import { can } from "@/core/auth/session";
import { formatDateTime, formatNumber } from "@/core/format";
import { adjustBalance } from "@/app/dashboard/balances/actions";
import { loadDepositsToReview } from "@/modules/operations/deposit-review";
import BalanceForm from "@/components/balance-form";
import { Empty, Section } from "@/components/ui";

type Bal = { asset_symbol: string; available_balance: number | null };

/** Fiche utilisateur : corriger un solde (crédit / débit) et régulariser un dépôt resté en échec. */
export default async function BalanceAdjust({ userId, pending }: { userId: string; pending?: string }) {
  const writable = can("finance.write");
  const db = getSupabaseAdmin();
  const [balances, assets, deposits, recent] = await Promise.all([
    q<Bal>(db.from("user_balances").select("asset_symbol, available_balance").eq("user_id", userId)),
    q<{ symbol: string }>(db.from("supported_assets").select("symbol").eq("is_active", true)),
    loadDepositsToReview({ userId, limit: 20 }),
    q<{ id: string; created_at: string; amount: number; asset_symbol: string; metadata: Record<string, any> | null }>(
      db.from("transactions").select("id, created_at, amount, asset_symbol, metadata").eq("user_id", userId).eq("type", "balance_adjustment").order("created_at", { ascending: false }).limit(10)
    )
  ]);

  const have = new Map(balances.rows.map((b) => [b.asset_symbol, Number(b.available_balance ?? 0)]));
  const symbols = [...new Set([...have.keys(), ...assets.rows.map((a) => a.symbol)])].sort();

  return (
    <Section title="Corriger un solde" hint="Pour un dépôt qui n'a pas été crédité à tort : vérifie d'abord chez le fournisseur que l'argent est bien arrivé, puis crédite. Tout est tracé (historique, grand livre, journal d'audit).">
      {pending && <div className="wk-alert-ok">{pending}</div>}
      {!writable ? <p className="wk-asset-sub">Ton rôle ne permet pas de corriger un solde.</p> : (
        <div className="wk-grid-2">
          <div className="wk-panel">
            <strong>Dépôts à régulariser</strong>
            {deposits.rows.length === 0 ? <Empty text="Aucun dépôt en échec ou en attente (90 jours)." /> : deposits.rows.map((d) => (
              <BalanceForm key={d.id} action={adjustBalance} style={{ display: "grid", gap: 6, margin: "10px 0", paddingBottom: 10, borderBottom: "1px solid var(--line, #e5e7eb)" }}>
                <input type="hidden" name="user_id" value={userId} />
                <input type="hidden" name="return_to" value={`/dashboard/users/${userId}`} />
                <input type="hidden" name="direction" value="credit" />
                <input type="hidden" name="asset_symbol" value={d.asset} />
                <input type="hidden" name="deposit_tx_id" value={d.id} />
                <span>{formatDateTime(new Date(d.createdAt))} · <strong>{formatNumber(d.amount)} {d.asset}</strong> · {d.status === "failed" ? "Échec" : d.stuck ? "Bloqué" : "En attente"}</span>
                <span className="wk-asset-sub">{[d.provider, d.phone, d.reason].filter(Boolean).join(" · ") || "Aucun détail fournisseur"}{d.providerRef ? ` · réf. ${d.providerRef}` : ""}</span>
                <input name="amount" className="wk-input" defaultValue={String(d.suggested)} inputMode="decimal" aria-label="Montant à créditer" />
                <input name="reason" className="wk-input" maxLength={300} required minLength={5} placeholder="Motif (ex : reçu confirmé chez PawaPay, réf. …)" />
                <button type="submit" className="wk-submit-sm">Créditer ce dépôt</button>
              </BalanceForm>
            ))}
          </div>
          <div className="wk-panel">
            <strong>Correction libre</strong>
            <BalanceForm action={adjustBalance} style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input type="hidden" name="user_id" value={userId} />
              <input type="hidden" name="return_to" value={`/dashboard/users/${userId}`} />
              <label className="wk-label" htmlFor="adj-asset">Actif</label>
              <select id="adj-asset" name="asset_symbol" className="wk-input" required defaultValue={symbols.includes("FCFA") ? "FCFA" : symbols[0]}>
                {symbols.map((s) => <option key={s} value={s}>{s} — solde disponible {formatNumber(have.get(s) ?? 0)}</option>)}
              </select>
              <label className="wk-label" htmlFor="adj-dir">Opération</label>
              <select id="adj-dir" name="direction" className="wk-input" defaultValue="credit">
                <option value="credit">Créditer (ajouter au solde)</option>
                <option value="debit">Débiter (retirer du solde)</option>
              </select>
              <label className="wk-label" htmlFor="adj-amount">Montant</label>
              <input id="adj-amount" name="amount" className="wk-input" inputMode="decimal" required placeholder="Ex : 5000" />
              <label className="wk-label" htmlFor="adj-reason">Motif (obligatoire)</label>
              <input id="adj-reason" name="reason" className="wk-input" required minLength={5} maxLength={300} placeholder="Ex : erreur de crédit constatée, ticket #123" />
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="notify" value="on" defaultChecked /> Prévenir l'utilisateur (notification, crédit seulement)</label>
              <button type="submit" className="wk-submit-sm">Appliquer</button>
            </BalanceForm>
            <p className="wk-asset-sub" style={{ marginTop: 8 }}>Un crédit sans dépôt réel crée du solde non financé : la trésorerie n'est pas modifiée.</p>
          </div>
        </div>
      )}
      {recent.rows.length > 0 && (
        <div className="wk-panel" style={{ marginTop: 12 }}>
          <strong>Dernières corrections</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {recent.rows.map((r) => (
              <li key={r.id}>{formatDateTime(new Date(r.created_at))} · {r.metadata?.direction === "debit" ? "Débit" : "Crédit"} <strong>{formatNumber(Number(r.amount))} {r.asset_symbol}</strong> · {String(r.metadata?.actor ?? "")} · {String(r.metadata?.reason ?? "")}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
