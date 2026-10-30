-- Réserve de retrait : politique par actif, relevés quotidiens, statistiques de retraits.
--
-- Vocabulaire (le même que dans le dashboard, page « Réserve de retrait ») :
--   portefeuille de retrait = l'argent prêt à partir quand un utilisateur retire (le « chaud »)
--   coffre                  = l'argent mis à l'abri, hors ligne (le « froid »)
--   argent libre            = ce qui reste une fois payé tout ce que tu dois, le stock des swaps et une marge de sécurité
--
-- Rien ici ne déplace d'argent : ce sont des réglages et de l'historique. Le dashboard calcule, pour chaque actif,
-- combien garder dans le portefeuille de retrait (cible), et ce qui peut travailler.

-- 1) Réglages par actif (une ligne n'existe que si tu as modifié les valeurs par défaut)
create table if not exists public.custody_policy (
  asset_symbol text primary key references public.supported_assets(symbol),
  min_hot      numeric not null default 0   check (min_hot >= 0),                       -- plancher à toujours garder prêt (unités)
  days_cover   numeric not null default 3   check (days_cover >= 0 and days_cover <= 90), -- jours de retraits de pointe à couvrir
  low_pct      numeric not null default 50  check (low_pct > 0 and low_pct <= 100),      -- alerte « à remplir » sous ce % de la cible
  high_pct     numeric not null default 150 check (high_pct >= 100 and high_pct <= 1000),-- alerte « trop plein » au-dessus de ce % de la cible
  invest_pct   numeric not null default 0   check (invest_pct >= 0 and invest_pct <= 100),-- % de l'argent libre qu'on accepte de faire travailler
  safety_pct   numeric not null default 20  check (safety_pct >= 0 and safety_pct <= 1000),-- marge gardée en plus du dû, en % du dû
  updated_at   timestamptz not null default now()
);

-- 2) Relevés quotidiens (base du relevé mensuel de couverture). Pas de clé étrangère : l'historique doit survivre à un actif retiré.
create table if not exists public.custody_snapshots (
  snapshot_date date        not null,
  asset_symbol  text        not null,
  kind          text        not null check (kind in ('crypto', 'mobile')),
  owe           numeric     not null,   -- dû aux utilisateurs (disponible + staking + en attente)
  have          numeric,                -- détenu réellement ; null = lecture impossible ce jour-là
  hot           numeric,                -- dans le portefeuille de retrait (ou chez le prestataire pour l'argent mobile)
  vault         numeric,                -- dans le coffre
  on_users      numeric,                -- pas encore ramassé sur les adresses des utilisateurs
  swap_stock    numeric,                -- stock interne des swaps (treasury_wallets)
  price_usd     numeric,
  taken_at      timestamptz not null default now(),
  primary key (snapshot_date, asset_symbol)
);
create index if not exists custody_snapshots_date_idx on public.custody_snapshots (snapshot_date desc);

alter table public.custody_policy    enable row level security;   -- aucune policy : service_role (dashboard) uniquement
alter table public.custody_snapshots enable row level security;
revoke all on public.custody_policy, public.custody_snapshots from public, anon, authenticated;

-- 3) Statistiques de retraits par actif sur les p_days derniers jours (échecs et annulations exclus),
--    plus le plus gros solde disponible d'un seul utilisateur (le pire retrait unique possible).
create or replace function public.get_withdrawal_stats(p_days integer default 90)
returns table(
  asset_symbol         text,
  withdrawals_count    bigint,
  total_out            numeric,
  max_single           numeric,
  peak_day_out         numeric,
  avg_day_out          numeric,
  biggest_user_balance numeric
)
language sql stable security definer set search_path to 'public' as $$
  with w as (
    select t.asset_symbol, t.amount, t.created_at::date as d
    from public.transactions t
    where t.type = 'withdrawal'
      and t.status not in ('failed', 'cancelled', 'canceled', 'rejected')
      and t.created_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  per_day as (select asset_symbol, d, sum(amount) as s from w group by asset_symbol, d),
  agg as (select asset_symbol, count(*) as c, sum(amount) as total, max(amount) as mx from w group by asset_symbol),
  pk  as (select asset_symbol, max(s) as peak from per_day group by asset_symbol),
  bal as (select ub.asset_symbol, max(ub.available_balance) as b from public.user_balances ub group by ub.asset_symbol)
  select bal.asset_symbol,
         coalesce(agg.c, 0),
         coalesce(agg.total, 0),
         coalesce(agg.mx, 0),
         coalesce(pk.peak, 0),
         coalesce(agg.total, 0) / greatest(p_days, 1),
         coalesce(bal.b, 0)
  from bal
  left join agg on agg.asset_symbol = bal.asset_symbol
  left join pk  on pk.asset_symbol  = bal.asset_symbol;
$$;
revoke execute on function public.get_withdrawal_stats(integer) from public, anon, authenticated;
grant  execute on function public.get_withdrawal_stats(integer) to service_role;
