-- NON APPLIQUÉE. À lancer seulement si l'app principale lit ces compteurs.
-- user_wheel_stats.total_spins ne compte que les tours faits depuis la version actuelle de execute_wheel_spin
-- (1837 tours liés à une transaction game_win) ; wheel_spins en contient 2920. users.total_games_played n'est
-- plus mis à jour par aucune fonction. Le dashboard recompte désormais depuis wheel_spins.
update public.user_wheel_stats s
set total_spins = coalesce((select count(*) from public.wheel_spins w where w.user_id = s.user_id), 0);
