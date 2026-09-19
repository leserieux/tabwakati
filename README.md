# Wakati Dashboard — v1 (Treasury & Solvabilité)

Dashboard interne pour monitorer l'app Wakati. Cette v1 contient une seule page :
**Treasury & Solvabilité**, qui compare en temps réel le solde on-chain réel du
treasury au total dû aux utilisateurs (passif) pour chaque actif.

## Comment ça marche 

- Le treasury (portefeuille qui envoie les fonds lors des retraits) a des adresses
  publiques on-chain (BTC, EVM). Ce dashboard lit ces soldes en **lecture seule**
  via des RPC publics (Polygon, BSC, Blockstream pour BTC) — aucune clé privée
  n'est jamais utilisée ici.
- Le "passif" (ce que l'app doit à ses utilisateurs) est calculé côté base de
  données via la fonction SQL `get_asset_liabilities()`, qui ne renvoie que des
  totaux agrégés par actif — jamais de données individuelles.
- Si le solde on-chain est **inférieur** au passif → badge "⚠ Déficit" rouge :
  ça veut dire que si tous les utilisateurs retiraient en même temps, le
  treasury n'aurait pas assez pour tout le monde. À surveiller/agir en priorité.

## Installation locale (optionnel, pour tester avant de déployer)

```bash
npm install
cp .env.example .env.local
# remplis .env.local avec tes vraies valeurs (voir ci-dessous)
npm run dev
```

Ouvre http://localhost:3000 — tu seras redirigé vers `/login`.

## Déploiement sur Vercel

1. Pousse ce dossier dans un repo Git (GitHub/GitLab/Bitbucket) — **ne commite
   jamais le fichier `.env.local`**, il est déjà dans `.gitignore`.
2. Sur [vercel.com](https://vercel.com), "Add New Project" → importe le repo.
3. Dans "Environment Variables", ajoute exactement les mêmes clés que dans
   `.env.example`, avec les vraies valeurs (voir tableau ci-dessous).
4. Déploie. Le dashboard sera accessible à l'URL Vercel générée, protégé par
   le mot de passe que tu as défini dans `ADMIN_PASSWORD`.

## Variables d'environnement à configurer sur Vercel

| Variable | Où la trouver |
|---|---|
| `ADMIN_PASSWORD` | Choisis un mot de passe fort, à toi de le définir |
| `SESSION_SECRET` | Une longue chaîne aléatoire (ex: génère-la avec `openssl rand -hex 32`) |
| `SUPABASE_URL` | `https://jbzbwyuawejdhhutkmkk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard Supabase → Project Settings → API → `service_role` (secret, ne jamais exposer côté client) |
| `TREASURY_EVM_ADDRESS` | `0x9189e4e751D1B0BB2967E6B129391e4baE8fc38C` (déjà dans `.env.example`) |
| `TREASURY_BTC_ADDRESS` | `1KwmTSXyopi4fiBJesatZkQmNQzb7NHikV` (déjà dans `.env.example`) |

Les variables `POLYGON_RPC_URL`, `BSC_RPC_URL`, `ETHEREUM_RPC_URL` sont
optionnelles — des valeurs publiques par défaut sont déjà codées si tu ne les
définis pas.

## Sécurité

- La clé `SUPABASE_SERVICE_ROLE_KEY` a un accès complet à la base (elle ignore
  les règles RLS). Elle n'est utilisée que côté serveur (Server Components /
  API routes Next.js), jamais envoyée au navigateur — c'est la configuration
  standard et sûre pour ce genre de tableau de bord interne.
- L'authentification est volontairement simple (mot de passe + cookie signé
  HMAC, 12h de validité) puisque tu es seul à y accéder. Si plusieurs
  personnes doivent y accéder un jour avec des rôles différents, on pourra
  passer à une vraie auth (Supabase Auth, par exemple).
- Les adresses treasury sont **publiques** par nature (comme un RIB) — les
  avoir dans les variables d'environnement n'est pas un risque de sécurité.
  Ce qui doit rester secret, c'est uniquement `TREASURY_MNEMONIC` /
  `MASTER_SEED_PHRASE`, qui ne sont **jamais** utilisés dans ce projet.

## Prochaines sections prévues

- Vue d'ensemble (volumes, users actifs, frais collectés)
- Transactions (recherche, filtre, alertes sur les `processing` bloquées)
- Paramètres (édition directe des tables de config)
- Utilisateurs
- Santé système (statut webhooks)

Dis-moi quand tu veux qu'on attaque la suivante.
