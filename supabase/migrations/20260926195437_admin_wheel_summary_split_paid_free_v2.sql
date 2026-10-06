-- Corrige admin_wheel_summary : mélanger tours payants et tours gratuits (bet_amount = 0)
-- donnait un RTP de 128% qui alarme à tort. Le RTP n'a de sens que sur les tours
-- payants (mise réelle) ; le coût des tours gratuits est un coût promotionnel séparé,
-- utile à connaître mais pas comparable à un taux de retour au joueur.
drop view public.admin_wheel_summary;

create view public.admin_wheel_summary as
select
  count(*) as total_spins,
  count(*) filter (where ws.bet_amount > 0) as paid_spins,
  count(*) filter (where ws.bet_amount = 0) as free_spins,
  count(*) filter (where ws.final_reward_amount > 0) as winning_spins,

  round(coalesce(sum(ws.bet_amount * coalesce(bp.price_usd, 0)) filter (where ws.bet_amount > 0), 0), 2) as paid_bet_usd,
  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) filter (where ws.bet_amount > 0), 0), 2) as paid_payout_usd,
  case
    when sum(ws.bet_amount * coalesce(bp.price_usd, 0)) filter (where ws.bet_amount > 0) > 0
      then round(
        (sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) filter (where ws.bet_amount > 0)
          / sum(ws.bet_amount * coalesce(bp.price_usd, 0)) filter (where ws.bet_amount > 0)) * 100,
        2
      )
    else null
  end as rtp_paid_pct,

  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) filter (where ws.bet_amount = 0), 0), 2) as free_spins_cost_usd,

  count(*) filter (where seg.is_jackpot) as jackpot_hits,
  round(coalesce(sum(ws.final_reward_amount * coalesce(rp.price_usd, 0)) filter (where seg.is_jackpot), 0), 2) as jackpot_paid_usd
from public.wheel_spins ws
left join public.asset_prices bp on bp.asset_symbol = ws.bet_asset
left join public.asset_prices rp on rp.asset_symbol = ws.reward_asset
left join public.wheel_segments seg on seg.id = ws.segment_id;

comment on view public.admin_wheel_summary is 'Résumé global de la roue, RTP calculé uniquement sur les tours payants (les tours gratuits ont un coût promotionnel distinct, sans mise réelle).';
