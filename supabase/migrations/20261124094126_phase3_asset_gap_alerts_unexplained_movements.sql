
insert into public.admin_alert_settings(key, value, description) values
  ('movement_match_window_seconds', 120, 'Un mouvement de solde est « expliqué » si une transaction du même utilisateur existe dans cette fenêtre (secondes) autour'),
  ('movement_grace_seconds', 300, 'Délai laissé avant de juger un mouvement (secondes), pour qu''une transaction écrite plus tard puisse arriver')
on conflict (key) do nothing;

-- Remplace la version précédente : le contrôle « soldes contre dettes » est supprimé car tautologique
-- (get_asset_liabilities somme les soldes eux-mêmes : l'écart vaut toujours 0). On le remplace par la détection
-- des mouvements de solde SANS transaction associée (crédit fantôme, modification manuelle, bug).
create or replace function public.fn_admin_check_asset_gaps()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tol numeric := coalesce((select value from public.admin_alert_settings where key = 'asset_gap_tolerance'), 0.000001);
  v_win numeric := coalesce((select value from public.admin_alert_settings where key = 'movement_match_window_seconds'), 120);
  v_grace numeric := coalesce((select value from public.admin_alert_settings where key = 'movement_grace_seconds'), 300);
  v_items jsonb := '[]'::jsonb;
  r record;
begin
  -- a) Staking incohérent, soldes négatifs
  for r in select * from public.get_admin_reconciliation() loop
    if abs(coalesce(r.staking_orphan,0)) > v_tol then
      v_items := v_items || jsonb_build_array(jsonb_build_object('key','staking_'||r.asset_symbol,'severity','high',
        'title','Staking incohérent : '||r.asset_symbol||' (écart '||r.staking_orphan||' entre soldes bloqués et stakes actifs)',
        'details', jsonb_build_object('asset', r.asset_symbol, 'staking_orphan', r.staking_orphan, 'staking_balance_total', r.staking_balance_total, 'active_stakes_total', r.active_stakes_total, 'tolerance', v_tol)));
    end if;
    if coalesce(r.negative_rows,0) > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object('key','negative_'||r.asset_symbol,'severity','critical',
        'title','Solde négatif : '||r.asset_symbol||' ('||r.negative_rows||' ligne(s))',
        'details', jsonb_build_object('asset', r.asset_symbol, 'negative_rows', r.negative_rows)));
    end if;
  end loop;

  -- b) Portefeuille de trésorerie contre son journal
  for r in select x->>'asset' as asset, (x->>'ledger_drift')::numeric as drift from jsonb_array_elements(public.admin_reserve_gap()) x loop
    if abs(coalesce(r.drift,0)) > v_tol then
      v_items := v_items || jsonb_build_array(jsonb_build_object('key','ledger_drift_'||r.asset,'severity','high',
        'title','Portefeuille de trésorerie ≠ son journal : '||r.asset||' (écart '||r.drift||')',
        'details', jsonb_build_object('asset', r.asset, 'ledger_drift', r.drift, 'tolerance', v_tol)));
    end if;
  end loop;

  -- c) Mouvements de solde sans aucune transaction du même utilisateur autour (7 derniers jours, 50 au plus par passage)
  for r in
    select l.id, l.user_id, l.asset_symbol, l.bucket, l.delta, l.created_at
    from public.balance_ledger l
    where l.entry_type = 'movement'
      and l.created_at > now() - interval '7 days'
      and l.created_at < now() - make_interval(secs => v_grace::double precision)
      and not exists (select 1 from public.transactions t where t.user_id = l.user_id
                      and t.created_at between l.created_at - make_interval(secs => v_win::double precision) and l.created_at + make_interval(secs => v_win::double precision))
    order by l.id desc limit 50
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object('key','unexplained_'||r.id,'severity','high',
      'title','Solde modifié sans transaction : '||r.asset_symbol||' '||(case when r.delta > 0 then '+' else '' end)||r.delta||' ('||r.bucket||')',
      'details', jsonb_build_object('ledger_id', r.id, 'user_id', r.user_id, 'asset', r.asset_symbol, 'bucket', r.bucket, 'delta', r.delta, 'at', r.created_at, 'window_seconds', v_win)));
  end loop;

  perform public.fn_admin_sync_alerts('assets', v_items);
  return jsonb_build_object('checked_at', now(), 'tolerance', v_tol, 'gaps', jsonb_array_length(v_items));
end $$;
revoke all on function public.fn_admin_check_asset_gaps() from public, anon, authenticated;
grant execute on function public.fn_admin_check_asset_gaps() to service_role;
