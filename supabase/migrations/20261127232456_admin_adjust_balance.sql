-- Ajustement manuel de solde par un admin (crédit / débit), atomique et traçable.
-- Cas principal : régulariser un dépôt « failed/pending » après vérification (p_deposit_tx_id) : la transaction
-- existante passe à « completed » (pas de doublon, pas de double crédit possible).
-- Réservé au service_role (dashboard). Le grand livre `balance_ledger` est alimenté par le déclencheur existant.
create or replace function public.fn_admin_adjust_balance(
  p_user_id uuid,
  p_asset_symbol text,
  p_direction text,
  p_amount numeric,
  p_reason text,
  p_actor text,
  p_deposit_tx_id uuid default null,
  p_notify boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_before numeric;
  v_after numeric;
  v_tx public.transactions%rowtype;
  v_tx_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if current_role not in ('service_role', 'postgres', 'supabase_admin') then
    return jsonb_build_object('success', false, 'error', 'Accès non autorisé');
  end if;
  if p_direction not in ('credit', 'debit') then
    return jsonb_build_object('success', false, 'error', 'Sens invalide');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Le montant doit être supérieur à 0');
  end if;
  if char_length(v_reason) < 5 then
    return jsonb_build_object('success', false, 'error', 'Motif obligatoire (5 caractères minimum)');
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    return jsonb_build_object('success', false, 'error', 'Utilisateur introuvable');
  end if;
  if not exists (select 1 from public.supported_assets where symbol = p_asset_symbol) then
    return jsonb_build_object('success', false, 'error', 'Actif inconnu');
  end if;
  if p_deposit_tx_id is not null and p_direction <> 'credit' then
    return jsonb_build_object('success', false, 'error', 'Un dépôt à régulariser ne peut être que crédité');
  end if;

  if p_deposit_tx_id is not null then
    select * into v_tx from public.transactions where id = p_deposit_tx_id for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'Dépôt introuvable');
    end if;
    if v_tx.type <> 'deposit' or v_tx.user_id <> p_user_id or v_tx.asset_symbol <> p_asset_symbol then
      return jsonb_build_object('success', false, 'error', 'Ce dépôt ne correspond pas à cet utilisateur / actif');
    end if;
    if v_tx.status = 'completed' then
      return jsonb_build_object('success', false, 'error', 'Ce dépôt est déjà crédité');
    end if;
  end if;

  select available_balance into v_before from public.user_balances
   where user_id = p_user_id and asset_symbol = p_asset_symbol for update;
  if not found then
    if p_direction = 'debit' then
      return jsonb_build_object('success', false, 'error', 'Aucun solde pour cet actif');
    end if;
    insert into public.user_balances (user_id, asset_symbol, available_balance, staking_balance, updated_at)
    values (p_user_id, p_asset_symbol, 0, 0, now());
    v_before := 0;
  end if;
  v_before := coalesce(v_before, 0);

  if p_direction = 'debit' and v_before < p_amount then
    return jsonb_build_object('success', false, 'error',
      format('Solde disponible insuffisant (%s %s)', v_before, p_asset_symbol));
  end if;

  update public.user_balances
     set available_balance = case when p_direction = 'credit' then coalesce(available_balance,0) + p_amount
                                  else coalesce(available_balance,0) - p_amount end,
         total_deposited = case when p_deposit_tx_id is not null then coalesce(total_deposited,0) + p_amount else total_deposited end,
         updated_at = now()
   where user_id = p_user_id and asset_symbol = p_asset_symbol
   returning available_balance into v_after;

  if p_deposit_tx_id is not null then
    update public.transactions
       set status = 'completed', completed_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'manual_credit', true, 'manual_credit_by', p_actor, 'manual_credit_reason', v_reason,
             'manual_credit_amount', p_amount, 'manual_credit_previous_status', v_tx.status, 'manual_credit_at', now())
     where id = p_deposit_tx_id;
    v_tx_id := p_deposit_tx_id;
  else
    insert into public.transactions (user_id, type, asset_symbol, amount, net_amount, status, completed_at, metadata)
    values (p_user_id, 'balance_adjustment', p_asset_symbol, p_amount, p_amount, 'completed', now(),
            jsonb_build_object('direction', p_direction, 'reason', v_reason, 'actor', p_actor,
                               'balance_before', v_before, 'balance_after', v_after, 'manual', true))
    returning id into v_tx_id;
  end if;

  if p_notify and p_direction = 'credit' then
    insert into public.notifications (user_id, type, title, message, data)
    values (p_user_id, case when p_deposit_tx_id is not null then 'deposit_confirmed' else 'balance_adjustment' end,
            case when p_deposit_tx_id is not null then 'Dépôt confirmé ✅' else 'Solde crédité' end,
            format('%s %s ont été crédités sur votre compte.', p_amount, p_asset_symbol),
            jsonb_build_object('transaction_id', v_tx_id, 'amount', p_amount, 'asset', p_asset_symbol));
  end if;

  return jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'balance_before', v_before,
                            'balance_after', v_after, 'direction', p_direction, 'amount', p_amount);
end;
$function$;

revoke all on function public.fn_admin_adjust_balance(uuid, text, text, numeric, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_admin_adjust_balance(uuid, text, text, numeric, text, text, uuid, boolean) to service_role;
