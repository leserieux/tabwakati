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
