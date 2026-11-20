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
| Trésorerie | Actifs · Couverture · Réserve de retrait · Collecte des dépôts · Liquidité des échanges · Plan staking | Combien je dois, combien je détiens, où est l'argent ? |
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

## 5. Phases

| Phase | Contenu | État |
|---|---|---|
| 0 | Navigation par tâche (8 entrées, 1 mot par onglet), page **Actifs** (liste + fiche actif), page **File d'attente**, **nouvel accueil** (état, 8 chiffres clés, actions triées par impact, actifs à surveiller) | **Fait (2026-11-20)** |
| 1 | **Vocabulaire** : appliquer le glossaire à toutes les pages (titres, aides, alertes, libellés de colonnes) | À faire |
| 2 | **Trésorerie consolidée** : la fiche actif reçoit en onglets la couverture, la réserve de retrait, la collecte, la liquidité et le plan staking de l'actif ; les pages globales deviennent des vues de synthèse sans doublon | À faire |
| 3 | **Recherche globale** (barre en haut : utilisateur, e-mail, transaction, hash, actif) et **fiche utilisateur** en 3 blocs (résumé · argent · activité) ; filtres et exports homogènes sur tous les tableaux | À faire |
| 4 | **Pages produits** au format « résumé + tableau + détails repliés » : Prêts, Futures, Jeux, Dépôts, Fiche utilisateur | À faire |
| 5 | **Confiance des chiffres** : fraîcheur affichée (« actualisé il y a … ») sur chaque bloc, capteur d'écart par actif (stock non financé), motif obligatoire pour toute écriture manuelle, états vides et erreurs explicites | À faire |
| 6 | **Rôles et sécurité** : lecture seule / opérateur / administrateur, confirmation des actions sensibles, double validation au-delà d'un seuil, authentification renforcée, journal d'audit relié à chaque action | À faire |
| 7 | **Tendances et alertes** : courbes 7/30/90 jours sur les chiffres clés, seuils d'alerte configurables, notification (Telegram / e-mail) | À faire |

## 6. Critères de réussite

- Un nouvel admin trouve, sans aide, « combien manque-t-il pour l'actif X ? » en moins de 30 secondes.
- Aucun chiffre n'apparaît à deux endroits avec deux valeurs différentes.
- Plus aucun terme de la colonne « À proscrire » dans l'interface.
- Aucune page n'affiche plus de 3 blocs d'emblée.
- Toute alerte de l'accueil mène en un clic à la page où on la traite.
