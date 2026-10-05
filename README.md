<!-- markdownlint-disable MD033 -->
# WAKATI Dashboard — Refactorisation de l'Architecture des KPI

## État du Projet

**Dernier commit :** Migration architecture métier centralisée  
**Status :** En cours de validation  
**Dernière mise à jour :** 2026-10-05

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

## 📋 Roadmap Complète & État d'Avancement

### Phase 1 : Base de la Couche Métrique ✅

#### 1.1 Types centralisés (`lib/metrics/types.ts`) ✅
- [x] Types pour tous les KPI
- [x] Interfaces `OverviewMetrics`, `FinancialMetrics`, `AnalyticsMetrics`, `AssetsMetrics`
- [x] Types unifiés pour toutes les pages

**Commit :** `99c382b1d80dd545464fb0f449936d4289abc6b2`

#### 1.2 Pricing centralisé (`lib/metrics/pricing.ts`) ✅
- [x] `isValidPrice()` — validation stricte des prix
- [x] `valueUsd()` — conversion en USD avec validation
- [x] `computeCoverage()` — calcul de couverture actif par actif
- [x] `DAY_MS`, `lastDaysKeys()` — utilitaires de temps

**Commit :** `818858d42e84e276e54b881320578feedd78f587`

#### 1.3 Query layer (`lib/metrics/query.ts`) ✅
- [x] `fetchPaged()` — pagination sécurisée Supabase
- [x] `loadPriceMap()` — résolution centralisée des prix
- [x] `loadUserAssetRows()` — lecture soldes utilisateurs
- [x] `loadSupportedAssets()` — liste des actifs actifs

**Commit :** `b44cf64f50198a6c17f1b5135364c149d8238c7b`

#### 1.4 Export index (`lib/metrics/index.ts`) ✅
- [x] Point d'entrée centralisé du module

**Commit :** `a46a5b20d76bf27e9f11f6489ddf1c16ed03aef6`

---

### Phase 2 : Services Métier ✅

#### 2.1 Overview metrics (`lib/metrics/overview.ts`) ✅
- [x] `loadOverviewMetrics()` — agrégation Vue d'ensemble
  - [x] `users` : total, actifs 7d, nouveaux 7d
  - [x] `liquidity` : heldUsd, owedUsd, coverage%, unpriced
  - [x] `volume` : volume7d, volume24h, transactions, gameWagered
  - [x] `fees` : totalUsd, byAsset, unpriced
  - [x] `risk` : loansAtRisk, pending, stuck, failed, reconciliation issues

**Commit :** `8964e04eeb2711f39286be01ae0883d8139ee910`

#### 2.2 Financial metrics (`lib/metrics/financial.ts`) ✅
- [x] `loadFinancialMetrics()` — P&L et décisions
  - [x] `byCat` : fees, game_bets, game_wins, staking, referral, defaults
  - [x] Séparation real / wakati / total
  - [x] `monthlyBreakdown` : 12 derniers mois
  - [x] `signals` : décisions automatiques
  - [x] `treasury` : soldes actuels

**Commit :** `9a48e03253a766c7269a30e5c051624d37ba1005`

#### 2.3 Analytics metrics (`lib/metrics/analytics.ts`) ✅
- [x] `loadAnalyticsMetrics()` — KPI utilisateurs
  - [x] `cashflow` : deposits, withdrawals, net
  - [x] `fees` : totalUsd, détail platform_fees
  - [x] `users` : total, actifs 30d, atRisk
  - [x] `topUsers` : top 25 par valeur

**Commit :** `d680b71ab2721b1083da0135db6435d4984b69a6`

---

### Phase 3 : Migration UI ✅

#### 3.1 Overview page (`app/dashboard/page.tsx`) ✅
- [x] Migration vers `loadOverviewMetrics()`
- [x] Remplacement logique inline par service centralisé
- [x] Affichage inchangé, source unifiée

**Commit :** `d2ed9300b33e548882439169db35b8cf17a6f19f`

#### 3.2 P&L page (`app/dashboard/pnl/page.tsx`) ⏳ **À FAIRE**
- [ ] Migration vers `loadFinancialMetrics()`
- [ ] Remplacement logique P&L par service
- [ ] Alignement des signaux et périodes

#### 3.3 Analytics page (`app/dashboard/analytics/page.tsx`) ⏳ **À FAIRE**
- [ ] Migration vers `loadAnalyticsMetrics()`
- [ ] Remplacement cashflow / fees / risques par service
- [ ] Alignement top users

#### 3.4 Autres pages ⏳ **À FAIRE**
- [ ] `app/dashboard/liquidity/page.tsx` — utiliser `liquidity` de metrics
- [ ] `app/dashboard/credit/page.tsx` — utiliser `risk` de metrics
- [ ] `app/dashboard/markets/page.tsx` — utiliser `fees` de metrics
- [ ] autres pages dashboard

---

### Phase 4 : Nettoyage & Validation ⏳ **À FAIRE**

#### 4.1 Suppression des doublons ⏳
- [ ] Retirer logique de `loadPnl()` si remplacée par `loadFinancialMetrics()`
- [ ] Retirer logique de `loadUserAssetSummaries()` si remplacée par metrics
- [ ] Vérifier qu'aucune page n'a de calcul inline restant

#### 4.2 Validation des chiffres ⏳
- [ ] Vérifier que tous les KPI affichés === ancienne version
- [ ] Vérifier que pas d'alerte / warning nouvelles
- [ ] Vérifier que pas de break visuel

#### 4.3 Tests & Documentation ⏳
- [ ] Documentation des règles métier dans les types
- [ ] Commentaires explicites sur les filtres (is_test, game_net_loss, etc.)
- [ ] Guide d'utilisation de la couche métrique pour les futures pages

#### 4.4 Commit final ⏳
- [ ] Tous les changements validés
- [ ] README mis à jour

---

## 🔍 Règles Métier Centralisées

### Validation des Prix
```typescript
// Un prix est valide uniquement si :
- typeof === "number"
- Number.isFinite(p) === true
- p > 0

// Sinon : null, non valorisé, signalé en alerte
```

### Couverture / Treasury
```typescript
// Jamais de mélange de quantités (actif par actif)
// Agrégation en USD seulement via computeCoverage()
// Règle : coveredUsd = min(heldUsd, owedUsd) par actif
```

### P&L / Catégories
```typescript
// Catégories strictes :
- fees (entrée, +1) : hors jeux, hors test, hors game_net_loss
- game_bets (entrée, +1) : mises joueurs
- game_wins (sortie, -1) : gains payés
- staking (sortie, -1) : récompenses
- referral (sortie, -1) : bonus parrainage
- defaults (sortie, -1) : prêts en défaut

// Séparation :
- real = tous actifs sauf WAKATI
- wakati = WAKATI uniquement
- total = real + wakati
```

### Volume / Activité
```typescript
// Volume réel = dépôts + retraits + swaps + transferts (réussis)
// Exclut : jeux (comptés séparément en gamesWagered7d)
// Fenêtre : 7 jours glissants (UTC)
```

### Fees / Commissions
```typescript
// Source : platform_fees table
// Filtres : is_test=false, fee_type NOT IN (game_house_edge, game_net_loss)
// Valorisation : prix actuel pour tous actifs, null si pas de prix
```

---

## 📁 Structure Finale

```
lib/
├── metrics/
│   ├── types.ts           ✅ Contrats de données
│   ├── pricing.ts         ✅ Validation & conversion USD
│   ├── query.ts           ✅ Requêtes Supabase
│   ├── overview.ts        ✅ Vue d'ensemble
│   ├── financial.ts       ✅ P&L & trésorerie
│   ├── analytics.ts       ✅ KPI utilisateurs
│   ├── assets.ts          ⏳ À créer (soldes par actif)
│   └── index.ts           ✅ Export centralisé
├── pnl.ts                 ⚠️ À remplacer par financial.ts
├── assets.ts              ⚠️ À remplacer par metrics/assets.ts
├── valuation.ts           ✅ Réutilisé par metrics
└── data.ts                ✅ Réutilisé par metrics

app/dashboard/
├── page.tsx               ✅ Migré vers loadOverviewMetrics()
├── pnl/page.tsx           ⏳ À migrer vers loadFinancialMetrics()
├── analytics/page.tsx     ⏳ À migrer vers loadAnalyticsMetrics()
└── ...autres pages        ⏳ À analyser & migrer
```

---

## ✅ Prochaines Étapes (Pour IA ou Développeur)

### Immédiat
1. **Valider la build** :
   ```bash
   npm install
   npm run build
   ```
   Vérifier qu'aucune erreur TypeScript / runtime

2. **Tester le dashboard** :
   - Aller sur `/dashboard`
   - Vérifier que les chiffres sont affichés correctement
   - Comparer avec l'ancienne version si possible

### Court terme
3. **Migrer P&L page** :
   - Remplacer logique inline par `loadFinancialMetrics()`
   - Vérifier que les chiffres === ancienne version
   - Supprimer logique dupliquée

4. **Migrer Analytics page** :
   - Remplacer logique inline par `loadAnalyticsMetrics()`
   - Vérifier cohérence

### Moyen terme
5. **Créer assets.ts** :
   - Agrégations soldes par actif
   - Couverture unifiée
   - Réutiliser dans toutes les pages

6. **Nettoyer les doublons** :
   - Supprimer `lib/pnl.ts` si `financial.ts` le remplace
   - Supprimer `lib/assets.ts` si `metrics/assets.ts` le remplace

7. **Migrer autres pages** :
   - liquidity, credit, markets, etc.
   - Utiliser les services centralisés

### Validation finale
8. **Audit des KPI** :
   - Vérifier que toutes les pages affichent les mêmes chiffres
   - Pas de contradictions
   - Alertes cohérentes

---

## 📝 Changements Apportés

### Fichiers Créés
- `lib/metrics/types.ts`
- `lib/metrics/pricing.ts`
- `lib/metrics/query.ts`
- `lib/metrics/overview.ts`
- `lib/metrics/financial.ts`
- `lib/metrics/analytics.ts`
- `lib/metrics/index.ts`

### Fichiers Modifiés
- `app/dashboard/page.tsx` — Now uses `loadOverviewMetrics()`

### Fichiers Inchangés (Toujours en Usage)
- `lib/valuation.ts` — Réutilisé par metrics
- `lib/data.ts` — Réutilisé par metrics
- `lib/format.ts` — Réutilisé pour l'affichage
- `lib/pnl.ts` — **À remplacer progressivement**
- `lib/assets.ts` — **À remplacer progressivement**

### Fichiers Obsolètes (À Nettoyer Plus Tard)
- Aucun pour le moment

---

## 🚀 Résultat Attendu

✅ **Dashboard cohérent** : mêmes chiffres partout  
✅ **Pas de duplication** : une seule source de vérité par KPI  
✅ **Maintenable** : nouvelle règle métier = un endroit à changer  
✅ **Testable** : services séparés peuvent être testés indépendamment  
✅ **Extensible** : ajouter une nouvelle page = juste appeler un service

---

## 📞 Support

Pour toute question sur la logique métier, consulter :
- `lib/metrics/types.ts` — Contrats de données
- Commentaires dans chaque service (`overview.ts`, `financial.ts`, etc.)
- README des règles métier (ce fichier)
