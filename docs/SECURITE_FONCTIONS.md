# Sécurité des fonctions de la base : analyse et plan

*Analyse hors ligne du catalogue de fonctions du dépôt (123 fonctions). Les droits d'exécution réels n'ont pas pu être relus en base :
exécuter `supabase/scripts/verifier_exposition_fonctions.sql` pour les confirmer.*

## Le problème

Supabase accorde par défaut `EXECUTE` aux rôles `anon` (visiteur sans compte) et `authenticated` (tout inscrit) sur chaque fonction du schéma
`public`. La clé « anon » est publique : elle est dans le code de l'app. Une fonction `SECURITY DEFINER` (qui s'exécute avec les droits du
propriétaire) qui ne vérifie pas qui l'appelle peut donc être déclenchée par n'importe qui avec cette clé.

**80 fonctions sont `SECURITY DEFINER`, 52 n'ont aucun contrôle d'identité.**

## Ce qu'un appelant malveillant pourrait faire (si les droits sont ouverts)

| Gravité | Fonctions | Effet possible |
|---|---|---|
| Critique | `confirm_campay_deposit`, `confirm_mobile_money_deposit` | Créditer un dépôt à partir d'une référence et d'un montant passés en paramètre. `initiate_*_deposit` accepte une référence choisie par l'appelant : initier un dépôt puis le « confirmer » sans payer. |
| Critique | `rollback_mobile_money_withdrawal`, `rollback_campay_withdrawal`, `rollback_airtime_purchase`, `confirm_mobile_money_withdrawal` | Rembourser ou clôturer des retraits avec un montant fourni par l'appelant. |
| Critique | `execute_wheel_spin` | Le segment gagnant est un paramètre : choisir le plus gros gain, à volonté. |
| Critique | `initiate_mobile_money_withdrawal`, `initiate_campay_withdrawal`, `initiate_airtime_purchase`, `execute_swap_realtime` | Agir sur le solde d'un autre utilisateur dont on connaît l'identifiant (retrait vers un numéro choisi, swap). |
| Élevée | `fn_burn_tokens`, `fn_treasury_debit_for_payout`, `collect_fee_to_platform`, `fn_admin_reclaim_user_balance`, `fn_admin_set_wheel_currency` | Falsifier la comptabilité de trésorerie, brûler du WAKATI, reprendre des soldes, modifier la roue. |
| Élevée | `fn_compute_wakati_daily_price`, `distribute_staking_rewards`, `fn_liquidate_loan`, `fn_accrue_loan_interest`, `fn_check_*` | Déclencher à volonté des traitements prévus pour le cron (prix, récompenses, liquidations). |
| Moyenne | `get_user_profile`, `get_user_all_addresses`, `get_trading_*`, `get_wheel_state`, `search_user_for_p2p` | Lire des données personnelles ou d'autres utilisateurs. |
| Moyenne | `get_admin_reconciliation`, `get_asset_liabilities`, `get_platform_fees_totals`, `get_wakati_flows` | Lire vos chiffres internes. |

## Plan en trois étapes (`supabase/migrations/20261009_security_hardening_DRAFT.sql`)

1. **Étape 1 : service uniquement (S).** Fonctions internes, cron et administration. Aucun client n'en a besoin ; les appels depuis d'autres
   fonctions, pg_cron et le dashboard (clé service_role) continuent. Risque de casse très faible.
2. **Étape 2 : webhooks et roue (W).** `confirm_*`, `rollback_*`, `execute_wheel_spin` : service uniquement, **après avoir vérifié** que les
   edge functions concernées utilisent la clé `service_role`. Si l'une utilise la clé anon, la corriger d'abord, sinon les dépôts ne seront plus crédités.
3. **Étape 3 : fonctions appelées par l'app (U).** Ajout de `assert_caller_is(p_user_id)` : refuse anon et les autres utilisateurs, accepte le
   propriétaire du compte, `service_role` et les appels serveur. À tester avant application (anon, autre utilisateur, bon utilisateur, service).
   Point d'attention : `handle_user_auth_flow` (flux d'inscription), à ne protéger qu'après avoir vérifié qu'il est appelé avec une session.

## Contrôle permanent

Le contrôle « Fonctions utilisateur protégées contre l'usurpation » (Administration › Contrôles) ne regarde que les fonctions ayant un
paramètre `p_user_id`. À étendre à toutes les fonctions `SECURITY DEFINER` exécutables par `anon` et sans contrôle d'identité, y compris
`confirm_*`, `rollback_*` et `fn_burn_tokens`.
