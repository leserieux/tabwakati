# Architecture

## Vue d'ensemble

```
wakati-admin/
├── src/
│   ├── app/                  Routes Next.js (App Router). Fines : affichage + appel d'un module.
│   │   ├── login/            Connexion
│   │   ├── api/              login, logout, exports CSV, collecte on-chain, cron (se protègent elles-mêmes)
│   │   └── dashboard/        44 pages derrière le middleware ; UN seul layout (menu + onglets de section)
│   ├── components/           Interface partagée : ui.tsx (briques), nav, onglets, formulaires de réglages
│   ├── core/                 Socle transverse, sans logique métier
│   │   ├── auth/             Jeton de session, rôles/permissions, comptes nominatifs, gardes, vérification Edge
│   │   ├── db/               Client Supabase (unique), requêtes tolérantes (`q`), lecture paginée (`fetchAll`), prix
│   │   └── …                 format, valuation (règle « prix ≤ 0 = non valorisé »), audit, navigation, pays
│   └── modules/              Logique métier, UN dossier par domaine (= une entrée du menu)
│       ├── treasury/         Combien je dois / je détiens / où est l'argent (couverture, réserve de retrait, collecte, staking)
│       ├── operations/       Transactions, filtres
│       ├── users/            Fiche utilisateur, cohortes, rétention, acquisition, rentabilité
│       ├── revenue/          Résultat (P&L), frais, tendances
│       ├── products/         Prêts (crédit), futures, P2P, roue
│       ├── wakati/           Jeton interne : prix, offre, burns, émission
│       ├── system/           Contrôles automatiques, push, bot Telegram
│       └── metrics/          KPI centralisés (règles de frais, valorisation) réutilisés par revenue/
├── tests/                    Tests unitaires de la logique pure (vitest) : `npm test`
├── mobile/                   App Flutter (hors dashboard) : voir mobile/README.md
├── supabase/migrations/      À remplir : schéma SQL, source de vérité (voir supabase/README.md)
├── docs/                     CONVENTIONS, CHANGELOG, SECURITE_FONCTIONS, archive/
└── vercel.json               Tâche planifiée quotidienne (/api/cron/risk-and-performance)
```

## Règles de dépendance

```
app/  ──►  modules/  ──►  core/
 │            │
 └──► components/        (components n'importe jamais un module métier)
```

- Une **page** lit via un module (`loadXxx()`), calcule peu, affiche. Dès qu'elle dépasse ~300 lignes ou contient des calculs, on extrait un module (exemple : `modules/products/credit.ts`).
- Un **module** ne connaît ni React ni Next ; il parle à la base via `core/db`. La logique pure (`computeFunding`, `computePlan`, `compare`…) est séparée du chargement pour être testée sans base.
- **core/** ne dépend d'aucun module.
- Tout import passe par l'alias `@/` (= `src/`). Pas de `../..`.

## Sécurité : qui vérifie quoi

| Couche | Fichier | Contrôle |
|---|---|---|
| Middleware (Edge) | `src/middleware.ts` + `core/auth/edge.ts` | `/dashboard/*` : jeton signé (HMAC-SHA256) et non expiré, sinon redirection vers `/login` |
| Layout | `app/dashboard/layout.tsx` | Revérifie le jeton côté Node, affiche le nom et le mode lecture seule |
| Actions serveur | `core/auth/session.ts` : `assertCan()` / `assertCanWrite()` | **Première ligne de chaque action** qui écrit : rôle et permission précise |
| Routes `/api/*` | `core/auth/guards.ts` : `getRequestSession()` | Non couvertes par le middleware : chacune se protège |
| Base | clé `service_role`, **serveur uniquement** | `core/db/supabase.ts` n'est jamais importé par un composant `"use client"` |

Rôles : `super_admin` (et l'ancien `admin`) = tout ; `finance`, `support`, `risk` = permissions ciblées ; `viewer` = lecture seule. Matrice : `core/auth/permissions.ts`.

## Ajouter une page (recette)

1. Logique : `src/modules/<domaine>/<sujet>.ts` avec `loadSujet()` (ne lève jamais : renvoie `error` en clair) et les calculs purs à côté.
2. Page : `src/app/dashboard/<url>/page.tsx` (`export const dynamic = "force-dynamic"`), composants de `@/components/ui`.
3. Menu : une ligne dans `src/core/nav-config.ts` (l'onglet apparaît tout seul, aucun layout à créer).
4. Écriture : une action serveur dans `actions.ts` à côté, `assertCan("…")` en première ligne, trace dans `core/audit.ts`.
5. Test : `tests/<sujet>.test.ts` sur la logique pure.
6. Respecter [CONVENTIONS.md](CONVENTIONS.md) (actifs, frais, glossaire).

## Correspondance des anciens chemins

Les anciennes entrées du [CHANGELOG](CHANGELOG.md) citent ces chemins.

| Ancien | Nouveau |
|---|---|
| `lib/auth.ts` | `src/core/auth/auth.ts` |
| `lib/session.ts` | `src/core/auth/session.ts` |
| `lib/permissions.ts` | `src/core/auth/permissions.ts` |
| `lib/admin-accounts.ts` | `src/core/auth/admin-accounts.ts` |
| `lib/audit.ts` | `src/core/audit.ts` |
| `lib/supabase.ts` | `src/core/db/supabase.ts` |
| `lib/data.ts` | `src/core/db/data.ts` |
| `lib/format.ts` | `src/core/format.ts` |
| `lib/valuation.ts` | `src/core/valuation.ts` |
| `lib/countries.ts` | `src/core/countries.ts` |
| `lib/nav-config.ts` | `src/core/nav-config.ts` |
| `lib/assets.ts` | `src/modules/treasury/assets.ts` |
| `lib/asset-view.ts` | `src/modules/treasury/asset-view.ts` |
| `lib/solvency.ts` | `src/modules/treasury/solvency.ts` |
| `lib/custody.ts` | `src/modules/treasury/custody.ts` |
| `lib/custody-policy.ts` | `src/modules/treasury/custody-policy.ts` |
| `lib/custody-plan.ts` | `src/modules/treasury/custody-plan.ts` |
| `lib/funding.ts` | `src/modules/treasury/funding.ts` |
| `lib/funding-core.ts` | `src/modules/treasury/funding-core.ts` |
| `lib/chain.ts` | `src/modules/treasury/chain.ts` |
| `lib/deposits.ts` | `src/modules/treasury/deposits.ts` |
| `lib/pawapay.ts` | `src/modules/treasury/pawapay.ts` |
| `lib/last-known.ts` | `src/modules/treasury/last-known.ts` |
| `lib/staking-plan.ts` | `src/modules/treasury/staking-plan.ts` |
| `lib/staking-plan-data.ts` | `src/modules/treasury/staking-plan-data.ts` |
| `lib/transactions.ts` | `src/modules/operations/transactions.ts` |
| `lib/user-analytics.ts` | `src/modules/users/user-analytics.ts` |
| `lib/user-decision.ts` | `src/modules/users/user-decision.ts` |
| `lib/user-performance.ts` | `src/modules/users/user-performance.ts` |
| `lib/user-profit.ts` | `src/modules/users/user-profit.ts` |
| `lib/cohorts.ts` | `src/modules/users/cohorts.ts` |
| `lib/platform-analytics.ts` | `src/modules/users/platform-analytics.ts` |
| `lib/acquisition.ts` | `src/modules/users/acquisition.ts` |
| `lib/pnl.ts` | `src/modules/revenue/pnl.ts` |
| `lib/fees.ts` | `src/modules/revenue/fees.ts` |
| `lib/trends.ts` | `src/modules/revenue/trends.ts` |
| `lib/futures.ts` | `src/modules/products/futures.ts` |
| `lib/p2p.ts` | `src/modules/products/p2p.ts` |
| `lib/wheel-audit.ts` | `src/modules/products/wheel-audit.ts` |
| `lib/wakati.ts` | `src/modules/wakati/wakati.ts` |
| `lib/burns.ts` | `src/modules/wakati/burns.ts` |
| `lib/emission.ts` | `src/modules/wakati/emission.ts` |
| `lib/controls.ts` | `src/modules/system/controls.ts` |
| `lib/push.ts` | `src/modules/system/push.ts` |
| `lib/telegram.ts` | `src/modules/system/telegram.ts` |
| `lib/metrics/*` | `src/modules/metrics/*` |
| `lib/**/*.dart`, `pubspec.yaml`, `web/`, `assets/`, `docs/flutter/` | `mobile/…` |
| `app/dashboard/logout-button.tsx` | `src/components/logout-button.tsx` |
| `app/…`, `components/…`, `middleware.ts` | `src/app/…`, `src/components/…`, `src/middleware.ts` |
