-- Alignement de la base sur les règles du dashboard (vérification 2026-10-10).
-- Appliquée sur wakatiapp. Anciennes définitions : voir migrations précédentes
-- (20260926195525_admin_wheel_segment_stats_fix_v2, 20260924131714_admin_credit_risk_views, 20260926195356_admin_games_views).

-- 1. Frais : même règle que lib/metrics/rules.ts (hors test, hors game_house_edge, hors game_net_loss).
create or replace function public.get_platform_fees_totals()
 returns table(asset_symbol text, fee_count bigint, total_fees numeric)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select pf.asset_symbol, count(*)::bigint, coalesce(sum(pf.amount), 0)
  from platform_fees pf
  where pf.is_test = false
    and pf.fee_type not in ('game_house_edge', 'game_net_loss')
  group by pf.asset_symbol
$function$;

-- 2. Prix : les vues de crédit lisent asset_prices_resolved (USDC-ETH / USDC-POL / USDC-BSC résolus via ledger_symbol).
create or replace view public.admin_active_loans_risk as
 SELECT l.id AS loan_id,
    l.user_id,
    l.collateral_asset,
    l.collateral_amount,
    l.borrow_asset,
    l.principal_amount,
    l.accrued_interest,
    (l.principal_amount + l.accrued_interest) AS total_debt,
    (cp.price_usd)::numeric(28,8) AS collateral_price_usd,
    (bp.price_usd)::numeric(28,8) AS borrow_price_usd,
    round((l.collateral_amount * COALESCE(cp.price_usd, (0)::numeric)), 2) AS collateral_value_usd,
    round(((l.principal_amount + l.accrued_interest) * COALESCE(bp.price_usd, (0)::numeric)), 2) AS debt_value_usd,
    round(((((l.principal_amount + l.accrued_interest) * COALESCE(bp.price_usd, (0)::numeric)) / NULLIF((l.collateral_amount * COALESCE(cp.price_usd, (0)::numeric)), (0)::numeric)) * (100)::numeric), 2) AS current_ltv_pct,
    l.liquidation_ltv_snapshot,
    round((l.liquidation_ltv_snapshot - ((((l.principal_amount + l.accrued_interest) * COALESCE(bp.price_usd, (0)::numeric)) / NULLIF((l.collateral_amount * COALESCE(cp.price_usd, (0)::numeric)), (0)::numeric)) * (100)::numeric)), 2) AS marge_avant_liquidation_pct,
    l.apr_rate_snapshot,
    l.opened_at
   FROM ((loans l
     LEFT JOIN asset_prices_resolved cp ON ((cp.asset_symbol = l.collateral_asset)))
     LEFT JOIN asset_prices_resolved bp ON ((bp.asset_symbol = l.borrow_asset)))
  WHERE (l.status = 'active'::text);

create or replace view public.admin_score_loans_risk as
 SELECT sl.id AS loan_id,
    sl.user_id,
    sl.asset_symbol,
    sl.principal_amount,
    sl.accrued_interest,
    (sl.principal_amount + sl.accrued_interest) AS total_debt,
    (ap.price_usd)::numeric(28,8) AS price_usd,
    round(((sl.principal_amount + sl.accrued_interest) * COALESCE(ap.price_usd, (0)::numeric)), 2) AS debt_value_usd,
    sl.status,
    sl.opened_at,
    sl.due_at,
    sl.grace_until,
    sl.extensions_used,
    sl.closed_at,
        CASE
            WHEN (sl.status = 'repaid'::text) THEN 'repaid'::text
            WHEN (sl.status = 'defaulted'::text) THEN 'defaulted'::text
            WHEN ((sl.grace_until IS NOT NULL) AND (now() > sl.grace_until)) THEN 'grace_expiree'::text
            WHEN ((sl.due_at IS NOT NULL) AND (now() > sl.due_at)) THEN 'en_grace'::text
            ELSE 'en_cours'::text
        END AS risk_state
   FROM (score_loans sl
     LEFT JOIN asset_prices_resolved ap ON ((ap.asset_symbol = sl.asset_symbol)));

-- 3. admin_loans_dashboard.prets_a_risque : lisait v_active_loans_health (filtrée sur auth.uid(), toujours NULL côté admin).
create or replace view public.admin_loans_dashboard as
 SELECT l.collateral_asset,
    l.borrow_asset,
    count(*) FILTER (WHERE (l.status = 'active'::text)) AS prets_actifs,
    count(*) FILTER (WHERE (l.status = 'repaid'::text)) AS prets_rembourses,
    count(*) FILTER (WHERE (l.status = 'liquidated'::text)) AS prets_liquides,
    COALESCE(sum(l.principal_amount) FILTER (WHERE (l.status = 'active'::text)), (0)::numeric) AS total_emprunte_actif,
    COALESCE(sum(l.collateral_amount) FILTER (WHERE (l.status = 'active'::text)), (0)::numeric) AS total_collateral_verrouille,
    count(h.loan_id) FILTER (WHERE (h.marge_avant_liquidation_pct < (10)::numeric)) AS prets_a_risque
   FROM (loans l
     LEFT JOIN admin_active_loans_risk h ON (((h.loan_id = l.id) AND (l.status = 'active'::text))))
  GROUP BY l.collateral_asset, l.borrow_asset
  ORDER BY COALESCE(sum(l.principal_amount) FILTER (WHERE (l.status = 'active'::text)), (0)::numeric) DESC;

-- 4. Roue : taux de sortie sur 30 jours glissants (les probabilités ont été modifiées au fil du temps,
--    le taux « depuis toujours » compare des tours joués avec des configurations différentes).
--    Colonnes ajoutées à la fin : recent_hits, recent_total, recent_hit_rate_pct.
create or replace view public.admin_wheel_segment_stats as
 SELECT seg.id AS segment_id,
    seg.label,
    seg.reward_type,
    round((seg.probability * (100)::numeric), 2) AS configured_probability_pct,
    seg.is_jackpot,
    seg.is_active,
    count(ws.id) AS actual_hits,
    round(
        CASE
            WHEN (( SELECT count(*) AS count
               FROM wheel_spins
              WHERE (wheel_spins.segment_id IS NOT NULL)) > 0) THEN (((count(ws.id))::numeric / (( SELECT count(*) AS count
               FROM wheel_spins
              WHERE (wheel_spins.segment_id IS NOT NULL)))::numeric) * (100)::numeric)
            ELSE NULL::numeric
        END, 2) AS actual_hit_rate_pct,
    count(ws.id) FILTER (WHERE ws.created_at >= now() - interval '30 days') AS recent_hits,
    (SELECT count(*) FROM wheel_spins r WHERE r.segment_id IS NOT NULL AND r.created_at >= now() - interval '30 days') AS recent_total,
    round(
        CASE
            WHEN (SELECT count(*) FROM wheel_spins r WHERE r.segment_id IS NOT NULL AND r.created_at >= now() - interval '30 days') > 0
            THEN (count(ws.id) FILTER (WHERE ws.created_at >= now() - interval '30 days'))::numeric
                 / (SELECT count(*) FROM wheel_spins r WHERE r.segment_id IS NOT NULL AND r.created_at >= now() - interval '30 days')::numeric * 100
            ELSE NULL::numeric
        END, 2) AS recent_hit_rate_pct
   FROM (wheel_segments seg
     LEFT JOIN wheel_spins ws ON ((ws.segment_id = seg.id)))
  GROUP BY seg.id, seg.label, seg.reward_type, seg.probability, seg.is_jackpot, seg.is_active
  ORDER BY seg.display_order, seg.id;

-- 5. Le remplacement des vues a effacé leurs options : on remet security_invoker (cf. 20260928085143_lock_down_admin_views_and_risk_functions).
alter view public.admin_wheel_segment_stats set (security_invoker = true);
alter view public.admin_loans_dashboard set (security_invoker = true);
alter view public.admin_active_loans_risk set (security_invoker = true);
alter view public.admin_score_loans_risk set (security_invoker = true);
