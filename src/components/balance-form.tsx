"use client";

import type { ReactNode } from "react";

/**
 * Formulaire de correction de solde : demande une confirmation explicite (montant, sens, actif) avant l'envoi.
 * Le serveur revérifie tout (permission, motif, base) : cette confirmation n'est qu'un garde-fou contre le clic distrait.
 */
export default function BalanceForm({ action, children, className, style }: { action: (formData: FormData) => void | Promise<void>; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <form
      action={action}
      className={className}
      style={style}
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        const verb = String(fd.get("direction")) === "debit" ? "DÉBITER" : "CRÉDITER";
        const amount = String(fd.get("amount") ?? "").trim();
        const asset = String(fd.get("asset_symbol") ?? "").trim();
        if (!window.confirm(`${verb} ${amount} ${asset} sur ce compte ?\n\nL'opération est enregistrée dans l'historique et le journal d'audit.`)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
