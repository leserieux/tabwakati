-- Déjà appliquée sur le projet Supabase (wakatiapp) le 2026-10-03.
-- La fonction trg_sync_pool_total existait mais n'était branchée sur aucune table : total_staked restait à 0.
drop trigger if exists trg_sync_pool_total on public.user_stakes;
create trigger trg_sync_pool_total
after insert or update of amount, status, pool_id or delete on public.user_stakes
for each row execute function public.trg_sync_pool_total();

update public.staking_pools sp
set total_staked = coalesce((select sum(us.amount) from public.user_stakes us where us.pool_id = sp.id and us.status = 'active'), 0),
    updated_at = now();
