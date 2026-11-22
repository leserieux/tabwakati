# Supabase : schéma et migrations

Ce dossier doit contenir le **schéma SQL réel** du projet (tables, vues `admin_*`, fonctions, politiques). Le code du dashboard en dépend et la règle du projet est : *le schéma versionné est la source de vérité*.

> ⚠️ **Il était absent de l'archive reçue lors de la refonte.** Tant qu'il n'est pas ici, le projet n'est pas reconstructible à partir du dépôt seul.

## À faire (roadmap, phase 1)

```bash
npm i -D supabase                       # ou installer la CLI Supabase
npx supabase login
npx supabase link --project-ref <ton-projet>
npx supabase db pull                    # écrit supabase/migrations/<horodatage>_remote_schema.sql
```

Puis y remettre les anciens fichiers de migration (`2026…_*.sql`) et les scripts de vérification (`scripts/verifier_exposition_fonctions.sql`) s'ils existent encore ailleurs.

Les fonctions edge (`sweep-deposits`, `spin-wheel`, `send-push`, `coingecko-price`…) sont déployées séparément : les versionner dans `supabase/functions/` quand c'est possible.

Règles d'écriture SQL : voir [../docs/CONVENTIONS.md](../docs/CONVENTIONS.md#5-sql-supabase).
