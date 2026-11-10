-- ════════════════════════════════════════════════════════════════════════
--  Futures — étiquetage correct des frais dans la trésorerie.
--
--  AVANT : à la clôture, la trésorerie recevait / payait un montant NET (marge − somme versée au joueur),
--          qui mélangeait frais périodiques, frais de fermeture et gain/perte de trading. Seuls les frais
--          d'ouverture avaient leur propre ligne (futures_open_fee) → les autres frais étaient invisibles.
--  APRÈS : le règlement est ventilé en lignes distinctes dans platform_fees / treasury_ledger :
--            futures_funding_fee  frais périodiques (prélevés sur la marge pendant la position)
--            futures_close_fee    frais de fermeture
--            futures_settlement   PERTE DE TRADING du joueur (hors frais)        [trésorerie reçoit]
--            « Gain futures … »   GAIN DE TRADING du joueur (hors frais)         [trésorerie paie]
--          Le total versé / reçu par la trésorerie est strictement inchangé.
--
--  Méthode : fn_fut_close_row et fn_fut_close_partial (écrites par d'autres migrations) ne sont PAS
--  recopiées. Le bloc de règlement est remplacé à l'intérieur de leur définition en base ; si ce bloc n'est
--  plus trouvé tel quel, la migration s'arrête (rien n'est modifié).
-- ════════════════════════════════════════════════════════════════════════

-- 1) Ventilation du règlement
create or replace function public.fn_fut_book_settlement(
  p_user uuid, p_ref uuid, p_margin numeric, p_payout numeric, p_fees_funding numeric, p_fees_close numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_sym text; v_total numeric; v_ff numeric; v_fc numeric; v_trade numeric;
begin
  select currency_symbol into v_sym from public.futures_config where id = 1;

  -- Montant net que la trésorerie reçoit (+) ou paie (−) à la clôture : marge rendue − somme versée au joueur
  v_total := p_margin - p_payout;
  v_ff := greatest(coalesce(p_fees_funding, 0), 0);
  v_fc := greatest(coalesce(p_fees_close, 0), 0);
  v_trade := v_total - v_ff - v_fc;                 -- reste = gain (−) ou perte (+) de trading, hors frais

  if v_ff > 0 then perform public.collect_fee_to_platform(v_sym, v_ff, 'futures_funding_fee', p_user, null); end if;
  if v_fc > 0 then perform public.collect_fee_to_platform(v_sym, v_fc, 'futures_close_fee',   p_user, null); end if;

  if v_trade > 0 then
    perform public.collect_fee_to_platform(v_sym, v_trade, 'futures_settlement', p_user, null);
  elsif v_trade < 0 then
    perform public.fn_treasury_debit_for_payout(v_sym, -v_trade, p_user, 'Gain futures ' || p_ref::text);
  end if;
end $$;
revoke all on function public.fn_fut_book_settlement(uuid, uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- 2) Patch ciblé des deux fonctions de clôture
do $patch$
declare
  d text;
  old_row text := $q$  select currency_symbol into v_sym from public.futures_config where id = 1;
  v_delta := r.margin - v_payout;
  if v_delta > 0 then
    perform public.collect_fee_to_platform(v_sym, v_delta, 'futures_settlement', r.user_id, null);
  elsif v_delta < 0 then
    perform public.fn_treasury_debit_for_payout(v_sym, -v_delta, r.user_id, 'Gain futures ' || r.id::text);
  end if;
$q$;
  new_row text := $q$  perform public.fn_fut_book_settlement(r.user_id, r.id, r.margin, v_payout, r.fees_funding, v_fee);
$q$;
  old_part text := $q$  v_sym := c.currency_symbol;
  v_delta := m1 - v_payout;
  if v_delta > 0 then
    perform public.collect_fee_to_platform(v_sym, v_delta, 'futures_settlement', r.user_id, null);
  elsif v_delta < 0 then
    perform public.fn_treasury_debit_for_payout(v_sym, -v_delta, r.user_id, 'Gain futures ' || v_child::text);
  end if;
$q$;
  new_part text := $q$  perform public.fn_fut_book_settlement(r.user_id, v_child, m1, v_payout, ff1, v_fee);
$q$;
begin
  d := pg_get_functiondef('public.fn_fut_close_row(uuid,numeric,text)'::regprocedure);
  if position(old_row in d) = 0 or position(old_row in substr(d, position(old_row in d) + 1)) > 0 then
    raise exception 'fn_fut_close_row a change : bloc de reglement introuvable (ou en double). Patch annule, rien n''est modifie.';
  end if;
  execute replace(d, old_row, new_row);

  d := pg_get_functiondef('public.fn_fut_close_partial(uuid,numeric)'::regprocedure);
  if position(old_part in d) = 0 or position(old_part in substr(d, position(old_part in d) + 1)) > 0 then
    raise exception 'fn_fut_close_partial a change : bloc de reglement introuvable (ou en double). Patch annule, rien n''est modifie.';
  end if;
  execute replace(d, old_part, new_part);
end $patch$;

-- 3) Rattrapage de l'historique : frais périodiques et de fermeture des positions déjà clôturées.
--    Effet NUL sur le solde de la trésorerie : crédit des frais (collect_fee_to_platform) puis débit
--    de compensation du même montant (« Reclassement frais futures »), car le gain avait été payé net de ces frais.
--    Idempotent (une ligne n'est créée que si elle n'existe pas déjà pour cette position).
do $backfill$
declare
  p record; v_sym text; v_id uuid; v_re numeric;
begin
  select currency_symbol into v_sym from public.futures_config where id = 1;
  for p in
    select * from public.futures_positions
     where status = 'closed' and (fees_funding > 0 or fees_close > 0)
     order by closed_at
  loop
    v_re := 0;
    if p.fees_funding > 0 and not exists (
         select 1 from public.platform_fees f
          where f.fee_type = 'futures_funding_fee' and f.source_user_id = p.user_id
            and f.collected_at = p.closed_at and f.amount = p.fees_funding) then
      v_id := public.collect_fee_to_platform(v_sym, p.fees_funding, 'futures_funding_fee', p.user_id, null);
      update public.platform_fees set collected_at = p.closed_at where id = v_id;
      v_re := v_re + p.fees_funding;
    end if;
    if p.fees_close > 0 and not exists (
         select 1 from public.platform_fees f
          where f.fee_type = 'futures_close_fee' and f.source_user_id = p.user_id
            and f.collected_at = p.closed_at and f.amount = p.fees_close) then
      v_id := public.collect_fee_to_platform(v_sym, p.fees_close, 'futures_close_fee', p.user_id, null);
      update public.platform_fees set collected_at = p.closed_at where id = v_id;
      v_re := v_re + p.fees_close;
    end if;
    if v_re > 0 then
      perform public.fn_treasury_debit_for_payout(v_sym, v_re, p.user_id, 'Reclassement frais futures ' || p.id::text);
    end if;
  end loop;
end $backfill$;
