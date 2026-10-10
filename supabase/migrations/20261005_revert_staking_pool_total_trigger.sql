-- Appliquée sur le projet Supabase (wakatiapp) le 2026-10-05.
drop trigger if exists trg_sync_pool_total on public.user_stakes;
update public.staking_pools sp
set total_staked = coalesce((select sum(us.amount) from public.user_stakes us where us.pool_id = sp.id and us.status = 'active'), 0),
    updated_at = now();
