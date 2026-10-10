-- 1. wakati_price_history : la ligne reste lisible par tous (RLS), mais seules les colonnes de prix sont
--    exposées à anon / authenticated. Bénéfice net, contribution à la réserve, réserve, offre et burn
--    ne sont lisibles que par le service_role (dashboard).
revoke select on public.wakati_price_history from anon, authenticated;
grant select (id, computed_for_date, price_before_usd, final_price_usd, created_at)
  on public.wakati_price_history to anon, authenticated;

-- 2. Garde-fous de validité sur les réglages modifiables depuis le dashboard.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'burn_settings_ranges_chk') then
    alter table public.burn_settings add constraint burn_settings_ranges_chk check (
      (max_treasury_pct_per_day is null or (max_treasury_pct_per_day > 0 and max_treasury_pct_per_day <= 100))
      and (max_daily_burn_wakati is null or max_daily_burn_wakati > 0)
      and min_burn_wakati >= 0
      and min_treasury_keep_wakati >= 0
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wakati_reserve_state_ranges_chk') then
    alter table public.wakati_reserve_state add constraint wakati_reserve_state_ranges_chk check (
      profit_share_pct >= 0 and profit_share_pct <= 100
      and max_daily_change_pct > 0 and max_daily_change_pct <= 100
      and price_floor_usd > 0
    );
  end if;
end $$;
