-- Crédit : les prêts garantis ont désormais une source de garantie (wallet | stake), une échéance,
-- une grâce, des prolongations et un motif de clôture (loans.collateral_source, due_at, grace_until,
-- extensions_used, duration_days, liquidation_reason) + la table stake_loan_config.
-- Les vues admin ne lisaient rien de tout ça. Changement additif : les colonnes existantes gardent
-- leur nom, leur type et leur position ; les nouvelles sont ajoutées à la fin.
-- Seule sémantique modifiée : *_a_risque compte aussi les prêts en grâce / grâce expirée.

-- 1) Détail des prêts garantis actifs ---------------------------------------------------------
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
  (cp.price_usd)::numeric(28,8) as collateral_price_usd,
  (bp.price_usd)::numeric(28,8) as borrow_price_usd,
  round((l.collateral_amount * coalesce(cp.price_usd, 0::numeric)), 2) as collateral_value_usd,
  round(((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0::numeric)), 2) as debt_value_usd,
  round(((((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0::numeric))
        / nullif((l.collateral_amount * coalesce(cp.price_usd, 0::numeric)), 0::numeric)) * 100::numeric), 2) as current_ltv_pct,
  l.liquidation_ltv_snapshot,
  round((l.liquidation_ltv_snapshot - ((((l.principal_amount + l.accrued_interest) * coalesce(bp.price_usd, 0::numeric))
        / nullif((l.collateral_amount * coalesce(cp.price_usd, 0::numeric)), 0::numeric)) * 100::numeric)), 2) as marge_avant_liquidation_pct,
  l.apr_rate_snapshot,
  l.opened_at,
  -- nouvelles colonnes
  l.collateral_source,
  l.duration_days,
  l.due_at,
  l.grace_until,
  l.extensions_used,
  case
    when l.grace_until is not null and now() > l.grace_until then 'grace_expiree'
    when l.due_at is not null and now() > l.due_at then 'en_grace'
    when l.due_at is not null
         and now() > l.due_at - make_interval(hours => coalesce((select s.due_soon_notice_hours from public.stake_loan_config s where s.id = 1), 24))
      then 'echeance_proche'
    else 'en_cours'
  end as risk_state
from public.loans l
left join public.asset_prices_resolved cp on cp.asset_symbol = l.collateral_asset
left join public.asset_prices_resolved bp on bp.asset_symbol = l.borrow_asset
where l.status = 'active';

-- 2) Synthèse crédit --------------------------------------------------------------------------
create or replace view public.admin_credit_summary as
select
  (select coalesce(sum(debt_value_usd), 0::numeric) from public.admin_active_loans_risk) as loans_encours_usd,
  (select count(*) from public.admin_active_loans_risk) as loans_actifs,
  (select count(*) from public.admin_active_loans_risk
    where marge_avant_liquidation_pct < 10::numeric or risk_state in ('en_grace', 'grace_expiree')) as loans_a_risque,
  (select count(*) from public.loans where status = 'liquidated') as loans_liquides_total,
  (select count(*) from public.loans) as loans_total,
  (select coalesce(sum(debt_value_usd), 0::numeric) from public.admin_score_loans_risk where status = 'active') as score_loans_encours_usd,
  (select count(*) from public.admin_score_loans_risk where status = 'active') as score_loans_actifs,
  (select count(*) from public.admin_score_loans_risk where risk_state in ('en_grace', 'grace_expiree')) as score_loans_a_risque,
  (select count(*) from public.score_loans where status = 'defaulted') as score_loans_defauts_total,
  (select count(*) from public.score_loans) as score_loans_total,
  -- nouvelles colonnes : prêts sur staking (sous-ensemble de loans_*)
  (select coalesce(sum(debt_value_usd), 0::numeric) from public.admin_active_loans_risk where collateral_source = 'stake') as stake_loans_encours_usd,
  (select count(*) from public.admin_active_loans_risk where collateral_source = 'stake') as stake_loans_actifs,
  (select count(*) from public.admin_active_loans_risk
    where collateral_source = 'stake'
      and (marge_avant_liquidation_pct < 10::numeric or risk_state in ('en_grace', 'grace_expiree'))) as stake_loans_a_risque,
  (select count(*) from public.loans where collateral_source = 'stake' and status = 'liquidated') as stake_loans_saisis_total,
  (select count(*) from public.loans where collateral_source = 'stake') as stake_loans_total,
  (select coalesce(sum(collateral_amount), 0::numeric) from public.admin_active_loans_risk where collateral_source = 'stake') as stake_collateral_locked;

-- 3) Agrégat par paire (désormais aussi par source de garantie) -------------------------------
create or replace view public.admin_loans_dashboard as
select
  l.collateral_asset,
  l.borrow_asset,
  count(*) filter (where l.status = 'active') as prets_actifs,
  count(*) filter (where l.status = 'repaid') as prets_rembourses,
  count(*) filter (where l.status = 'liquidated') as prets_liquides,
  coalesce(sum(l.principal_amount) filter (where l.status = 'active'), 0::numeric) as total_emprunte_actif,
  coalesce(sum(l.collateral_amount) filter (where l.status = 'active'), 0::numeric) as total_collateral_verrouille,
  count(h.loan_id) filter (where h.marge_avant_liquidation_pct < 10::numeric or h.risk_state in ('en_grace', 'grace_expiree')) as prets_a_risque,
  l.collateral_source
from public.loans l
left join public.admin_active_loans_risk h on h.loan_id = l.id and l.status = 'active'
group by l.collateral_asset, l.borrow_asset, l.collateral_source
order by coalesce(sum(l.principal_amount) filter (where l.status = 'active'), 0::numeric) desc;

-- Garde-fous : mêmes options et mêmes droits que la migration 20260928085143 (service_role uniquement)
alter view public.admin_active_loans_risk set (security_invoker = true);
alter view public.admin_credit_summary set (security_invoker = true);
alter view public.admin_loans_dashboard set (security_invoker = true);
revoke all on public.admin_active_loans_risk from public, anon, authenticated;
revoke all on public.admin_credit_summary from public, anon, authenticated;
revoke all on public.admin_loans_dashboard from public, anon, authenticated;
