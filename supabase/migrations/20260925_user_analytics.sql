CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.user_performance_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  asset_symbol text NOT NULL REFERENCES public.supported_assets(symbol),
  performance_date date NOT NULL,

  opening_balance numeric NOT NULL DEFAULT 0,
  closing_balance numeric NOT NULL DEFAULT 0,

  deposits_amount numeric NOT NULL DEFAULT 0,
  deposits_count integer NOT NULL DEFAULT 0,

  withdrawals_amount numeric NOT NULL DEFAULT 0,
  withdrawals_count integer NOT NULL DEFAULT 0,

  rewards_amount numeric NOT NULL DEFAULT 0,
  fees_amount numeric NOT NULL DEFAULT 0,

  game_wins_amount numeric NOT NULL DEFAULT 0,
  game_losses_amount numeric NOT NULL DEFAULT 0,

  staking_rewards_amount numeric NOT NULL DEFAULT 0,

  transfers_in_amount numeric NOT NULL DEFAULT 0,
  transfers_out_amount numeric NOT NULL DEFAULT 0,

  swaps_in_amount numeric NOT NULL DEFAULT 0,
  swaps_out_amount numeric NOT NULL DEFAULT 0,

  loans_received_amount numeric NOT NULL DEFAULT 0,
  loans_repaid_amount numeric NOT NULL DEFAULT 0,

  net_cashflow numeric NOT NULL DEFAULT 0,
  net_variation numeric NOT NULL DEFAULT 0,

  price_usd numeric,
  closing_value_usd numeric,
  net_variation_usd numeric,

  transaction_count integer NOT NULL DEFAULT 0,
  successful_transaction_count integer NOT NULL DEFAULT 0,
  failed_transaction_count integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, asset_symbol, performance_date)
);

CREATE TABLE IF NOT EXISTS public.user_risk_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  flag_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),

  title text NOT NULL,
  description text NOT NULL,
  asset_symbol text REFERENCES public.supported_assets(symbol),
  score_impact integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  acknowledged_by text,
  resolved_by text,
  resolution_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_risk_scores (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  level text NOT NULL DEFAULT 'normal'
    CHECK (level IN ('normal', 'watch', 'high', 'critical')),

  kyc_score integer NOT NULL DEFAULT 0,
  transaction_score integer NOT NULL DEFAULT 0,
  withdrawal_score integer NOT NULL DEFAULT 0,
  loan_score integer NOT NULL DEFAULT 0,
  behavior_score integer NOT NULL DEFAULT 0,

  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_performance_daily_user_date_idx
  ON public.user_performance_daily (user_id, performance_date DESC);

CREATE INDEX IF NOT EXISTS user_performance_daily_asset_date_idx
  ON public.user_performance_daily (asset_symbol, performance_date DESC);

CREATE INDEX IF NOT EXISTS user_risk_flags_user_status_idx
  ON public.user_risk_flags (user_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS user_risk_flags_severity_idx
  ON public.user_risk_flags (severity, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS user_risk_scores_level_idx
  ON public.user_risk_scores (level, score DESC);

CREATE TRIGGER set_updated_at_user_performance_daily
  BEFORE UPDATE ON public.user_performance_daily
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_user_risk_flags
  BEFORE UPDATE ON public.user_risk_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_user_risk_scores
  BEFORE UPDATE ON public.user_risk_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.user_performance_daily IS 'Performance agrégée par utilisateur, actif et date pour l’analyse financière et de comportement.';
COMMENT ON TABLE public.user_risk_flags IS 'Alertes et signaux de risque identifiés sur les comptes utilisateurs.';
COMMENT ON TABLE public.user_risk_scores IS 'Score synthétique de risque et niveau d’exposition pour chaque utilisateur.';

COMMENT ON COLUMN public.user_performance_daily.net_cashflow IS 'Flux net journalier (dépôts et retraits / gains et sorties) par actif.';
COMMENT ON COLUMN public.user_performance_daily.net_variation IS 'Différence entre solde de clôture et flux enregistrés pour la période.';
COMMENT ON COLUMN public.user_risk_flags.flag_type IS 'Type de signal de risque (ex. rapid_deposit_withdrawal, kyc_missing, high_failed_transactions).';
COMMENT ON COLUMN public.user_risk_scores.score IS 'Score de risque composite entre 0 et 100.';
