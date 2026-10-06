-- Vues admin pour le dashboard Crédit/Prêts.
-- Corrige un bug existant : v_active_loans_health filtre par auth.uid(), qui est
-- toujours NULL côté service role (admin) -> le compteur "prêts à risque" était
-- toujours à 0 en silence. Ces vues sont réservées à l'usage admin (service role).

-- 1) Santé de TOUS les prêts collatéralisés actifs (pas seulement ceux de l'utilisateur connecté)
create or replace view public.admin_active_loans_risk as
select
  l.id as loan_id,
  l.user_id,
  l.collateral_asset,
  l.collateral_amount,
  l.borrow_asset,
  l.principal_amount,
  l.accrued_interest,
  (l.principal_amount + l.accrued_interest) as total_debt,
  cp.price_usd as collateral_price_usd,
  bp.price_usd as borrow_price_usd,
  round(l.collateral_amount * coalesce(cp.price_usd, 0), 2) as collateral_value_usd,
  round((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0), 2) as debt_value_usd,
  round(
    (((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0))
      / nullif(l.collateral_amount * coalesce(cp.price_usd, 0), 0)) * 100,
    2
  ) as current_ltv_pct,
  l.liquidation_ltv_snapshot,
  round(
    l.liquidation_ltv_snapshot - (
      (((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0))
        / nullif(l.collateral_amount * coalesce(cp.price_usd, 0), 0)) * 100
    ),
    2
  ) as marge_avant_liquidation_pct,
  l.apr_rate_snapshot,
  l.opened_at
from public.loans l
left join public.asset_prices cp on cp.asset_symbol = l.collateral_asset
left join public.asset_prices bp on bp.asset_symbol = l.borrow_asset
where l.status = 'active';

comment on view public.admin_active_loans_risk is
  'Santé de tous les prêts collatéralisés actifs, calculée pour l''admin (sans filtre auth.uid()). Remplace v_active_loans_health pour un usage admin.';

-- 2) Détail + statut de risque des micro-prêts "score crédit"
create or replace view public.admin_score_loans_risk as
select
  sl.id as loan_id,
  sl.user_id,
  sl.asset_symbol,
  sl.principal_amount,
  sl.accrued_interest,
  (sl.principal_amount + sl.accrued_interest) as total_debt,
  ap.price_usd,
  round((sl.principal_amount + sl.accrued_interest) * coalesce(ap.price_usd, 0), 2) as debt_value_usd,
  sl.status,
  sl.opened_at,
  sl.due_at,
  sl.grace_until,
  sl.extensions_used,
  sl.closed_at,
  case
    when sl.status = 'repaid' then 'repaid'
    when sl.status = 'defaulted' then 'defaulted'
    when sl.grace_until is not null and now() > sl.grace_until then 'grace_expiree'
    when sl.due_at is not null and now() > sl.due_at then 'en_grace'
    else 'en_cours'
  end as risk_state
from public.score_loans sl
left join public.asset_prices ap on ap.asset_symbol = sl.asset_symbol;

comment on view public.admin_score_loans_risk is
  'Détail des micro-prêts "score crédit" avec statut de risque calculé (en cours / en grâce / grâce expirée / remboursé / défaut), pour l''admin.';

-- 3) Résumé global crédit (encours, défauts, taux de défaut) sur les deux systèmes de prêt
create or replace view public.admin_credit_summary as
select
  (select coalesce(sum(debt_value_usd), 0) from public.admin_active_loans_risk) as loans_encours_usd,
  (select count(*) from public.admin_active_loans_risk) as loans_actifs,
  (select count(*) from public.admin_active_loans_risk where marge_avant_liquidation_pct < 10) as loans_a_risque,
  (select count(*) from public.loans where status = 'liquidated') as loans_liquides_total,
  (select count(*) from public.loans) as loans_total,
  (select coalesce(sum(debt_value_usd), 0) from public.admin_score_loans_risk where status = 'active') as score_loans_encours_usd,
  (select count(*) from public.admin_score_loans_risk where status = 'active') as score_loans_actifs,
  (select count(*) from public.admin_score_loans_risk where risk_state in ('en_grace', 'grace_expiree')) as score_loans_a_risque,
  (select count(*) from public.score_loans where status = 'defaulted') as score_loans_defauts_total,
  (select count(*) from public.score_loans) as score_loans_total;

comment on view public.admin_credit_summary is
  'Résumé agrégé des deux systèmes de prêt (collatéralisé + score crédit) pour la page Crédit du dashboard admin.';
