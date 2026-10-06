-- OPTIONNELLE — NON APPLIQUÉE automatiquement. À lancer à la main si vous voulez aligner la base sur le code.
--
-- Contexte : le dashboard (lib/metrics/rules.ts) exclut des « frais » les lignes is_test = true,
-- game_house_edge (déjà comprise dans les mises, sinon double comptage) et game_net_loss (signal de crédit).
-- La fonction SQL get_platform_fees_totals() n'excluait que game_net_loss : l'ancienne Vue d'ensemble
-- affichait donc des « Frais cumulés » plus élevés que la page Résultat (P&L).
-- Le code n'appelle plus cette fonction (frais lus via lib/metrics/fees.ts) ; cette migration ne sert
-- qu'à garder la base cohérente pour tout autre lecteur (rapports, scripts, snapshots).

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
