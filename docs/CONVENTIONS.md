# Conventions et règles métier

Règles à respecter pour tout nouveau code (humain ou assistant IA). Elles viennent des erreurs déjà rencontrées : voir le [CHANGELOG](CHANGELOG.md).

## 1. Les actifs : tous traités pareil

Les écrans génériques traitent **tous les actifs de la même manière**. `WAKATI` est un actif interne, pas une exception dans les vues générales.

- Ne jamais coder `WAKATI` en dur dans une page générique.
- Clé de regroupement : `supported_assets` / `asset_symbol`.
- Agréger `user_balances` actif par actif, valoriser avec `asset_prices` (prix résolus via `asset_prices_resolved`).
- **Ne jamais additionner des quantités d'actifs différents** : tout agrégat multi-actifs est en USD.
- La couverture de trésorerie est calculée **actif par actif** (`modules/treasury/solvency.ts`).
- Un nouvel actif doit apparaître seul dans les pages génériques.
- Un prix ≤ 0 n'est pas un prix : l'actif est « non valorisé » (`core/valuation.ts`), jamais valorisé à 0.

## 2. Comptabilité

- **Frais réels** = hors lignes de test, hors `game_house_edge`, hors `game_net_loss`. Règle unique dans `modules/metrics/rules.ts` : ne pas la recopier.
- **Futures** : `futures_open_fee`, `futures_funding_fee`, `futures_close_fee` sont de vrais frais. `futures_settlement` est le résultat de trading : exclu des frais, compté dans le Résultat via les positions clôturées, une seule fois. Une marge immobilisée n'est pas une mise encaissée.
- Le Résultat valorise chaque flux au **prix du jour** (historique), au cours actuel seulement faute d'historique, avec la part concernée affichée.
- Une variation nette ou une performance comptable n'est **jamais** présentée comme un P&L réel.
- Lectures paginées : PostgREST plafonne à 1000 lignes. Utiliser `fetchAll` (`core/db/data.ts`), sinon les totaux sont faux sans aucune erreur.

## 3. Fiabilité des chiffres

- Un chiffre indisponible s'affiche « non disponible », jamais `0`.
- La dernière valeur connue (`modules/treasury/last-known.ts`) est une information, **jamais** utilisée dans un calcul.
- Une lecture on-chain en erreur n'est jamais mise en cache.
- Un même chiffre ne doit pas apparaître à deux endroits avec deux valeurs : réutiliser le calcul partagé (`solvency`, `asset-view`, `funding`).

## 4. Sécurité et argent

- **Première ligne de toute action serveur qui écrit** : `assertCan("…")` ou `assertCanWrite()` (`core/auth/session.ts`). Le middleware seul ne suffit pas.
- Toute route `/api/*` commence par `getRequestSession()` (`core/auth/guards.ts`).
- Toute action sensible est inscrite au journal d'audit (`core/audit.ts`), avec l'état avant/après.
- Le client `service_role` (`core/db/supabase.ts`) n'est **jamais** importé dans un composant `"use client"`.
- Le dashboard ne déplace aucun argent de lui-même : il calcule et alerte. La seule exception est la collecte réelle (`/api/sweep/run`), en simulation (`dryRun`) par défaut et réservée aux super-admins.
- **Aucune alerte de trésorerie par le bot Telegram** (public).
- Aucune clé privée dans le dépôt ni dans les variables du dashboard (adresses publiques uniquement).

## 5. SQL (Supabase)

- Le dossier `supabase/migrations` est la source de vérité du schéma. Aucune page ne dépend d'une vue SQL non déployée.
- **Avant tout `create or replace function`** : lire la définition en production (`pg_get_functiondef`) et la liste des migrations. Ne jamais redéfinir la fonction d'une autre migration (incident du 2026-11-09).
- Les fonctions `admin_*` sont réservées au `service_role` et en lecture seule.
- Un `select *` sur une table à colonnes réservées échoue : lister les colonnes (ex. `wakati_price_history`).

## 6. Interface

- Le design existant est conservé (`src/app/globals.css`). **Ne jamais remplacer `globals.css` par un fichier partiel.**
- Une page = un résumé (3-4 chiffres) + un tableau principal + des détails repliés. Pas plus de 3 blocs visibles d'emblée.
- Un mot par concept, en français simple :

| À utiliser | À proscrire |
|---|---|
| Collecte des dépôts | balayage, sweep |
| Réserve de retrait | custody |
| Couverture | solvabilité (dans les libellés visibles) |
| Écart entre soldes et mouvements | rapprochement, liability_diff |
| Staké sans position correspondante | staking_orphan |
| Prêt à surveiller | prêt à risque / LTV faible |
| Rétention & valeur | cohortes & LTV |
| Liquidité des échanges | liquidité (swap) |
| Dû aux utilisateurs / Détenu / Écart | passif / actif / delta |
