# En attente : lib/metrics/financial.ts

Fichier fourni dans « tabwakati-maj-complet.zip » mais **non intégré** : il importe `./pricing`, `./rules` et `./types`
(le module `lib/metrics` du refactoring « KPI centralisés »), absents de l'archive. Avec lui, `tsc` échoue (3 modules introuvables
et 2 erreurs de type aux lignes 126 et 129) et Vercel refuserait le déploiement. Aucune page ne l'utilise encore.
À réintégrer en `lib/metrics/financial.ts` avec `pricing.ts`, `rules.ts`, `types.ts` (et l'index éventuel) dans le même commit.
