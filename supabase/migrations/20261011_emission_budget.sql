-- Plafond d'émission WAKATI, entièrement configurable depuis la base (et depuis le dashboard : WAKATI > Offre).
-- Budget de la fenêtre = solde de trésorerie WAKATI × budget_pct_per_month % × window_days / 30.
-- Consommation = émissions "incitatives" journalisées (staking, parrainage) + émission nette des jeux (gains - mises).
-- Les gains de jeux sont comptés mais jamais bloqués (un tirage ne peut pas être refusé après coup).
-- En cas de dépassement : le staking du jour est réduit proportionnellement, le bonus de parrainage est sauté
-- (le parrainage lui-même et l'inscription fonctionnent toujours). Toute erreur du plafond laisse le paiement passer.

create table if not exists public.emission_settings (
  id integer primary key check (id = 1),
  enabled boolean not null default true,
  enforce boolean not null default true,
  budget_pct_per_month numeric not null default 0.5 check (budget_pct_per_month > 0 and budget_pct_per_month <= 100),
  window_days integer not null default 30 check (window_days between 1 and 365),
  count_game_net boolean not null default true,
  gate_staking boolean not null default true,
  gate_referral boolean not null default true,
  referral_bonus_referred numeric not null default 300 check (referral_bonus_referred >= 0),
  referral_bonus_referrer numeric not null default 200 check (referral_bonus_referrer >= 0),
  price_step_wakati numeric not null default 10000 check (price_step_wakati > 0),
  runway_window_days integer not null default 90 check (runway_window_days between 7 and 365),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.emission_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.emission_log (
  id bigserial primary key,
  logged_at timestamptz not null default now(),
  source text not null,
  requested numeric not null,
  allowed numeric not null,
  budget numeric,
  used_before numeric
);
create index if not exists emission_log_logged_at_idx on public.emission_log (logged_at desc);

alter table public.emission_settings enable row level security;
alter table public.emission_log enable row level security;
revoke all on public.emission_settings, public.emission_log from anon, authenticated;
revoke all on sequence public.emission_log_id_seq from anon, authenticated;

create or replace function public.fn_emission_status()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  s emission_settings%rowtype;
  v_treasury numeric; v_budget numeric; v_logged numeric; v_game numeric := 0; v_used numeric; v_since timestamptz;
begin
  select * into s from emission_settings where id = 1;
  if not found then return jsonb_build_object('configured', false); end if;
  v_since := now() - make_interval(days => s.window_days);
  select coalesce(balance, 0) into v_treasury from treasury_wallets where asset_symbol = 'WAKATI';
  v_treasury := coalesce(v_treasury, 0);
  v_budget := v_treasury * s.budget_pct_per_month / 100 * (s.window_days / 30.0);
  select coalesce(sum(allowed), 0) into v_logged from emission_log where logged_at >= v_since and source in ('staking', 'referral');
  if s.count_game_net then
    select greatest(coalesce(sum(case when type = 'game_win' then amount when type = 'game_bet' then -amount else 0 end), 0), 0)
      into v_game
      from transactions
      where asset_symbol = 'WAKATI' and status = 'completed' and type in ('game_win', 'game_bet') and created_at >= v_since;
  end if;
  v_used := v_logged + v_game;
  return jsonb_build_object(
    'configured', true, 'enabled', s.enabled, 'enforce', s.enforce,
    'treasury', v_treasury, 'budget', v_budget, 'window_days', s.window_days,
    'incentives_used', v_logged, 'game_net_used', v_game, 'used', v_used,
    'remaining', greatest(v_budget - v_used, 0),
    'usage_pct', case when v_budget > 0 then v_used / v_budget * 100 end
  );
end $function$;

create or replace function public.fn_emission_allow(p_source text, p_amount numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s emission_settings%rowtype; st jsonb; v_remaining numeric; v_allowed numeric; v_gated boolean;
begin
  if p_amount is null or p_amount <= 0 then return coalesce(p_amount, 0); end if;
  select * into s from emission_settings where id = 1;
  if not found or not s.enabled then return p_amount; end if;
  perform pg_advisory_xact_lock(hashtext('wakati_emission_budget'));
  st := fn_emission_status();
  v_remaining := (st ->> 'remaining')::numeric;
  v_gated := s.enforce and ((p_source = 'staking' and s.gate_staking) or (p_source = 'referral' and s.gate_referral));
  v_allowed := case when v_gated then least(p_amount, v_remaining) else p_amount end;
  insert into emission_log (source, requested, allowed, budget, used_before)
  values (p_source, p_amount, v_allowed, (st ->> 'budget')::numeric, (st ->> 'used')::numeric);
  return v_allowed;
exception when others then
  return p_amount;   -- jamais de paiement bloqué à cause du plafond
end $function$;

revoke execute on function public.fn_emission_status() from public, anon, authenticated;
revoke execute on function public.fn_emission_allow(text, numeric) from public, anon, authenticated;
grant execute on function public.fn_emission_status() to service_role;
grant execute on function public.fn_emission_allow(text, numeric) to service_role;

-- Staking : le calcul quotidien (00:05 UTC) applique un facteur <= 1 si le budget ne suffit pas.
create or replace function public.distribute_staking_rewards()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_apr        numeric;
  v_daily_rate numeric;
  v_count      int := 0;
  v_total_dist numeric := 0;
  v_allowed    numeric;
  v_factor     numeric := 1;
BEGIN
  SELECT apr INTO v_apr FROM staking_config WHERE id = 1;
  IF v_apr IS NULL OR v_apr <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'APR non configuré');
  END IF;

  v_daily_rate := v_apr / 100.0 / 365.0;

  SELECT COALESCE(SUM(amount * v_daily_rate), 0) INTO v_total_dist
  FROM user_stakes
  WHERE status = 'active'
    AND pool_id = 'f6c208e1-f277-4720-b303-45c1b607bf1f';

  IF v_total_dist > 0 THEN
    v_allowed := public.fn_emission_allow('staking', v_total_dist);
    v_factor  := LEAST(1, GREATEST(v_allowed / v_total_dist, 0));
  END IF;

  UPDATE user_stakes SET
    pending_rewards         = pending_rewards + (amount * v_daily_rate * v_factor),
    last_reward_calculation = now(),
    updated_at              = now()
  WHERE status  = 'active'
    AND pool_id = 'f6c208e1-f277-4720-b303-45c1b607bf1f';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'stakers_updated', v_count,
    'apr_used', v_apr,
    'budget_factor', ROUND(v_factor, 6),
    'total_distributed_today', ROUND(v_total_dist * v_factor, 8)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Parrainage : montants lus dans emission_settings (plus de 300 / 200 en dur) et bonus sauté si le budget est épuisé.
create or replace function public.complete_user_profile(p_user_id uuid, p_username text, p_referral_code text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_referrer           RECORD;
  v_referral_applied    boolean := false;
  v_referrer_username   text;
  v_bonus_referred      numeric := 300;
  v_bonus_referrer      numeric := 200;
  v_bonus_asset         text    := 'WAKATI';
  v_bonus_total         numeric;
  v_bonus_allowed       numeric;
  v_bonus_skipped       boolean := false;
  v_clean_username      text;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN', 'message', 'Action non autorisée');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND', 'message', 'Utilisateur introuvable');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND profile_completed = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_COMPLETED', 'message', 'Profil déjà complété');
  END IF;

  v_clean_username := LOWER(TRIM(p_username));
  v_clean_username := REGEXP_REPLACE(v_clean_username, '[^a-zA-Z0-9_]', '', 'g');

  IF LENGTH(v_clean_username) > 20 THEN
    v_clean_username := SUBSTRING(v_clean_username FROM 1 FOR 20);
  END IF;

  IF LENGTH(v_clean_username) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TOO_SHORT', 'message', 'Le username doit faire au moins 3 caractères');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_clean_username AND id != p_user_id) THEN
    v_clean_username := SUBSTRING(v_clean_username FROM 1 FOR 18) || SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 2);
    IF EXISTS (SELECT 1 FROM public.users WHERE username = v_clean_username AND id != p_user_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'USERNAME_TAKEN', 'message', 'Ce username est déjà pris, essaie un autre');
    END IF;
  END IF;

  IF p_referral_code IS NOT NULL AND TRIM(p_referral_code) != '' THEN

    IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND referred_by IS NOT NULL) THEN
      RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REFERRED', 'message', 'Tu as déjà utilisé un code referral');
    END IF;

    SELECT id, username INTO v_referrer
    FROM public.users
    WHERE referral_code = UPPER(TRIM(p_referral_code))
      AND id != p_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Code referral invalide ou inexistant');
    END IF;

    v_referral_applied  := true;
    v_referrer_username := v_referrer.username;

    UPDATE public.users SET referred_by = v_referrer.id, updated_at = NOW() WHERE id = p_user_id;

    -- Montants configurables (emission_settings) ; valeurs historiques 300 / 200 si la ligne manque.
    SELECT referral_bonus_referred, referral_bonus_referrer
      INTO v_bonus_referred, v_bonus_referrer
      FROM public.emission_settings WHERE id = 1;
    IF NOT FOUND THEN
      v_bonus_referred := 300;
      v_bonus_referrer := 200;
    END IF;

    -- Plafond d'émission : si le budget ne couvre pas les deux bonus, aucun bonus n'est versé (le parrainage reste appliqué).
    v_bonus_total := v_bonus_referred + v_bonus_referrer;
    IF v_bonus_total > 0 THEN
      v_bonus_allowed := public.fn_emission_allow('referral', v_bonus_total);
      IF v_bonus_allowed < v_bonus_total THEN
        v_bonus_referred := 0;
        v_bonus_referrer := 0;
        v_bonus_skipped  := true;
      END IF;
    END IF;

    IF v_bonus_referred > 0 THEN
      INSERT INTO public.user_balances (user_id, asset_symbol, available_balance)
      VALUES (p_user_id, v_bonus_asset, v_bonus_referred)
      ON CONFLICT (user_id, asset_symbol) DO UPDATE
        SET available_balance = user_balances.available_balance + v_bonus_referred, updated_at = NOW();

      INSERT INTO public.transactions (user_id, type, asset_symbol, amount, status, metadata)
      VALUES (p_user_id, 'referral_bonus', v_bonus_asset, v_bonus_referred, 'completed',
        jsonb_build_object('referrer_id', v_referrer.id, 'referrer_username', v_referrer_username, 'recipient_type', 'referred'));

      PERFORM fn_treasury_debit_for_payout(v_bonus_asset, v_bonus_referred, p_user_id, 'Bonus parrainage - filleul');
    END IF;

    IF v_bonus_referrer > 0 THEN
      INSERT INTO public.user_balances (user_id, asset_symbol, available_balance)
      VALUES (v_referrer.id, v_bonus_asset, v_bonus_referrer)
      ON CONFLICT (user_id, asset_symbol) DO UPDATE
        SET available_balance = user_balances.available_balance + v_bonus_referrer, updated_at = NOW();

      INSERT INTO public.transactions (user_id, type, asset_symbol, amount, status, metadata)
      VALUES (v_referrer.id, 'referral_bonus', v_bonus_asset, v_bonus_referrer, 'completed',
        jsonb_build_object('referred_user_id', p_user_id, 'referred_username', v_clean_username, 'recipient_type', 'referrer'));

      PERFORM fn_treasury_debit_for_payout(v_bonus_asset, v_bonus_referrer, v_referrer.id, 'Bonus parrainage - parrain');
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, data) VALUES (
      v_referrer.id, 'referral_success', 'Nouveau filleul !',
      CASE WHEN v_bonus_referrer > 0
        THEN format('%s a rejoint Wakati avec ton code. +%s %s crédités !', v_clean_username, v_bonus_referrer, v_bonus_asset)
        ELSE format('%s a rejoint Wakati avec ton code.', v_clean_username) END,
      jsonb_build_object('referred_user_id', p_user_id, 'referred_username', v_clean_username, 'bonus_amount', v_bonus_referrer)
    );

    INSERT INTO public.notifications (user_id, type, title, message, data) VALUES (
      p_user_id, 'referral_bonus', 'Code referral appliqué !',
      CASE WHEN v_bonus_referred > 0
        THEN format('+%s %s crédités grâce au code de %s', v_bonus_referred, v_bonus_asset, v_referrer_username)
        ELSE format('Code de %s appliqué.', v_referrer_username) END,
      jsonb_build_object('referrer_id', v_referrer.id, 'referrer_username', v_referrer_username, 'bonus_amount', v_bonus_referred)
    );

  END IF;

  UPDATE public.users
  SET username = v_clean_username, profile_completed = true, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success',           true,
    'username',          v_clean_username,
    'profile_completed', true,
    'referral_applied',  v_referral_applied,
    'referrer_username', v_referrer_username,
    'bonus_amount',      CASE WHEN v_referral_applied THEN v_bonus_referred ELSE 0 END,
    'bonus_asset',       v_bonus_asset,
    'bonus_skipped',     v_bonus_skipped,
    'message',           CASE
                           WHEN v_referral_applied AND v_bonus_referred > 0
                           THEN format('Bienvenue ! +%s %s crédités.', v_bonus_referred, v_bonus_asset)
                           WHEN v_referral_applied
                           THEN 'Bienvenue ! Code appliqué.'
                           ELSE 'Profil complété avec succès.'
                         END
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'INTERNAL_ERROR', 'message', SQLERRM);
END;
$function$;
