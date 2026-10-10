-- Appliquée sur le projet Supabase (wakatiapp) le 2026-10-07 (migrations swap_ledger_journaling et swap_ledger_alignment_and_controls).
--
-- Problème : execute_swap_realtime (2 surcharges) modifiait les deux portefeuilles de trésorerie
--   (+ montant vendu, - montant net acheté) sans aucune écriture dans treasury_ledger.
--   Le frais de swap n'est PAS débité du portefeuille (il reste dans la trésorerie) : il ne faut donc pas de fee_credit
--   supplémentaire (double compte). Il est tracé dans le motif de l'écriture swap_out.
--
-- 1) Le journal accepte deux nouveaux types : swap_in (actif vendu par le client, +) et swap_out (actif versé au client, -).
-- 2) Les deux surcharges de execute_swap_realtime journalisent les deux jambes (balance_before/after lus via RETURNING).
--    Testé dans une transaction annulée : écritures cohérentes avec les portefeuilles et liées aux bonnes transactions.
-- 3) Alignement des écarts du jour (MATIC +1.269884, USDC-BSC -0.044116) par deux écritures 'backfill' tracées.
-- 4) admin_run_controls : frais de swap reconnus via swap_out ; nouveau contrôle de continuité du journal depuis le correctif ;
--    historique en information ; contrôle de sécurité 'user_functions_open'.
--
-- Historique avant le 2026-10-07 : 24 ruptures du journal (WAKATI -155 916,96 ; FCFA +1 621,32 ; MATIC -2,60) laissées telles quelles.
--   Les swaps n'en expliquent qu'une partie (WAKATI -11 214,76 ; FCFA +1 138,71 ; MATIC -29,71 net) : le reste vient d'autres
--   mouvements de portefeuille non journalisés (opérations manuelles ?) à identifier par le propriétaire.
--
-- Définitions complètes : dans la base (select pg_get_functiondef('public.execute_swap_realtime(uuid,text,text,numeric,numeric,numeric)'::regprocedure);).
alter table public.treasury_ledger drop constraint treasury_ledger_entry_type_check;
alter table public.treasury_ledger add constraint treasury_ledger_entry_type_check check (entry_type = any (array[
  'fee_credit','burn','admin_withdrawal','adjustment','backfill','payout_debit','admin_reclaim','loan_disbursement','loan_repayment','liquidation','wakati_sale',
  'swap_in','swap_out']));
