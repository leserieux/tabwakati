# Wakati Admin

Console d'administration de la plateforme Wakati (portefeuille crypto, staking, prêts, futures, jeux, jeton interne WAKATI, mobile money). Next.js 14 + Supabase, déployée sur Vercel.

Ambition : un back-office du niveau de ceux de Binance, Coinbase ou Bybit. Un admin ouvre la console, comprend en 5 secondes si tout va bien, voit ce qu'il doit traiter, et retrouve n'importe quel chiffre en 2 clics.

## Ce que fait la console

| Entrée | Contenu |
|---|---|
| **Accueil** | État de la plateforme, chiffres clés comparés à la période précédente, actions à traiter triées par gravité |
| **Trésorerie** | Actifs (dû / détenu / écart), à approvisionner, couverture, réserve de retrait, collecte des dépôts, liquidité des échanges, plan staking |
| **Opérations** | File d'attente (bloqué ou en échec), transactions, tâches |
| **Utilisateurs** | Liste et fiche, croissance, rétention et valeur, acquisition, rentabilité |
| **Revenus** | Résultat (P&L), frais, dépôts |
| **Produits** | Prêts, staking, futures, jeux, roue, P2P, marchés |
| **WAKATI** | Tokenomics, prix et réserve, offre, ventes et caisse, burns, détenteurs |
| **Système** | Contrôles automatiques, journal d'audit, administrateurs, notifications, bot Telegram, app mobile, paramètres |

## Démarrage rapide

Prérequis : Node 20 ou plus.

```bash
npm install
cp .env.example .env.local     # puis remplir les valeurs (voir ci-dessous)
npm run dev                    # http://localhost:3000
```

Avant chaque commit ou déploiement :

```bash
npm run check                  # typecheck + tests
npm run build                  # build de production
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run typecheck` | Vérification TypeScript |
| `npm test` | Tests unitaires (vitest) de la logique de calcul et de sécurité |
| `npm run check` | Typecheck puis tests |
| `npm run build` / `npm start` | Build et lancement de production |

## Variables d'environnement

Modèle complet commenté : [`.env.example`](.env.example). Sur Vercel : *Settings › Environment Variables*.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SESSION_SECRET` | oui | Signe les sessions (32 caractères aléatoires ou plus : `openssl rand -hex 32`) |
| `ADMIN_PASSWORD` | oui | Accès partagé « admin » (ancien mode) |
| `ADMIN_VIEWER_PASSWORD` | non | Second mot de passe, accès en lecture seule |
| `ADMIN_LEGACY_LOGIN` | non | `off` interdit l'accès partagé (comptes nominatifs seulement) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | oui | Base de données (clé serveur, jamais exposée au navigateur) |
| `CRON_SECRET` | oui | Autorise la tâche planifiée `/api/cron/*` |
| `DASHBOARD_API_SECRET` | oui | Lecture des soldes PawaPay |
| `TREASURY_EVM_ADDRESS`, `TREASURY_BTC_ADDRESS` | oui | Adresses **publiques** de la trésorerie |
| `VAULT_EVM_ADDRESS`, `VAULT_BTC_ADDRESS` | non | Coffre (stockage à froid) |
| `POLYGON_RPC_URL`, `BSC_RPC_URL`, `ETHEREUM_RPC_URL` | non | RPC publics (valeurs par défaut fournies) |

## Structure

```
src/app/dashboard/…   pages (fines)         src/core/       auth, base de données, formats, navigation
src/modules/<domaine> logique métier         src/components/ interface partagée
tests/                tests unitaires        mobile/         app Flutter (à sortir de ce dépôt)
docs/                 conventions, journal   supabase/       schéma SQL (à compléter)
```

Détail, règles de dépendance et recette « ajouter une page » : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Sécurité en bref

- `/dashboard/*` : le middleware exige un jeton **signé** et non expiré ; chaque page et chaque action serveur revérifie.
- Toute action qui écrit commence par `assertCan()` / `assertCanWrite()` ; toute route `/api/*` commence par `getRequestSession()`.
- Rôles : super-admin, finance, support, risque, lecture seule (`src/core/auth/permissions.ts`).
- Toute action sensible est inscrite au journal d'audit.
- Aucune clé privée dans le dépôt : adresses publiques uniquement.

Règles complètes (actifs, comptabilité, SQL, interface) : [docs/CONVENTIONS.md](docs/CONVENTIONS.md).

---

## Roadmap

Principe : **une phase à la fois**. Une phase est terminée quand `npm run check` et `npm run build` passent, qu'elle est déployée et que ses critères sont vérifiés. Ne pas commencer la suivante avant. Les phases 1 à 3 consolident ; les phases 4 à 6 ajoutent ce qui distingue une console d'exchange.

### Phase 0 : assainissement ✅ (fait, refonte du 2026-11-22)

- [x] Application mobile Flutter séparée du dashboard (`mobile/`)
- [x] Code rangé par domaine (`src/core`, `src/modules/*`), alias `@/` unique
- [x] 24 layouts identiques remplacés par un seul ; onglets manquants corrigés (Réserve de retrait, Administrateurs)
- [x] Middleware : vérification de la signature du jeton (avant : simple présence du cookie)
- [x] Garde commune des routes API ; collecte réelle de nouveau autorisée aux `super_admin`
- [x] Un seul client Supabase par processus ; navigation sans rechargement (`next/link`)
- [x] Page Crédit découpée : logique extraite dans un module testé (723 → ~520 lignes)
- [x] Hygiène : `.env.example` sans valeurs réelles, `.gitignore`, fichiers obsolètes retirés
- [x] README, ARCHITECTURE, CONVENTIONS, CHANGELOG ; tests 41 → 62

### Phase 1 : mise en route et filet de sécurité

Objectif : pouvoir modifier le code sans peur. *La refonte a été faite sans accès à `npm install` ni à la base : cette phase la valide en conditions réelles.*

- [ ] `npm install`, `npm run check`, `npm run build` (le `package-lock.json` doit être régénéré : il date d'avant l'ajout de vitest)
- [ ] Déployer en **preview** Vercel et comparer avec la production : Accueil, Actifs, Couverture, Résultat, Crédit, fiche utilisateur (mêmes chiffres), puis tester connexion, déconnexion, un export CSV, un rôle lecture seule
- [ ] Versionner le schéma : `supabase db pull` dans `supabase/migrations/` (voir `supabase/README.md`)
- [ ] CI GitHub Actions : typecheck + tests + build à chaque Pull Request
- [ ] ESLint + Prettier ; interdire `any` dans le code nouveau
- [ ] Sortir `mobile/` dans son propre dépôt

**Terminé quand** : la CI est verte, la preview donne les mêmes chiffres que la production, le schéma SQL est dans le dépôt.

### Phase 2 : sécurité et rôles de niveau exchange

Objectif : qu'aucun compte ne puisse faire plus que son métier, et que rien de sensible ne se fasse seul.

- [ ] Créer un compte nominatif par administrateur, puis `ADMIN_LEGACY_LOGIN=off`
- [ ] Permissions **par page et par route API** (matrice rôle × page) : masquer les entrées de menu non permises, exiger `finance.read` pour les exports financiers
- [ ] Limitation de tentatives de connexion par IP (en plus du verrouillage par compte)
- [ ] Sessions révocables (table `admin_sessions`, « se déconnecter partout », jeton court) au lieu d'un jeton de 12 h sans état
- [ ] Authentification à deux facteurs (TOTP), obligatoire pour les rôles finance et super-admin
- [ ] **Motif obligatoire** et **double validation** (quatre yeux) au-dessus d'un seuil : collecte réelle, fermeture forcée des futures, burn, changement des frais, retrait manuel
- [ ] Journal d'audit infalsifiable (écriture seule, chaînage par empreinte)
- [ ] Restriction par IP / VPN pour l'accès à la console (option)

**Terminé quand** : un compte « support » ne peut ni voir la trésorerie ni exporter ; une action sensible exige un motif et une seconde personne ; le journal d'audit ne peut plus être modifié.

### Phase 3 : fiabilité des chiffres et performance

Objectif : chaque chiffre est exact, frais et vérifiable ; les pages restent rapides quand la base grossit.

- [ ] Déplacer les agrégations lourdes dans la base (vues ou fonctions `admin_*`) : aujourd'hui `fetchAll` ramène jusqu'à 200 000 lignes en mémoire (Résultat, Frais, rentabilité par utilisateur)
- [ ] Cache court (60 s) sur les pages lourdes et sur les prix
- [ ] Fraîcheur affichée sur chaque bloc ; mini-courbes sur 30 jours à l'accueil
- [ ] Capteur d'écart par actif (soldes contre mouvements), alerte au-delà d'un seuil
- [ ] Types générés par Supabase (`supabase gen types`) pour supprimer les ~200 `any`
- [ ] Découper les pages de plus de 300 lignes sur le modèle de `modules/products/credit.ts` : Liquidité (489), Réserve de retrait (445), fiche utilisateur (414), Futures (400), Couverture (350), `settings/actions.ts` (543)
- [ ] Remplacer les styles en ligne (~220) par des classes CSS
- [ ] Étendre les tests : Résultat, Frais, Couverture, Cohortes, Décision utilisateur

**Terminé quand** : aucune page ne lit plus de 1 000 lignes pour afficher un total ; toutes les pages sont sous 300 lignes ; la couverture de tests inclut tous les calculs d'argent.

### Phase 4 : conformité et opérations (modules d'un exchange)

Objectif : traiter les dossiers à risque dans la console, pas dans des tableurs.

- [ ] **KYC / AML** : file de vérification (pièces, statut, motif de rejet), niveaux de vérification et plafonds associés, filtrage sanctions / PPE via un prestataire (Sumsub, Chainalysis ou Elliptic)
- [ ] **Retraits** : file de validation (automatique sous un seuil, manuelle au-dessus, double approbation)
- [ ] **Surveillance** : règles de détection (fractionnement de montants, retraits atypiques, comptes liés par parrainage ou appareil), dossiers de cas avec historique
- [ ] **Gel et limites** par utilisateur depuis la fiche (les permissions `users.freeze` / `users.limits` existent déjà)
- [ ] **Support** : notes, tickets, consultation de la fiche en lecture seule
- [ ] Rapports réglementaires et exports signés (comme l'export mensuel de la réserve, avec empreinte SHA-256)
- [ ] Preuve de réserves publiable (à partir des relevés quotidiens existants)

**Terminé quand** : un retrait ou un compte à risque se traite de bout en bout dans la console, avec trace.

### Phase 5 : produits et croissance

- [ ] Vue **par produit rapportée à l'utilisateur actif** (ce que chaque produit rapporte ou coûte par utilisateur)
- [ ] Décision utilisateurs : gros retraits probables et comportements inhabituels
- [ ] **Listing d'actifs** : ajouter un actif ou un réseau, activer / suspendre dépôts et retraits par réseau, depuis la console
- [ ] Marketing : codes promo, campagnes, airdrops (le parrainage existe déjà)
- [ ] Alertes sortantes (e-mail, WhatsApp ou Slack **privés**, jamais le bot Telegram public) avec seuils réglables

### Phase 6 : plateforme et durée

- [ ] Next.js 14 → version courante et React 19, une fois la CI en place
- [ ] Recherche globale (utilisateur, hash de transaction, adresse)
- [ ] Groupes de routes par section (`(tresorerie)`, `(utilisateurs)`…) pour que l'arborescence suive le menu
- [ ] Supervision : Sentry, suivi des tâches planifiées, alerte si une tâche ne s'est pas exécutée
- [ ] Glossaire appliqué sur toutes les pages (voir [CONVENTIONS](docs/CONVENTIONS.md#6-interface)) ; interface bilingue FR / EN

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : structure, dépendances, sécurité, recette « ajouter une page », ancien → nouveau chemin
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) : règles sur les actifs, la comptabilité, le SQL et l'interface
- [docs/CHANGELOG.md](docs/CHANGELOG.md) : journal de tout ce qui a changé et pourquoi
- [docs/SECURITE_FONCTIONS.md](docs/SECURITE_FONCTIONS.md) : audit des fonctions SQL `SECURITY DEFINER`
- [docs/archive/](docs/archive/) : ancienne roadmap fonctionnelle
