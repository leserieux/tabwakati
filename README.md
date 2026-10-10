# Règle importante pour les actifs

Les écrans génériques d'administration traitent **tous les actifs de la même manière**. `WAKATI` est un actif interne à l'application, mais il n'est pas une exception dans les vues générales.

## Règles pour les développeurs et les agents IA

- Ne jamais coder en dur `WAKATI` dans une page générique.
- Utiliser `supported_assets` et `asset_symbol` comme clé de regroupement.
- Agréger `user_balances` actif par actif et valoriser avec `asset_prices`.
- Ne jamais additionner des quantités d'actifs différents ; les agrégats multi-actifs sont en USD.
- La couverture de trésorerie est calculée actif par actif.
- Les pages génériques découvrent automatiquement les nouveaux actifs.

## Roadmap

- [x] Phase 1 — Socle analytique et historique des scores.
- [x] Phase 2 — Fiche utilisateur, KPI, performance par actif et risques.
- [x] Phase 2C — Fenêtres 7/30/90 jours et décision narrative.
- [x] Phase 3A — Fondation cohortes et analytics plateforme.
- [x] Phase 3B — Page analytics visible, alimentée uniquement par les tables réelles : `users`, `user_balances`, `transactions`, `asset_prices`, `platform_fees`, `user_risk_score_history`.
- [ ] Phase 3C — Cohortes, churn, LTV et monétisation.
- [ ] Phase 4 — Coût historique d'acquisition et P&L réel.

## Règles d'implémentation

- Le schéma réel et les fonctions publiques du dossier `supabase/migrations` sont la source de vérité.
- Aucune page ne doit dépendre d'une vue SQL non déployée.
- Le design existant du dashboard est conservé.
- Toute valeur multi-actifs affichée est valorisée en USD.
- La variation nette et la performance comptable ne sont jamais présentées comme un P&L réel.

## Journal

- 2026-09-25 — Mise en place du dashboard analytics visible et correction des dépendances SQL pour utiliser uniquement les relations existantes.
- 2026-10-03 — Navigation ramenée à 8 entrées avec onglets de section (`lib/nav-config.ts`, `components/section-tabs.tsx`) ; « Activité » fusionnée dans la Vue d'ensemble (redirection conservée) ; valorisation centralisée dans `lib/valuation.ts` (un prix <= 0 n'est plus un prix : l'actif est signalé « non valorisé ») ; compteur de tours de roue recompté depuis `wheel_spins` ; trigger de total staké rebranché.
- 2026-10-03 (2) — Prix résolus via `asset_prices_resolved` (USDC-ETH/POL n'avaient aucun prix côté dashboard) ; « Flux réels » via `admin_volume_daily` (l'ancien volume additionnait mises, gains, récompenses, frais et transactions échouées) ; lectures paginées (`fetchAll`, plafond PostgREST de 1000 lignes) ; frais analytics hors tests et `game_net_loss` ; `coingecko-price` : taux fiat automatiques (FCFA, CDF) et un prix invalide n'écrase plus le dernier bon prix.
- 2026-10-03 (3) — Frais : ils n'étaient pas corrompus, plusieurs lecteurs SQL additionnaient les lignes de test et `game_net_loss`. Lecteurs corrigés (voir migration `fix_fee_readers_exclude_test_and_net_loss`), aucune ligne supprimée.
- 2026-10-03 (4) — 449 lignes de test `trading_service` supprimées de `platform_fees` ; `get_admin_dashboard` réparée ; `take_admin_snapshot` réparée (échouait silencieusement chaque nuit).
- 2026-10-03 (5) — Nouvelle page `/dashboard/fees` (onglet « Frais » dans Trésorerie) : total réel, 7/30 jours, par type, par actif, par mois ; exclut les lignes de test et `game_net_loss` ; logique dans `lib/fees.ts`.
- 2026-10-03 (6) — `lib/wakati.ts` : tous les pools de staking WAKATI sont agrégés (total staké, stakers, récompenses) au lieu de lire un seul pool (`limit(1)`). `game_net_loss` conservé (utilisé par fn_score_credit_capacity).
- 2026-10-04 — Page Utilisateurs : indicateurs globaux (total, actifs 7 j via transactions, nouveaux 7 j, email confirmé, dossiers KYC) au lieu de compteurs calculés sur la page affichée ; « Vérifiés » (toujours 0, KYC inutilisé) remplacé ; pastille KYC dans la fiche utilisateur. Vues `admin_treasury_dashboard` / `admin_transactions_overview` sur prix résolus.
- 2026-10-05 — Nouvelle page `/dashboard/pnl` (« Résultat ») : compte de résultat par période (7/30/90 j/tout), séparation argent réel / WAKATI, mois par mois, signaux de décision (rendement joueur, staking, prix WAKATI, réserve), trésorerie actuelle ; logique dans `lib/pnl.ts`. « Marge des jeux » renommée « Mises encaissées (brut, jeux) » ; alerte de résultat négatif sur la Vue d'ensemble ; classes `.wk-ok` / `.wk-bad` ajoutées (elles n'existaient pas : les couleurs de la couverture ne s'appliquaient jamais).
- 2026-10-05 (2) — Erreur corrigée : le trigger `trg_sync_pool_total` (migration du 2026-10-03) faisait double emploi avec `fn_stake`/`fn_unstake` et décalait le total du pool (+300) ; supprimé et total remis à la valeur exacte. Nouveaux écrans : `/dashboard/controls` (25 contrôles automatiques via `admin_run_controls()`, alerte sur la Vue d'ensemble), `/dashboard/pnl/depots` (entonnoir et causes d'échec des dépôts), `/dashboard/pnl/roue` (rendement théorique contre observé, test d'équité), `/dashboard/pnl/utilisateurs` (rentabilité par utilisateur, parrainage). Tâches planifiées mortes retirées ; vue matérialisée `admin_asset_dashboard` fermée à anon/authenticated.
- 2026-10-07 — Journalisation des swaps : `execute_swap_realtime` écrit désormais `swap_in` / `swap_out` dans `treasury_ledger` (voir migration `20261007_swap_ledger_journaling.sql`) ; contrôles de trésorerie fiabilisés (continuité du journal, indépendante de l'ordre des écritures) ; nouveau contrôle de sécurité « fonctions utilisateur protégées contre l'usurpation » (20 fonctions ouvertes à la clé publique, à corriger) ; page Liquidité : libellés des nouveaux types d'écriture.
- 2026-10-08 — Système de burn de la cagnotte jackpot (BROUILLON, non appliqué en base) : `supabase/migrations/20261008_jackpot_burn_system.sql` (fonction `fn_daily_jackpot_burn`, cron 00:20 UTC, s'appuie sur `fn_burn_tokens`, burns en `pending_onchain`) + page `/dashboard/wakati/burns` (suivi, confirmation on-chain par hash, burn manuel). À tester dans une transaction annulée avant application.
- 2026-10-09 — Sécurité (préparation, rien d'appliqué en base) : `docs/SECURITE_FONCTIONS.md` (52 fonctions SECURITY DEFINER sans contrôle d'identité, classées par gravité), `supabase/scripts/verifier_exposition_fonctions.sql` (vérification en lecture seule), `supabase/migrations/20261009_security_hardening_DRAFT.sql` (plan en 3 étapes, brouillon non testé).
- 2026-10-10 — Mise à jour intégrée (« tabwakati-maj-complet ») : règle de frais unifiée (hors test, hors `game_house_edge`, hors `game_net_loss` ; les mises des jeux restent dans le Résultat) dans `lib/fees.ts`, la page Frais et la fonction SQL `get_platform_fees_totals` ; couverture de Trésorerie et Liquidité via `computeCoverage` ; page Crédit via `admin_loans_dashboard.prets_a_risque` corrigée ; page Jeux : taux de sortie de la roue sur 30 jours glissants (migration `20261010_align_db_with_dashboard_rules.sql`, déjà appliquée et vérifiée). `lib/metrics/financial.ts` mis de côté dans `docs/en_attente/` (dépendances absentes).
- 2026-10-10 (2) — Sécurité appliquée en base : gardes d'identité (`assert_caller_is`) sur 10 fonctions appelées par l'app, `fn_award_engagement_points` et `execute_wheel_spin` réservées au serveur ; edge function `spin-wheel` v37 (appel de la roue avec la clé serveur).
- 2026-10-10 (3) — Burn WAKATI, règle du seuil : tant que le prix du WAKATI est sous `burn_settings.burn_start_price_fcfa` (1 FCFA), aucun burn et 100 % du bénéfice net va dans la caisse (`wakati_reserve_state`) ; à partir du seuil, `burn_share_pct` % (30 par défaut) du bénéfice net positif du jour est brûlé, le reste va dans la caisse ; jour de perte : pas de burn. Un seul bénéfice net par jour (`fn_compute_wakati_daily_price`, 00:10 UTC), enregistré dans `wakati_price_history.burn_allocation_usd` ; `fn_run_burn` (00:20 UTC) brûle ce qui n'est pas encore réglé (`burn_settled_at`) avec les garde-fous existants (1 % de la trésorerie par jour, minimum 1 WAKATI, report du reste). `fn_wakati_burn_status()` donne l'état ; `burn_rules` et `fn_burn_compute` ne sont plus utilisés. Page `/dashboard/wakati/burns` : prix en FCFA vs seuil, caisse, derniers passages, burns à confirmer on-chain. Migration `20261010_wakati_burn_threshold_single_pot.sql` (appliquée).
- 2026-10-10 (4) — Réglages du burn dans le dashboard : `/dashboard/wakati/burns` > « Réglages » (seuil de prix en FCFA, part brûlée, plafonds en % de trésorerie et en WAKATI/jour, burn minimum, trésorerie à conserver, activation) et carte « Caisse et prix » (part versée à la caisse, variation max, prix plancher, calcul actif) ; validation côté serveur, contraintes CHECK en base, audit avant/après (`burn.settings.update`, `settings.wakati_reserve_state.update`). `wakati_price_history` : anon et authenticated ne lisent plus que `id, computed_for_date, price_before_usd, final_price_usd, created_at` (bénéfice net, réserve, offre et burn réservés au service_role) ; un `select *` sur cette table côté app échoue désormais, il faut lister les colonnes. Migration `20261010_wakati_history_privileges_and_settings_checks.sql` (appliquée).
- 2026-10-10 (5) — Nouvelle page `/dashboard/wakati/offre` (onglet WAKATI > Offre, entrée ajoutée dans `lib/nav-config.ts`) : plafond de l'offre, émissions par source (staking, parrainage, gains aux jeux) sur 30 jours et en moyenne mensuelle sur 90 jours, mises qui reviennent, émission nette, tenue de la trésorerie, repère de budget (0,5 % de la trésorerie par mois, **affiché mais pas appliqué automatiquement**), état de la règle de burn, sensibilité du prix aux distributions, résumé factuel pour investisseur. Aucune création de WAKATI par la plateforme ; à vérifier sur PolygonScan : le contrat ne doit pas avoir de fonction `mint`, sinon l'offre n'est pas réellement plafonnée.
