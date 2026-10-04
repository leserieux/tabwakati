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
