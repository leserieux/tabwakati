-- Jusqu'ici seul le statut 'done' enregistrait un completed_at. 'wontfix' est aussi un
-- statut terminal (décision prise de ne pas traiter) et mérite la même traçabilité :
-- combien de temps avant qu'on décide de ne pas le faire. On traite les deux comme clôturés.
create or replace function public.set_updated_at_admin_tasks()
returns trigger as $$
begin
  new.updated_at = now();
  if new.status in ('done', 'wontfix') and old.status not in ('done', 'wontfix') and new.completed_at is null then
    new.completed_at = now();
  end if;
  if new.status not in ('done', 'wontfix') then
    new.completed_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

comment on function public.set_updated_at_admin_tasks() is 'Renseigne completed_at quand une tâche passe à un statut terminal (done ou wontfix), le vide si elle en ressort. Sert à calculer un temps de résolution.';
