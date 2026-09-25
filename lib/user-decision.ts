import type { UserWindowSummary } from "@/lib/user-analytics";

export type DecisionTone = "ok" | "info" | "warn" | "bad";

export type UserDecisionSignal = {
  code: string;
  tone: DecisionTone;
  title: string;
  description: string;
};

export type UserDecisionSummary = {
  tone: DecisionTone;
  label: string;
  narrative: string;
  signals: UserDecisionSignal[];
};

function toneRank(tone: DecisionTone): number {
  return tone === "bad" ? 3 : tone === "warn" ? 2 : tone === "info" ? 1 : 0;
}

/**
 * Produit une lecture courte et explicable pour l'administrateur.
 * Ce moteur ne remplace pas le score de risque persistant et ne prétend pas
 * détecter une fraude : il transforme uniquement les KPI déjà calculés en
 * signaux lisibles.
 */
export function buildUserDecisionSummary(
  windows: UserWindowSummary[],
  risk: { score: number | null; level: string | null } | null,
  kycStatus?: string | null
): UserDecisionSummary {
  const signals: UserDecisionSignal[] = [];
  const recent = windows.find((row) => row.window === "7d");
  const long = windows.find((row) => row.window === "90d");
  const score = Number(risk?.score || 0);
  const level = String(risk?.level || "normal").toLowerCase();

  if (!recent) {
    signals.push({ code: "no_recent_data", tone: "info", title: "Données récentes limitées", description: "Aucune fenêtre récente n'est disponible pour qualifier l'activité." });
  } else {
    if (recent.failedCount >= 3) {
      signals.push({ code: "repeated_failures", tone: "warn", title: "Opérations échouées répétées", description: `${recent.failedCount} opération(s) ont échoué sur les 7 derniers jours.` });
    }
    if (recent.withdrawals > 0 && recent.deposits >= recent.withdrawals * 2) {
      signals.push({ code: "deposit_retention", tone: "ok", title: "Dépôts supérieurs aux retraits", description: "Le compte conserve davantage de flux entrants que de sorties récemment." });
    }
    if (recent.withdrawals > 0 && recent.deposits > 0 && recent.withdrawals >= recent.deposits * 0.8) {
      signals.push({ code: "rapid_outflow", tone: "warn", title: "Sorties élevées", description: "Les retraits représentent au moins 80 % des dépôts récents ; ce comportement mérite une vérification contextuelle." });
    }
    if (recent.transactionCount === 0) {
      signals.push({ code: "inactive", tone: "info", title: "Aucune activité récente", description: "Aucune transaction n'a été enregistrée sur les 7 derniers jours." });
    }
    if (recent.fees > 0 && recent.transactionCount > 0 && recent.fees >= Math.max(recent.deposits, 1) * 0.1) {
      signals.push({ code: "fee_concentration", tone: "info", title: "Frais significatifs", description: "Les frais représentent une part notable des dépôts récents." });
    }
  }

  if (kycStatus && !["verified", "approved", "complete", "completed"].includes(kycStatus.toLowerCase())) {
    signals.push({ code: "kyc_incomplete", tone: "warn", title: "KYC à vérifier", description: `Le statut KYC actuel est « ${kycStatus} » et n'est pas considéré comme validé.` });
  }

  if (level === "critical" || score >= 75) {
    signals.push({ code: "risk_critical", tone: "bad", title: "Risque élevé", description: `Le score de risque est de ${score}/100. Une investigation admin est recommandée.` });
  } else if (level === "high" || score >= 50) {
    signals.push({ code: "risk_high", tone: "warn", title: "Surveillance recommandée", description: `Le score de risque est de ${score}/100. Le compte doit rester sous observation.` });
  }

  if (long && long.transactionCount >= 20 && recent && recent.transactionCount === 0) {
    signals.push({ code: "activity_drop", tone: "info", title: "Baisse d'activité", description: "Le compte était actif sur 90 jours mais n'a plus d'activité sur les 7 derniers jours." });
  }

  if (signals.length === 0) {
    signals.push({ code: "no_signal", tone: "ok", title: "Aucun signal critique", description: "Les indicateurs disponibles ne présentent pas d'anomalie prioritaire." });
  }

  const tone = signals.reduce<DecisionTone>((current, signal) => (toneRank(signal.tone) > toneRank(current) ? signal.tone : current), "ok");
  const label = tone === "bad" ? "Investigation requise" : tone === "warn" ? "À surveiller" : tone === "info" ? "À contextualiser" : "Situation normale";
  const narrative = tone === "bad"
    ? "Ce compte présente un signal de risque élevé ; vérifiez les transactions et les flags avant toute décision."
    : tone === "warn"
      ? "Ce compte présente un ou plusieurs signaux à surveiller ; le contexte des flux doit être examiné."
      : tone === "info"
        ? "Les indicateurs sont incomplets ou nécessitent une lecture contextuelle."
        : "Les indicateurs disponibles sont cohérents et aucun signal critique n'a été détecté.";

  return { tone, label, narrative, signals };
}
