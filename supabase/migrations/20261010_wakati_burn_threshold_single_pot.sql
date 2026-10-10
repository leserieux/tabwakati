-- Règle : tant que le WAKATI vaut moins que burn_start_price_fcfa (1 FCFA), AUCUN burn et tout le bénéfice
-- va dans la caisse (réserve de prix). À partir du seuil, burn_share_pct % du bénéfice net positif du jour
-- est brûlé et le reste va dans la caisse. Un seul bénéfice net (celui du prix), un seul partage : pas de chevauchement.
-- Remplace l'ancien calcul fn_burn_compute / burn_rules (conservés mais plus utilisés).

alter table public.burn_settings
  add column if not exists burn_start_price_fcfa numeric not null default 1 check (burn_start_price_fcfa > 0),
  add column if not exists burn_share_pct numeric not null default 30 check (burn_share_pct >= 0 and burn_share_pct <= 100);

alter table public.wakati_price_history
  add column if not exists burn_pct_applied numeric not null default 0,
  add column if not exists burn_allocation_usd numeric not null default 0,
  add column if not exists burn_settled_at timestamptz;

create or replace function public.fn_wakati_burn_status()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare s burn_settings%rowtype; p numeric; f numeric;
begin
  select * into s from burn_settings where id = 1;
  select price_usd into p from asset_prices where asset_symbol = 'WAKATI';
  select price_usd into f from asset_prices_resolved where asset_symbol = 'FCFA';
  return jsonb_build_object(
    'enabled', s.enabled,
    'wakati_price_usd', p,
    'fcfa_price_usd', f,
    'wakati_price_fcfa', case when coalesce(f, 0) > 0 then p / f end,
    'threshold_fcfa', s.burn_start_price_fcfa,
    'burn_share_pct', s.burn_share_pct,
    'active', coalesce(s.enabled and coalesce(f, 0) > 0 and p >= s.burn_start_price_fcfa * f, false)
  );
end $function$;
revoke execute on function public.fn_wakati_burn_status() from public, anon, authenticated;
grant execute on function public.fn_wakati_burn_status() to service_role;

create or replace function public.fn_compute_wakati_daily_price()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_state          public.wakati_reserve_state%ROWTYPE;
  v_period_start   timestamptz := date_trunc('day', now()) - interval '1 day';
  v_period_end     timestamptz := date_trunc('day', now());
  v_revenue_usd    numeric;
  v_payouts_usd    numeric;
  v_net_profit_usd numeric;
  v_contribution   numeric;
  v_reserve_new    numeric;
  v_circulating    numeric;
  v_price_old      numeric;
  v_raw_price      numeric;
  v_min_allowed    numeric;
  v_max_allowed    numeric;
  v_capped_price   numeric;
  v_final_price    numeric;
  v_was_capped     boolean := false;
  v_burn_active    boolean;
  v_burn_pct       numeric := 0;
  v_burn_alloc     numeric := 0;
BEGIN
  SELECT * INTO v_state FROM public.wakati_reserve_state WHERE id = 1 FOR UPDATE;
  IF NOT FOUND OR NOT v_state.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Systeme de prix WAKATI inactif ou non configure');
  END IF;

  SELECT COALESCE(SUM(pf.amount * ap.price_usd), 0) INTO v_revenue_usd
  FROM public.platform_fees pf
  JOIN public.asset_prices ap ON ap.asset_symbol = pf.asset_symbol
  WHERE pf.is_test = false
    AND pf.fee_type != 'game_net_loss'
    AND pf.collected_at >= v_period_start
    AND pf.collected_at < v_period_end;

  SELECT COALESCE(SUM(t.amount * ap.price_usd), 0) INTO v_payouts_usd
  FROM public.transactions t
  JOIN public.asset_prices ap ON ap.asset_symbol = t.asset_symbol
  WHERE t.type IN ('game_win', 'referral_bonus', 'staking_reward')
    AND t.status = 'completed'
    AND t.created_at >= v_period_start
    AND t.created_at < v_period_end;

  v_net_profit_usd := v_revenue_usd - v_payouts_usd;

  -- Partage unique du bénéfice net : burn seulement si le prix a atteint le seuil (en FCFA) ET bénéfice positif.
  -- Sinon 100 % va dans la caisse. Les jours de perte sont absorbés par la caisse, jamais par un burn.
  v_burn_active := coalesce((public.fn_wakati_burn_status() ->> 'active')::boolean, false);
  IF v_net_profit_usd > 0 AND v_burn_active THEN
    SELECT burn_share_pct INTO v_burn_pct FROM public.burn_settings WHERE id = 1;
    v_burn_alloc := round(v_net_profit_usd * v_burn_pct / 100, 8);
  END IF;

  IF v_net_profit_usd > 0 THEN
    v_contribution := (v_net_profit_usd - v_burn_alloc) * v_state.profit_share_pct / 100;
  ELSE
    v_contribution := v_net_profit_usd * v_state.profit_share_pct / 100;
  END IF;
  v_reserve_new  := GREATEST(v_state.reserve_usd + v_contribution, 0);

  SELECT COALESCE(SUM(available_balance), 0) INTO v_circulating
  FROM public.user_balances WHERE asset_symbol = 'WAKATI';

  SELECT price_usd INTO v_price_old FROM public.asset_prices WHERE asset_symbol = 'WAKATI';

  IF v_circulating <= 0 THEN
    v_raw_price := v_price_old;
  ELSE
    v_raw_price := v_reserve_new / v_circulating;
  END IF;

  v_min_allowed  := v_price_old * (1 - v_state.max_daily_change_pct / 100);
  v_max_allowed  := v_price_old * (1 + v_state.max_daily_change_pct / 100);
  v_capped_price := LEAST(GREATEST(v_raw_price, v_min_allowed), v_max_allowed);
  v_was_capped   := (v_capped_price != v_raw_price);

  v_final_price := GREATEST(v_capped_price, v_state.price_floor_usd);

  UPDATE public.asset_prices SET price_usd = v_final_price, updated_at = now() WHERE asset_symbol = 'WAKATI';

  UPDATE public.wakati_reserve_state
  SET reserve_usd = v_reserve_new, last_computed_at = now(), updated_at = now()
  WHERE id = 1;

  INSERT INTO public.wakati_price_history (
    computed_for_date, net_profit_usd, reserve_contribution_usd, reserve_usd_after,
    circulating_supply, price_before_usd, raw_price_usd, final_price_usd, was_capped,
    burn_pct_applied, burn_allocation_usd
  ) VALUES (
    v_period_start::date, v_net_profit_usd, v_contribution, v_reserve_new,
    v_circulating, v_price_old, v_raw_price, v_final_price, v_was_capped,
    CASE WHEN v_burn_alloc > 0 THEN v_burn_pct ELSE 0 END, v_burn_alloc
  );

  RETURN jsonb_build_object(
    'success', true,
    'period', v_period_start::date,
    'net_profit_usd', v_net_profit_usd,
    'reserve_contribution_usd', v_contribution,
    'burn_active', v_burn_active,
    'burn_allocation_usd', v_burn_alloc,
    'reserve_usd', v_reserve_new,
    'circulating_supply', v_circulating,
    'price_old', v_price_old,
    'price_new', v_final_price,
    'was_capped', v_was_capped
  );
END;
$function$;

create or replace function public.fn_run_burn(p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  s burn_settings%rowtype;
  v_from timestamptz; v_to timestamptz := now();
  v_status jsonb; v_active boolean;
  v_price numeric; v_new_due numeric; v_total_due numeric; v_due_w numeric;
  v_treasury numeric; v_burn numeric; v_out numeric;
  v_state text; v_note text; v_details jsonb;
  v_res jsonb; v_burn_id uuid; v_run_id uuid;
begin
  select * into s from burn_settings where id = 1 for update;
  if not found then raise exception 'burn_settings introuvable'; end if;
  v_from := s.last_run_at;
  v_status := fn_wakati_burn_status();
  v_active := coalesce((v_status ->> 'active')::boolean, false);

  -- Montants déjà retirés du bénéfice par fn_compute_wakati_daily_price et pas encore brûlés.
  select coalesce(sum(burn_allocation_usd), 0),
         coalesce(jsonb_agg(jsonb_build_object('date', computed_for_date, 'burn_pct', burn_pct_applied, 'due_usd', burn_allocation_usd) order by computed_for_date), '[]'::jsonb)
    into v_new_due, v_details
    from wakati_price_history where burn_allocation_usd > 0 and burn_settled_at is null;

  v_total_due := s.carry_due_usd + v_new_due;

  if not s.enabled and not p_force then
    insert into burn_runs (window_from, window_to, status, note, details)
    values (v_from, v_to, 'paused', 'Burn en pause : tout le bénéfice va dans la caisse', v_details)
    returning id into v_run_id;
    update burn_settings set last_run_at = v_to, updated_at = now() where id = 1;
    return jsonb_build_object('success', true, 'status', 'paused', 'run_id', v_run_id);
  end if;

  if v_total_due <= 0 then
    v_note := case when not v_active
      then 'Prix ' || round(coalesce((v_status ->> 'wakati_price_fcfa')::numeric, 0), 4) || ' FCFA sous le seuil de ' || s.burn_start_price_fcfa || ' FCFA : tout va dans la caisse'
      else 'Aucun bénéfice à brûler sur la période' end;
    insert into burn_runs (window_from, window_to, status, wakati_price_usd, note, details)
    values (v_from, v_to, 'empty', (v_status ->> 'wakati_price_usd')::numeric, v_note, v_details)
    returning id into v_run_id;
    update burn_settings set last_run_at = v_to, updated_at = now() where id = 1;
    return jsonb_build_object('success', true, 'status', 'empty', 'run_id', v_run_id, 'note', v_note);
  end if;

  select price_usd into v_price from asset_prices_resolved where asset_symbol = 'WAKATI';
  if v_price is null or v_price <= 0 then raise exception 'Prix WAKATI indisponible : burn reporté'; end if;

  v_due_w := round(v_total_due / v_price, 8);
  select coalesce(balance, 0) into v_treasury from treasury_wallets where asset_symbol = 'WAKATI';

  -- Garde-fous : plafond journalier absolu, plafond en % de la trésorerie, réserve minimale à conserver
  v_burn := v_due_w;
  if s.max_daily_burn_wakati is not null then v_burn := least(v_burn, s.max_daily_burn_wakati); end if;
  if s.max_treasury_pct_per_day is not null then v_burn := least(v_burn, round(v_treasury * s.max_treasury_pct_per_day / 100, 8)); end if;
  v_burn := least(v_burn, greatest(v_treasury - s.min_treasury_keep_wakati, 0));
  v_burn := round(v_burn, 8);
  if v_burn <= 0 or v_burn < s.min_burn_wakati then v_burn := 0; end if;

  v_out := round(greatest(v_total_due - v_burn * v_price, 0), 8);

  if v_burn > 0 then
    v_res := fn_burn_tokens('WAKATI', v_burn,
      'Burn automatique : ' || round(v_total_due, 6) || ' $ dus (part du bénéfice net) convertis au cours de ' || v_price || ' $', null, null);
    if coalesce((v_res ->> 'success')::boolean, false) is not true then
      raise exception 'Burn refusé : %', coalesce(v_res ->> 'error', 'erreur inconnue');
    end if;
    v_burn_id := (v_res ->> 'burn_id')::uuid;
    update token_burns set status = 'pending_onchain' where id = v_burn_id;   -- burn comptable : à envoyer on-chain
    v_state := 'burned';
    v_note := case when v_out > 0 then 'Plafonné : ' || round(v_out, 6) || ' $ reportés' else null end;
  else
    v_state := 'carried';
    v_note := 'Sous le seuil minimum ou plafond atteint : ' || round(v_out, 6) || ' $ reportés';
  end if;

  update wakati_price_history set burn_settled_at = v_to where burn_allocation_usd > 0 and burn_settled_at is null;
  update burn_settings set last_run_at = v_to, carry_due_usd = v_out, updated_at = now() where id = 1;
  insert into burn_runs (window_from, window_to, status, wakati_price_usd, new_due_usd, carried_in_usd, burn_wakati, carried_out_usd, burn_id, forced, note, details)
  values (v_from, v_to, v_state, v_price, v_new_due, s.carry_due_usd, v_burn, v_out, v_burn_id, p_force, v_note, v_details)
  returning id into v_run_id;

  return jsonb_build_object('success', true, 'status', v_state, 'run_id', v_run_id, 'new_due_usd', v_new_due,
                            'carried_in_usd', s.carry_due_usd, 'wakati_burned', v_burn, 'carried_out_usd', v_out, 'burn_id', v_burn_id);
end $function$;
