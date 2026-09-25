# Règle importante pour les actifs

Les écrans génériques d'administration traitent **tous les actifs de la même manière**. `WAKATI` est un actif interne à l'application, mais il n'est pas une exception dans les vues générales.

## Règles pour les développeurs et les agents IA

- Ne jamais coder en dur `WAKATI` (ou un autre symbole) dans une page générique comme la vue d'ensemble, les utilisateurs, les transactions, la solvabilité, la liquidité ou les rapports.
- Pour afficher les actifs, lire `supported_assets` et utiliser `asset_symbol` comme clé de regroupement.
- Pour les soldes utilisateurs, agréger `user_balances` par `asset_symbol`, puis valoriser chaque actif séparément avec `asset_prices`.
- Ne jamais additionner des quantités de plusieurs actifs différents. Les totaux multi-actifs doivent être exprimés en USD (ou présentés ligne par ligne).
- La couverture de trésorerie doit être calculée actif par actif : un excédent sur un actif ne compense pas un déficit sur un autre.
- Si un nouvel actif est ajouté à la configuration des actifs, il doit être découvert automatiquement par les écrans génériques, sans modification de code ni ajout d'une condition spécifique.
- Les pages spécialisées d'un actif sont autorisées uniquement pour ses fonctionnalités propres (par exemple tokenomics ou staking), mais elles ne doivent pas contaminer les pages générales.

Le chargeur partagé `lib/assets.ts` fournit l'agrégation générique des soldes utilisateurs pour les écrans d'administration.

## Feuille de route : performance utilisateur et décision financière

Le dashboard d'administration doit évoluer au-delà de l'affichage des soldes et des transactions. Il doit permettre de comprendre les flux financiers, la performance, la valeur et le risque de chaque utilisateur, tout en conservant une lecture séparée par actif.

### État d'avancement

- [x] **Phase 1 — Socle analytique** : tables `user_performance_daily`, `user_risk_flags`, historique append-only des scores, vue `user_risk_scores_current`, RLS et versionnement du scoring/règles.
- [x] **Phase 2A — Fiche utilisateur initiale** : profil, KYC, limites, valeur USD, dépôts, retraits, variation nette, performance par actif, transactions et alertes.
- [x] **Phase 2B — Synthèse financière renforcée** : classification des rewards, fees, jeux, transferts, swaps et prêts ; calcul des valeurs USD par actif ; affichage du score et des flags de risque.
- [ ] **Phase 2C — Qualité et décision** : raisons de score lisibles, alertes explicites, ratio dépôt/retrait, périodes 7/30/90 jours et filtres transactionnels complets.
- [ ] **Phase 3 — Analyse plateforme** : cohortes, rétention, churn, LTV, revenu par utilisateur et monétisation.
- [ ] **Phase 4 — Économie avancée** : coût historique d'acquisition, P&L réel et analyse multi-actifs avancée.

### Principes de calcul

Pour chaque utilisateur et chaque actif, distinguer au minimum :

- **Solde actuel** : `available_balance + staking_balance + pending_balance`.
- **Total des dépôts** : dépôts réussis, ajouts de fonds, achats, crédits et bonus lorsqu'ils sont comptabilisés comme des entrées.
- **Total des retraits** : retraits réussis, paiements de sortie et autres sorties.
- **Variation nette** : `solde_actuel + total_retraits - total_dépôts`.

La variation nette est une mesure de flux comptable. Elle ne doit pas être présentée comme un bénéfice réel tant que le coût historique d'acquisition de chaque actif n'est pas connu.

Il faut distinguer :

- **Performance comptable / flux** : calculée à partir de `transactions` et `user_balances`.
- **Performance économique / profit réel** : nécessite le prix d'achat moyen, les dates d'acquisition, les entrées et sorties d'actifs ainsi que la valorisation actuelle.

Les résultats doivent toujours préciser s'il s'agit d'une variation nette, d'un cashflow ou d'une estimation de bénéfice.

### Catégories de flux à classifier

Le moteur de synthèse doit progressivement classifier les transactions dans les catégories suivantes :

- `deposit`, `withdrawal`, `transfer_in`, `transfer_out`
- `game_win`, `game_bet`, `fee`, `refund`, `reward`, `staking_reward`
- `staking_lock`, `unstake`, `swap_in`, `swap_out`
- `loan_borrowed`, `loan_repaid`, `cashback`, `referral_bonus`
- `admin_adjustment`, `balance_correction`, `bonus`

À partir de cette classification, calculer séparément les entrées, sorties, gains, pertes, transferts, frais et flux propres à chaque fonctionnalité.

### Architecture analytique cible

Conserver trois couches :

1. **Couche brute** : `transactions`, `user_balances`, `user_addresses`, `user_kyc`, `user_stakes`, `loans`, `asset_prices`.
2. **Couche analytique** : `user_performance_daily`, `user_activity_summary`, `user_risk_flags`, `user_lifetime_value`, `user_performance_snapshot`.
3. **Couche dashboard** : vue globale, fiche utilisateur, risques, performance, monétisation et alertes.

Les vues analytiques devront couvrir les périodes 7, 30 et 90 jours, la fréquence des dépôts, le churn, le risque, la profitabilité, le cash net et la valeur générée par les frais, le staking, les jeux, les swaps et les prêts.

### Sections cibles du dashboard

#### Vue Utilisateurs

- total de comptes, nouveaux utilisateurs et utilisateurs actifs ;
- comptes vérifiés, à risque, high value, churners et déposants fréquents ;
- recherche, filtres et accès direct à la fiche utilisateur.

#### Fiche utilisateur

Afficher l'identité, le KYC, le statut, le score de risque, la valeur actuelle, la dernière activité et :

- solde actuel, dépôts, retraits, variation nette et valeur USD ;
- performance détaillée par actif : dépôts, retraits, solde, variation, prix, valeur USD et statut ;
- mouvements par catégorie : gains, pertes, transferts, frais, récompenses, swaps et bonus ;
- historique des transactions avec filtres actif, statut et type, ainsi qu'un export CSV ;
- adresses, staking, prêts, jeux, swaps et alertes d'investigation.

#### Performance globale

Suivre les volumes de dépôts et retraits, les revenus, les frais, le staking, les actifs les plus utilisés, les comptes rentables ou en perte et les ratios KYC / risque.

#### Risque

Identifier les dépôts suivis de retraits rapides, les gros retraits sans activité récente, les KYC incomplets, les volumes anormaux, les opérations échouées, les adresses inhabituelles et les comportements potentiellement frauduleux ou abusifs.

#### Monétisation

Mesurer les revenus par source, la LTV par cohorte, la rétention à 7/30/90 jours et la valeur client par segment.

### Score de risque et alertes

Introduire progressivement un score de risque de 0 à 100 avec les statuts `ok`, `watch`, `risky` et `blocked`. Les facteurs peuvent inclure le KYC, la vitesse de retrait, les montants anormaux, les pays, le nombre d'adresses, les échecs répétés et les anomalies de comportement.

Prévoir des alertes configurables, notamment :

- dépôt important suivi d'un retrait important dans les 24 heures ;
- retrait sans KYC complet ;
- volume ou fréquence inhabituels ;
- opérations incohérentes entre plusieurs comptes ;
- usage inhabituel d'adresses ;
- écart de rapprochement ou opération impossible.

### Règles de présentation

- Ne jamais mélanger les quantités de plusieurs actifs.
- Présenter les agrégats multi-actifs en USD ou ligne par ligne.
- Rendre visibles les hypothèses et les limites de chaque calcul.
- Afficher la variation nette avant de parler de bénéfice estimé.
- Ne pas appeler « profit réel » un résultat qui ne repose pas sur un coût d'acquisition historique.
- Concevoir chaque écran pour répondre à trois questions : où va l'argent, qui crée de la valeur et qui présente un risque ?

### Journal des évolutions

- **2026-09-25 — Phase 2B** : la fiche utilisateur admin expose les KPI principaux, la performance par actif, la valeur USD, les transactions et les flags de risque. `lib/user-performance.ts` classe désormais les flux de rewards, fees, jeux, transferts, swaps et prêts, avec une valorisation USD par actif.
- **2026-09-25 — Phase 2C suivante** : ajouter les raisons de score, les fenêtres 7/30/90 jours, le ratio dépôt/retrait et les filtres d'investigation avant de commencer les cohortes et la LTV.
