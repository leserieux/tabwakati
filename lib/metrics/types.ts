/**
 * Types centralisés pour tous les KPI du dashboard.
 * Source unique de vérité pour la définition des métriques.
 */

// ===== OVERVIEW / VUE D'ENSEMBLE =====
export interface UserMetrics {
  totalUsers: number;
  activeUsers7d: number;
  newUsers7d: number;
  emailConfirmed: number;
  kycCompleted: number;
}

export interface LiquidityMetrics {
  heldUsd: number;                    // Actifs réserves valorisés
  owedUsd: number;                    // Passifs utilisateurs valorisés
  coveredUsd: number;                 // Min(held, owed)
  missingUsd: number;                 // Max(0, owed - covered)
  coveragePct: number | null;         // null si pas de passif valorisable
  unpriced: string[];                 // Actifs sans prix, exclus du calcul
}

export interface VolumeMetrics {
  volume7d: number;                   // Dépôts + retraits + swaps + transferts (USD)
  volume24h: number;                  // Jour UTC actuel
  transactionCount7d: number;
  gamesWagered7d: number;             // Mises de jeux (SÉPARÉ du volume)
  byDay: Array<{
    key: string;                      // YYYY-MM-DD
    volume: number;
    count: number;
  }>;
}

export interface FeesMetrics {
  totalUsd: number;                   // Somme tous actifs
  byAsset: Array<{
    asset: string;
    total: number;                    // Montant natif
    usd: number | null;               // Valorisé (null si pas de prix)
  }>;
  unpriced: string[];                 // Actifs collectés sans prix
}

export interface RiskMetrics {
  loansAtRisk: number;                // Prêts proches de la liquidation
  pendingTransactions: number;
  stuckTransactions: number;          // > 1 heure
  failedTransactions24h: number;
  negativeBalances: Array<{
    asset: string;
    count: number;
  }>;
  reconciliationIssues: Array<{
    asset: string;
    liabilityDiff: number;
    negativeBal: number;
    stakingOrphan: number;
  }>;
}

export interface OverviewMetrics {
  timestamp: string;
  users: UserMetrics;
  liquidity: LiquidityMetrics;
  volume: VolumeMetrics;
  fees: FeesMetrics;
  risk: RiskMetrics;
  errors?: string;
}

// ===== FINANCIAL / TRÉSORERIE & P&L =====
export interface CashflowMetrics {
  depositsRealUsd: number;            // Dépôts en argent réel (hors WAKATI, hors jeux)
  withdrawalsRealUsd: number;
  netRealUsd: number;                 // deposits - withdrawals
}

export interface GameMetrics {
  betsUsd: number;                    // Mises joueurs (valorisées)
  winsUsd: number;                    // Gains payés
  netUsd: number;                     // bets - wins (> 0 = profit)
  rtp: number | null;                 // wins / bets * 100 (RTP = retour aux joueurs)
}

export type FinancialCategoryKey = "fees" | "game_bets" | "game_wins" | "staking" | "referral" | "defaults";

export interface FinancialCategoryTotal {
  usd: number;                        // Valeur USD
  real: number;                       // Montant en argent réel (FCFA, crypto)
  wakati: number;                     // Montant en WAKATI
  count: number;                      // Nombre de transactions
  native: Map<string, number>;        // Montants natifs par actif
}

export interface FinancialMetrics {
  period: number;                     // Jours (7, 30, 90, 0 = tout)
  byCat: Record<FinancialCategoryKey, FinancialCategoryTotal>;
  // Totaux
  realTotal: number;                  // Somme tous réels
  wakatiTotal: number;                // Somme tous WAKATI
  netTotal: number;                   // real + wakati
  // Jeux (spécial)
  gameBets: number;                   // Entrée (mises)
  gameWins: number;                   // Sortie (gains)
  gameNet: number;                    // bets - wins
  gameRtp: number | null;             // wins / bets * 100
  // Comparaison période précédente
  deltaPrevious: number | null;       // net - net_previous
  // Mensuel (12 derniers mois)
  monthlyBreakdown: Array<{
    key: string;                      // YYYY-MM
    fees: number;
    game: number;
    costs: number;                    // staking + referral + defaults
    net: number;
  }>;
  // Signaux de décision
  signals: Array<{
    tone: "ok" | "warn" | "bad" | "info";
    title: string;
    detail: string;
  }>;
  // État
  unpriced: string[];
  wakatiPrice: number | null;
  wakatiPeak: number | null;
  truncated: boolean;
  error?: string;
}

// ===== ASSETS =====
export interface UserAssetMetrics {
  asset: string;
  users: number;                      // Nombre d'utilisateurs ayant ce solde
  totalNative: number;                // Somme tous soldes
  availableNative: number;
  stakingNative: number;
  pendingNative: number;
  priceUsd: number | null;
  valueUsd: number | null;            // total * price (null si pas de prix)
}

export interface TreasuryAssetMetrics {
  asset: string;
  balanceNative: number;
  priceUsd: number | null;
  valueUsd: number | null;            // balance * price
}

export interface AssetsMetrics {
  userAssets: UserAssetMetrics[];
  userTotalUsd: number;               // Somme valueUsd
  treasury: TreasuryAssetMetrics[];
  treasuryTotalUsd: number;           // Somme valueUsd
  unpriced: string[];
  error?: string;
}

// ===== ANALYTICS =====
export interface UserRiskScore {
  userId: string;
  username: string;
  score: number | null;               // 0-100
  level: "low" | "medium" | "high" | "critical" | null;
  lastCalculated: string | null;      // ISO timestamp
}

export interface TopUser {
  userId: string;
  username: string;
  valueUsd: number;                   // Valeur actuelle (actif par actif, agrégée USD)
  lastActivity: string | null;        // ISO timestamp
  riskScore: UserRiskScore | null;
}

export interface AnalyticsMetrics {
  users: {
    total: number;
    active30d: number;
    withBalances: number;
    atRisk: number;                   // score >= 50
  };
  cashflow: {
    depositsUsd: number;              // Transactions réussies
    withdrawalsUsd: number;
    netUsd: number;
  };
  fees: {
    totalUsd: number;
    fromPlatformFeesTable: number;    // Exactement depuis platform_fees (hors test, hors game_net_loss)
  };
  topUsers: TopUser[];                // Top 25 par valeur
  errors?: string;
}

// ===== COMMON INTERFACES =====
export interface MetricsRequest {
  now?: number;                       // Timestamp, default: Date.now()
  horizonDays?: number;               // Historical depth, default: 400
}

export interface MetricsResponse<T> {
  data: T;
  errors: string[];
  truncated: boolean;
}
