
-- Seuils des alertes admin, modifiables sans migration.
create table if not exists public.admin_alert_settings (
  key text primary key,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.admin_alert_settings enable row level security;
revoke all on public.admin_alert_settings from anon, authenticated;
insert into public.admin_alert_settings(key, value, description) values
  ('asset_gap_tolerance', 0.000001, 'Écart toléré par actif (en unités de l''actif) avant alerte : soldes contre dettes, stakes, journal des soldes')
on conflict (key) do nothing;

-- Capteur d'écart par actif. NB : la version initiale comparait aussi « soldes contre dettes calculées » ;
-- ce contrôle est tautologique (get_asset_liabilities somme les soldes eux-mêmes) et a été retiré par la migration suivante.
create or replace function public.fn_admin_check_asset_gaps()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tol numeric := coalesce((select value from public.admin_alert_settings where key = 'asset_gap_tolerance'), 0.000001);
  v_items jsonb := '[]'::jsonb;
  r record;
begin
  for r in select * from public.get_admin_reconciliation() loop
    if abs(coalesce(r.liability_diff,0)) > v_tol then
      v_items := v_items || jsonb_build_array(jsonb_build_object('key','liability_'||r.asset_symbol,'severity','critical',
        'title','Soldes ≠ dettes calculées : '||r.asset_symbol||' (écart '||r.liability_diff||')',
        'details', jsonb_build_object('asset', r.asset_symbol, 'liability_diff', r.liability_diff, 'available_total', r.available_total, 'liability_fn', r.liability_fn, 'tolerance', v_tol)));
    end if;
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

  for r in select x->>'asset' as asset, (x->>'ledger_drift')::numeric as drift from jsonb_array_elements(public.admin_reserve_gap()) x loop
    if abs(coalesce(r.drift,0)) > v_tol then
      v_items := v_items || jsonb_build_array(jsonb_build_object('key','ledger_drift_'||r.asset,'severity','high',
        'title','Portefeuille de trésorerie ≠ son journal : '||r.asset||' (écart '||r.drift||')',
        'details', jsonb_build_object('asset', r.asset, 'ledger_drift', r.drift, 'tolerance', v_tol)));
    end if;
  end loop;

  perform public.fn_admin_sync_alerts('assets', v_items);
  return jsonb_build_object('checked_at', now(), 'tolerance', v_tol, 'gaps', jsonb_array_length(v_items));
end $$;
revoke all on function public.fn_admin_check_asset_gaps() from public, anon, authenticated;
grant execute on function public.fn_admin_check_asset_gaps() to service_role;
select cron.schedule('admin-asset-gaps-check', '*/10 * * * *', 'select public.fn_admin_check_asset_gaps()');
