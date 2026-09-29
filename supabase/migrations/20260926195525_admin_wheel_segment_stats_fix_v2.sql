-- Corrige admin_wheel_segment_stats : segment_id est NULL sur une grande partie
-- des tours historiques (tracking ajouté après coup, pas seulement sur les tours
-- gratuits). Le taux de sortie réel doit être calculé sur les tours dont le segment
-- est connu, sinon les pourcentages ne somment jamais à 100% et induisent en erreur.
drop view public.admin_wheel_segment_stats;

create view public.admin_wheel_segment_stats as
select
  seg.id as segment_id,
  seg.label,
  seg.reward_type,
  round(seg.probability * 100, 2) as configured_probability_pct,
  seg.is_jackpot,
  seg.is_active,
  count(ws.id) as actual_hits,
  round(
    case when (select count(*) from public.wheel_spins where segment_id is not null) > 0
      then (count(ws.id)::numeric / (select count(*) from public.wheel_spins where segment_id is not null)) * 100
      else null
    end,
    2
  ) as actual_hit_rate_pct
from public.wheel_segments seg
left join public.wheel_spins ws on ws.segment_id = seg.id
group by seg.id, seg.label, seg.reward_type, seg.probability, seg.is_jackpot, seg.is_active
order by seg.display_order nulls last, seg.id;

comment on view public.admin_wheel_segment_stats is 'Probabilité configurée (en %) vs taux de sortie réel par segment, calculé sur les tours dont le segment est connu (segment_id manquant sur une partie des tours historiques).';
