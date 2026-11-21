# Roadmap de restructuration du dashboard admin

Objectif : un dashboard d'administration du niveau de ceux de Binance, Coinbase ou Bybit. Un admin ouvre la console, comprend en 5 secondes si tout va bien, voit ce qu'il doit traiter, et retrouve n'importe quel chiffre en 2 clics.

## 1. Constat (état au 2026-11-19)

1. **Une même question était éclatée sur plusieurs pages.** « Ai-je assez d'argent ? » = 7 pages (Solvabilité, Réserve de retrait, Liquidité, Balayage, Plan staking, Dépôts, Frais). Le staking était à 3 endroits.
2. **Aucune entrée par actif**, alors que la règle de base du projet est de tout regrouper actif par actif.
3. **Vocabulaire de développeur** : « balayage » et « sweep » pour la même chose, « custody », « rapprochement », « staking_orphan », « stock non financé », « LTV »…
4. **Accueil surchargé** : une vingtaine de types d'alertes triées par couleur seulement, et un bloc « Aller à » qui recopiait la navigation.
5. **Pages sans hiérarchie** : Prêts 723 lignes / 6 tableaux, Futures 11 sections, Dépôts 9 sections / 8 tableaux, fiche utilisateur 9 sections.

## 2. Principes (ce que font les consoles admin des grands exchanges)

- **Navigation par tâche**, pas par table de base de données : Accueil, Trésorerie, Opérations, Utilisateurs, Revenus, Produits, WAKATI, Système.
- **Une entité = une fiche** qui rassemble tout : l'utilisateur, l'actif, la transaction. On arrive par la recherche ou par un tableau, on voit tout, on agit.
- **Accueil en trois étages** : état global en une ligne, bande de chiffres clés cliquables, file d'actions triée par impact.
- **Une page = un résumé (3-4 chiffres) + un tableau principal + des détails repliés.** Jamais plus de 3 blocs visibles d'emblée.
- **Un mot par concept**, en français simple (glossaire ci-dessous), partout.
- **Chaque chiffre est vérifiable** : source, fraîcheur, et état « non disponible » explicite plutôt qu'un 0 trompeur.
- **Aucune action sensible sans trace** : motif obligatoire, journal d'audit, rôles.

## 3. Nouvelle architecture de l'information

| Entrée | Onglets | Question à laquelle elle répond |
|---|---|---|
| Accueil | — | Tout va bien ? Que dois-je traiter ? |
| Trésorerie | Actifs · À approvisionner · Couverture · Réserve de retrait · Collecte des dépôts · Liquidité des échanges · Plan staking | Combien je dois, combien je détiens, où est l'argent ? |
| Opérations | File d'attente · Transactions · Tâches | Qu'est-ce qui est bloqué ou en échec ? |
| Utilisateurs | Liste · Croissance · Rétention & valeur · Acquisition · Rentabilité | Qui sont mes utilisateurs, combien ils rapportent ? |
| Revenus | Résultat · Frais · Dépôts | Combien je gagne, et d'où ça vient ? |
| Produits | Prêts · Staking · Futures · Jeux · Roue · P2P · Marchés | Comment va chaque produit ? |
| WAKATI | Tokenomics · Prix & réserve · Offre · Ventes & caisse · Burns · Détenteurs | Comment va le jeton ? |
| Système | Contrôles · Journal d'audit · Notifications · Bot Telegram · App mobile · Paramètres | La plateforme fonctionne-t-elle correctement ? |

Les URLs existantes ne changent pas : seul leur rattachement à une entrée change. Nouvelles pages : `/dashboard/assets`, `/dashboard/assets/[symbol]`, `/dashboard/operations`.

## 4. Glossaire (un mot par concept)

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

## 5. Phases (réordonnées le 2026-11-20 : d'abord ce qui aide à décider)

Constat après la phase 0 : réorganiser la navigation et les mots ne suffit pas. Un admin doit pouvoir décider. Les phases suivent donc ses priorités : quoi approvisionner, savoir si un chiffre est normal, savoir ce qui rapporte, repérer les utilisateurs à risque.

| Phase | Contenu | État |
|---|---|---|
| 0 | Navigation par tâche (8 entrées), pages **Actifs** (liste + fiche), **File d'attente**, **nouvel accueil** | **Fait (2026-11-20)** |
| 1 | **Décision : quoi approvisionner et quand.** Autonomie par actif (jours au pire jour et au rythme moyen), test de stress (les 1, 5, 10 plus gros soldes retirent ensemble), action chiffrée avec la source (coffre, collecte, extérieur), alertes de l'accueil reformulées avec montants. Page `/dashboard/funding`, section dans la fiche actif, colonne Autonomie dans Actifs | **Fait (2026-11-20)** |
| 2 | **Décision : ce chiffre est-il normal ?** Chaque chiffre clé comparé à la période précédente (variation en % et flèche), mini-courbes 7/30 jours, écart à la moyenne signalé quand il sort de l'ordinaire | À faire |
| 3 | **Décision : ce qui rapporte.** Résultat décomposé par source (frais, marge sur dépôts et échanges, intérêts de staking versés, prêts, jeux, futures) et par produit, avec ce que chaque produit rapporte ou coûte par utilisateur actif | À faire |
| 4 | **Décision : utilisateurs à risque ou à forte valeur.** Concentration des soldes par actif, gros retraits probables, utilisateurs les plus rentables, comportements inhabituels | À faire |
| 5 | **Confiance des chiffres** : fraîcheur affichée sur chaque bloc, capteur d'écart par actif, motif obligatoire pour toute écriture manuelle, états vides et erreurs explicites | À faire |
| 6 | **Rôles et sécurité** : lecture seule / opérateur / administrateur, confirmation des actions sensibles, double validation au-delà d'un seuil, journal d'audit relié à chaque action | À faire |
| 7 | Finitions : application du glossaire à toutes les pages, recherche globale, fusion des pages de trésorerie dans la fiche actif, pages produits au format « résumé + tableau + détails repliés » | À faire (priorité basse : surtout de la lisibilité) |

## 6. Critères de réussite

- Un nouvel admin trouve, sans aide, « combien manque-t-il pour l'actif X ? » en moins de 30 secondes.
- Aucun chiffre n'apparaît à deux endroits avec deux valeurs différentes.
- Plus aucun terme de la colonne « À proscrire » dans l'interface.
- Aucune page n'affiche plus de 3 blocs d'emblée.
- Toute alerte de l'accueil mène en un clic à la page où on la traite.
