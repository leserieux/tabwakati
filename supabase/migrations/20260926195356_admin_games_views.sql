-- Vues admin pour la page Jeux (roue de la fortune + prédictions de prix).
-- Toutes les conversions USD utilisent asset_prices ; aucun symbole n'est en dur
-- (cohérent avec le reste du dashboard : plusieurs actifs de mise/récompense possibles).

-- 1) Résumé global de la roue (remplacé par la migration suivante, voir _v2)
create or replace view public.admin_wheel_summary as
select
  count(*) as total_spins,
  count(*) filter (where ws.final_reward_amount > 0) as winning_spins,
  round(coalesce(sum(ws.bet_amount * coalesce(bp.price_usd, 0)), 0), 2) as total_bet_usd,
  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)), 0), 2) as total_payout_usd,
  case
    when sum(ws.bet_amount * coalesce(bp.price_usd, 0)) > 0
      then round((sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) / sum(ws.bet_amount * coalesce(bp.price_usd, 0))) * 100, 2)
    else null
  end as rtp_pct,
  count(*) filter (where seg.is_jackpot) as jackpot_hits,
  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) filter (where seg.is_jackpot), 0), 2) as jackpot_paid_usd
from public.wheel_spins ws
left join public.asset_prices bp on bp.asset_symbol = ws.bet_asset
left join public.asset_prices rp on rp.asset_symbol = ws.reward_asset
left join public.wheel_segments seg on seg.id = ws.segment_id;

comment on view public.admin_wheel_summary is 'Résumé global de la roue de la fortune : volumes, RTP réel, jackpots, pour la page Jeux du dashboard admin.';

-- 2) Activité quotidienne de la roue (pour graphique)
create or replace view public.admin_wheel_daily as
select
  date_trunc('day', ws.created_at)::date as day,
  count(*) as spins,
  round(coalesce(sum(ws.bet_amount * coalesce(bp.price_usd, 0)), 0), 2) as bet_usd,
  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)), 0), 2) as payout_usd
from public.wheel_spins ws
left join public.asset_prices bp on bp.asset_symbol = ws.bet_asset
left join public.asset_prices rp on rp.asset_symbol = ws.reward_asset
group by 1
order by 1 desc;

comment on view public.admin_wheel_daily is 'Activité quotidienne de la roue (spins, mises, gains en USD) pour graphique.';

-- 3) Distribution par segment : probabilité configurée vs taux de sortie réel (remplacé, voir _v2)
create or replace view public.admin_wheel_segment_stats as
select
  seg.id as segment_id,
  seg.label,
  seg.reward_type,
  seg.probability as configured_probability_pct,
  seg.is_jackpot,
  seg.is_active,
  count(ws.id) as actual_hits,
  round(
    case when (select count(*) from public.wheel_spins) > 0
      then (count(ws.id)::numeric / (select count(*) from public.wheel_spins)) * 100
      else null
    end,
    2
  ) as actual_hit_rate_pct
from public.wheel_segments seg
left join public.wheel_spins ws on ws.segment_id = seg.id
group by seg.id, seg.label, seg.reward_type, seg.probability, seg.is_jackpot, seg.is_active
order by seg.display_order nulls last, seg.id;

comment on view public.admin_wheel_segment_stats is 'Comparaison probabilité configurée vs taux de sortie réel par segment de roue, pour détecter des anomalies.';

-- 4) Résumé global des prédictions de prix
-- (status fait foi : 'won'/'lost'/'cancelled'. Les paris annulés sont exclus des
-- volumes et du taux de victoire, car considérés comme remboursés sans effet économique.)
create or replace view public.admin_prediction_summary as
select
  count(*) as total_bets,
  count(*) filter (where pb.status = 'won') as wins,
  count(*) filter (where pb.status = 'lost') as losses,
  count(*) filter (where pb.status = 'cancelled') as cancelled,
  round(coalesce(sum(pb.bet_amount * coalesce(cp.price_usd, 0)) filter (where pb.status in ('won', 'lost')), 0), 2) as total_wagered_usd,
  round(coalesce(sum(coalesce(pb.payout_amount, 0) * coalesce(cp.price_usd, 0)) filter (where pb.status = 'won'), 0), 2) as total_payout_usd,
  case
    when count(*) filter (where pb.status in ('won', 'lost')) > 0
      then round((count(*) filter (where pb.status = 'won')::numeric / count(*) filter (where pb.status in ('won', 'lost'))) * 100, 2)
    else null
  end as win_rate_pct
from public.prediction_bets pb
left join public.asset_prices cp on cp.asset_symbol = pb.currency_symbol;

comment on view public.admin_prediction_summary is 'Résumé global des prédictions de prix : volumes, taux de victoire réel, profit plateforme.';

-- 5) Activité quotidienne des prédictions (pour graphique)
create or replace view public.admin_prediction_daily as
select
  date_trunc('day', pb.bet_at)::date as day,
  count(*) as bets,
  count(*) filter (where pb.status = 'won') as wins,
  round(coalesce(sum(pb.bet_amount * coalesce(cp.price_usd, 0)) filter (where pb.status in ('won', 'lost')), 0), 2) as wagered_usd,
  round(coalesce(sum(coalesce(pb.payout_amount, 0) * coalesce(cp.price_usd, 0)) filter (where pb.status = 'won'), 0), 2) as payout_usd
from public.prediction_bets pb
left join public.asset_prices cp on cp.asset_symbol = pb.currency_symbol
group by 1
order by 1 desc;

comment on view public.admin_prediction_daily is 'Activité quotidienne des prédictions (paris, victoires, volumes en USD) pour graphique.';

-- 6) Distribution par actif prédit : volumes + taux de victoire réel vs multiplicateur configuré
create or replace view public.admin_prediction_asset_stats as
select
  pb.asset_symbol,
  count(*) as total_bets,
  count(*) filter (where pb.status = 'won') as wins,
  count(*) filter (where pb.status = 'lost') as losses,
  round(coalesce(sum(pb.bet_amount * coalesce(cp.price_usd, 0)) filter (where pb.status in ('won', 'lost')), 0), 2) as wagered_usd,
  round(coalesce(sum(coalesce(pb.payout_amount, 0) * coalesce(cp.price_usd, 0)) filter (where pb.status = 'won'), 0), 2) as payout_usd,
  round(avg(pb.win_multiplier), 2) as avg_win_multiplier,
  case
    when count(*) filter (where pb.status in ('won', 'lost')) > 0
      then round((count(*) filter (where pb.status = 'won')::numeric / count(*) filter (where pb.status in ('won', 'lost'))) * 100, 2)
    else null
  end as actual_win_rate_pct
from public.prediction_bets pb
left join public.asset_prices cp on cp.asset_symbol = pb.currency_symbol
group by pb.asset_symbol
order by total_bets desc;

comment on view public.admin_prediction_asset_stats is 'Volumes et taux de victoire réel par actif prédit, à comparer au multiplicateur configuré pour détecter une dérive du RTP.';
