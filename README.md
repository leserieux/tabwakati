<!-- markdownlint-disable MD033 -->
# WAKATI Dashboard — Refactorisation de l'Architecture des KPI

## État du Projet

**Dernier commit :** Migration architecture métier centralisée + correctifs du 2026-10-06  
**Status :** Code corrigé, **à valider par un `npm run build`** (non exécuté dans l'environnement de correction : pas de réseau)  
**Dernière mise à jour :** 2026-10-06

## ⚙️ Problème Initial

Le dashboard présentait des **données contradictoires** entre les pages :
- **Vue d'ensemble**, **P&L**, **Analytics** recalculaient les mêmes KPI différemment
- les règles de **prix/valorisation** étaient dispersées
- les **filtres de données** (frais, jeux, test) n'étaient pas uniformisés
- les calculs de **couverture/trésorerie** avaient plusieurs variantes
- pas de source de vérité unique pour les métriques

## 🎯 Objectif du Refacto

Centraliser **tous les KPI du dashboard** dans un module métier unique (`lib/metrics`) qui :
- unifie les règles de calcul
- supprime la duplication de logique
- rend les pages UI responsables seulement de l'affichage
- élimine les contradictions entre pages

---

## 📋 Roadmap & état d'avancement

### Phase 1 : Base de la couche métrique ✅
- [x] `lib/metrics/types.ts` — types de tous les KPI
- [x] `lib/metrics/pricing.ts` — `isValidPrice`, `valueUsd`, `computeCoverage`, `sumUsd` (typage corrigé)
- [x] `lib/metrics/query.ts` — pagination et prix
- [x] `lib/metrics/rules.ts` — **nouveau** : règles partagées (types de frais exclus, filtre PostgREST)
- [x] `lib/metrics/index.ts` — exporte **toute** la couche (il manquait `financial`, `analytics`, ce qui cassait le build de `/dashboard/pnl`)

### Phase 2 : Services métier ✅
- [x] `overview.ts` — `loadOverviewMetrics()` ; renvoie aussi `assets`, `activeAssetCount`, `recentTransactions`; `emailConfirmed` et `kycCompleted` sont désormais réels ; lectures paginées (plus de plafond silencieux à 1000 lignes)
- [x] `financial.ts` — `loadFinancialMetrics()` ; corrigé : période « Depuis le début » (0) n'était pas honorée (`|| 30`), `treasury` / `treasuryUsd` manquaient dans le retour, textes des signaux restaurés à l'identique de l'ancien `loadPnl`
- [x] `analytics.ts` — `loadAnalyticsMetrics()` ; filtre de frais unifié, prix manquants listés (`unpriced`) au lieu d'être comptés à 0 $, historique de risque paginé
- [x] `assets.ts` — **nouveau** : `loadAssetsMetrics()` (soldes utilisateurs + trésorerie, actif par actif)
- [x] `fees.ts` — **nouveau** : `loadFeeTotalsByAsset()` (remplace la RPC `get_platform_fees_totals`)

### Phase 3 : Migration UI
- [x] 3.1 `app/dashboard/page.tsx` — tableau « Actifs des utilisateurs », « Actifs suivis » et « Dernières transactions » **réalimentés** (ils étaient figés à vide / 0 après la première migration)
- [x] 3.2 `app/dashboard/pnl/page.tsx` — sur `loadFinancialMetrics()`
- [x] 3.3 `app/dashboard/analytics/page.tsx` — sur `loadAnalyticsMetrics()`
- [~] 3.4 Autres pages
  - [x] `users` et `markets` : lisent les soldes via `lib/assets.ts`, désormais un simple adaptateur de `loadAssetsMetrics()`
  - [ ] `liquidity` et `treasury` : utilisent `lib/custody.ts` (on-chain) + calculs inline de couverture → à migrer vers `computeCoverage` / `loadAssetsMetrics().treasury`
  - [ ] `credit` : calculs inline → à migrer vers `risk` de metrics
  - [ ] `fees` : `lib/fees.ts` garde son propre filtre (volontaire : cette page détaille aussi `game_house_edge`)
  - [ ] `games`, `wakati/*`, `users/[id]` : hors périmètre KPI pour l'instant

### Phase 4 : Nettoyage & validation
- [x] 4.1 `lib/pnl.ts` supprimé (remplacé par `financial.ts`, parité vérifiée ligne à ligne) ; `lib/assets.ts` réduit à un adaptateur déprécié
- [ ] 4.2 **Validation des chiffres — à faire par vous** (voir checklist ci-dessous)
- [ ] 4.3 Tests & documentation : commentaires de règles ajoutés dans `rules.ts`, `fees.ts`, `assets.ts`, `analytics.ts` ; tests unitaires non écrits
- [ ] 4.4 Commit final après validation

---

## 🔍 Règles métier centralisées

### Validation des prix
Un prix est valide uniquement s'il est un nombre fini et `> 0` (`isValidPrice`). Sinon : valeur `null`, actif listé dans `unpriced`, **jamais compté à 0 $ en silence**.

### Couverture / trésorerie
Jamais de mélange de quantités : calcul actif par actif, agrégation en USD via `computeCoverage()`. `coveredUsd = min(heldUsd, owedUsd)` par actif.

### Frais (règle unique : `lib/metrics/rules.ts`)
Source : `platform_fees`. Exclus : `is_test = true`, `game_house_edge` (déjà dans les mises), `game_net_loss` (signal de crédit).
> ⚠️ La fonction SQL `get_platform_fees_totals()` n'excluait que `game_net_loss`. Dans la base actuelle, `game_house_edge` pèse 33 533,75 (unités natives) sur 377 lignes : l'ancienne Vue d'ensemble affichait donc des frais gonflés par rapport au P&L. Le code ne l'utilise plus ; une migration **optionnelle** pour aligner la base est fournie : `supabase/migrations/20261006_OPTIONNEL_align_platform_fees_totals_with_kpi_rules.sql` (non appliquée).

### P&L / catégories
`fees` (+), `game_bets` (+), `game_wins` (−), `staking` (−), `referral` (−), `defaults` (−). Séparation `real` (tout sauf WAKATI) / `wakati` / `total`.

### Volume / activité
Volume réel = dépôts + retraits + swaps + transferts réussis, hors jeux (comptés dans `gamesWagered7d`). Fenêtre : 7 jours glissants UTC.

---

## 📁 Structure

```
lib/metrics/
├── types.ts       contrats de données
├── rules.ts       règles partagées (frais)
├── pricing.ts     validation prix & conversion USD
├── query.ts       requêtes Supabase / pagination
├── fees.ts        frais par actif (règle unique)
├── assets.ts      soldes utilisateurs + trésorerie par actif
├── overview.ts    Vue d'ensemble
├── financial.ts   P&L & trésorerie
├── analytics.ts   KPI utilisateurs
└── index.ts       export centralisé
lib/assets.ts      ⚠️ adaptateur déprécié (users, markets)
```

---

## ✅ Prochaines étapes

### Immédiat — valider
1. `npm install && npm run build` : aucune erreur TypeScript/runtime attendue. Si une erreur apparaît, elle est probablement locale (types Supabase) : corriger dans le fichier indiqué.
2. Checklist 4.2 (comparer avec l'ancienne version) :
   - `/dashboard` : « Actifs des utilisateurs » et « Dernières transactions » affichent des lignes ; « Actifs suivis » ≠ 0.
   - `/dashboard` « Frais cumulés » **va baisser** (fin de l'inclusion de `game_house_edge`) : c'est attendu, et doit maintenant égaler la ligne « Frais » du P&L sur « Depuis le début ».
   - `/dashboard/pnl?p=0` (« Depuis le début ») : doit maintenant réellement couvrir toute la période.
   - `/dashboard/analytics` : les frais baissent pour la même raison ; une alerte liste les actifs sans prix.
3. Appliquer (ou non) la migration SQL optionnelle.

### Court / moyen terme
4. Migrer `liquidity`, `treasury`, `credit` (voir 3.4), puis supprimer `lib/assets.ts` quand `users` et `markets` appelleront `loadAssetsMetrics()`.
5. Écrire des tests unitaires sur `computeCoverage`, `aggregate` (financial) et `isCountedFee`.

---

## 📝 Changements du 2026-10-06

**Créés** : `lib/metrics/rules.ts`, `fees.ts`, `assets.ts`, migration SQL optionnelle.
**Modifiés** : `lib/metrics/{index,types,pricing,overview,financial,analytics}.ts`, `lib/assets.ts` (adaptateur), `app/dashboard/{page,pnl/page,analytics/page}.tsx`, ce README.
**Supprimés** : `lib/pnl.ts`.
**Non modifiés** : `lib/valuation.ts`, `lib/data.ts`, `lib/format.ts`, `lib/fees.ts` (page Frais).

## 🚀 Résultat attendu
Dashboard cohérent (mêmes chiffres partout), une source de vérité par KPI, nouvelle règle métier = un seul endroit à changer (`lib/metrics/rules.ts`, `pricing.ts`).

## 📞 Support
Logique métier : `lib/metrics/types.ts`, `lib/metrics/rules.ts` et les commentaires de chaque service.
