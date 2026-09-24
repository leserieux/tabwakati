# Règle importante pour les actifs

Les écrans génériques d'administration traitent **tous les actifs de la même manière**. `WAKATI` est un actif interne à l'application, mais il n'est pas une exception dans les vues générales : il doit apparaître comme les autres actifs dès qu'il est présent dans `supported_assets` et dans les soldes, réserves, passifs ou transactions.

## Règles pour les développeurs et les agents IA

- Ne jamais coder en dur `WAKATI` (ou un autre symbole) dans une page générique comme la vue d'ensemble, les utilisateurs, les transactions, la solvabilité, la liquidité ou les rapports.
- Pour afficher les actifs, lire `supported_assets` et utiliser `asset_symbol` comme clé de regroupement.
- Pour les soldes utilisateurs, agréger `user_balances` par `asset_symbol`, puis valoriser chaque actif séparément avec `asset_prices`.
- Ne jamais additionner des quantités de plusieurs actifs différents. Les totaux multi-actifs doivent être exprimés en USD (ou présentés ligne par ligne).
- La couverture de trésorerie doit être calculée actif par actif : un excédent sur un actif ne compense pas un déficit sur un autre.
- Si un nouvel actif est ajouté à la configuration des actifs, il doit être découvert automatiquement par les écrans génériques, sans modification de code ni ajout d'une condition spécifique.
- Les pages spécialisées d'un actif sont autorisées uniquement pour ses fonctionnalités propres (par exemple tokenomics ou staking), mais elles ne doivent pas contaminer les pages générales.

Le chargeur partagé `lib/assets.ts` fournit l'agrégation générique des soldes utilisateurs pour les écrans d'administration.

