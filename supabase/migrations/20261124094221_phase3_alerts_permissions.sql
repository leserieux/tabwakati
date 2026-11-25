
-- Permissions du centre d'alertes (miroir de src/core/auth/permissions.ts).
insert into public.admin_role_permissions(role, permission) values
  ('finance','alerts.read'), ('finance','alerts.handle'),
  ('risk','alerts.read'), ('risk','alerts.handle')
on conflict do nothing;
