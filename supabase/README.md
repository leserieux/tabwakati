# Supabase : schéma et migrations

Ce dossier doit contenir le **schéma SQL réel** du projet (tables, vues `admin_*`, fonctions, politiques). Le code du dashboard en dépend et la règle du projet est : *le schéma versionné est la source de vérité*.

> ⚠️ **Le schéma complet est encore incomplet ici.** Seules les 11 migrations des 22, 23 et 24 novembre 2026 sont versionnées (comptes admin et rôles, gel de compte, idempotence, grand livre des soldes, fonctions du dashboard, alertes). Les ~313 plus anciennes restent à rapatrier avec `supabase db pull` (ci-dessous). Les numéros de version de ces 5 fichiers sont ceux de la base, pour que `db pull` ne crée pas de doublon.

| Migration | Rôle |
|---|---|
| `20261122112614_admin_foundations_rbac_account_controls_audit` | `admin_users`, rôles, gel de compte appliqué sur `transactions`, journal d'audit en ajout seul |
| `20261122183913_idempotency_unique_external_reference` | Une référence externe unique par type d'opération |
| `20261122183949_balance_ledger_shadow_mode` | Journal des mouvements de solde + contrôle `fn_balance_ledger_check()` |
| `20261122185100_admin_dashboard_backend_core` | Recherche et fiche 360°, signaux de risque, KYC, centre d'alertes |
| `20261122190233_schedule_admin_alerts_cron_and_close_staking_pools_anon` | Tâche planifiée des alertes, fermeture de `get_staking_pools` à anon |
| `20261124094001_phase3_asset_gap_alerts` | Table `admin_alert_settings` (seuils) et première version du capteur d'écart par actif |
| `20261124094126_phase3_asset_gap_alerts_unexplained_movements` | Capteur remplacé : retire le contrôle tautologique, ajoute « solde modifié sans transaction » |
| `20261124094221_phase3_alerts_permissions` | Permissions `alerts.read` / `alerts.handle` |
| `20261124094410_phase3_admin_fees_aggregate` | `admin_fees_aggregate` : frais regroupés en base |
| `20261123212649_phase2_dual_control_approvals` | Table `admin_approvals` et fonctions de la double validation (demande, validation par un second compte, prise en charge unique, annulation, expiration) |
| `20261123095557_phase2_sessions_audit_chain_permissions` | Sessions admin révocables, chaînage SHA-256 du journal d'audit, limitation de connexion par IP, permission `exports.run` |

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
