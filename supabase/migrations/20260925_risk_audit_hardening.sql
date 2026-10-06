-- Complément sécurisé de la phase 1.
-- Cette migration est séparée afin de rester compatible avec une base où
-- 20260925_user_analytics.sql aurait déjà été appliquée.

DO $$
BEGIN
  IF to_regclass('public.user_risk_scores') IS NOT NULL
     AND to_regclass('public.user_risk_score_history') IS NULL THEN
    ALTER TABLE public.user_risk_scores RENAME TO user_risk_score_history;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_risk_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  level text NOT NULL DEFAULT 'normal'
    CHECK (level IN ('normal', 'watch', 'high', 'critical')),

  kyc_score integer NOT NULL DEFAULT 0,
  transaction_score integer NOT NULL DEFAULT 0,
  withdrawal_score integer NOT NULL DEFAULT 0,
  loan_score integer NOT NULL DEFAULT 0,
  behavior_score integer NOT NULL DEFAULT 0,

  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_version text NOT NULL DEFAULT 'v1',

  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_risk_flags
  ADD COLUMN IF NOT EXISTS source_transaction_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.user_risk_flags
  ADD COLUMN IF NOT EXISTS rule_version text NOT NULL DEFAULT 'v1';

ALTER TABLE public.user_risk_score_history
  ADD COLUMN IF NOT EXISTS scoring_version text NOT NULL DEFAULT 'v1';

CREATE INDEX IF NOT EXISTS user_risk_score_history_user_date_idx
  ON public.user_risk_score_history (user_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS user_risk_score_history_level_idx
  ON public.user_risk_score_history (level, score DESC, calculated_at DESC);

CREATE INDEX IF NOT EXISTS user_risk_flags_source_transactions_idx
  ON public.user_risk_flags USING gin (source_transaction_ids);

CREATE OR REPLACE VIEW public.user_risk_scores_current AS
SELECT DISTINCT ON (user_id)
  id,
  user_id,
  score,
  level,
  kyc_score,
  transaction_score,
  withdrawal_score,
  loan_score,
  behavior_score,
  reasons,
  scoring_version,
  calculated_at,
  created_at
FROM public.user_risk_score_history
ORDER BY user_id, calculated_at DESC, created_at DESC, id DESC;

CREATE OR REPLACE FUNCTION public.reject_risk_score_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'user_risk_score_history is insert-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_risk_score_history_no_update ON public.user_risk_score_history;
CREATE TRIGGER user_risk_score_history_no_update
  BEFORE UPDATE OR DELETE ON public.user_risk_score_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_risk_score_history_mutation();

ALTER TABLE public.user_performance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_risk_score_history ENABLE ROW LEVEL SECURITY;

-- Aucun accès direct public/authenticated n'est accordé ici.
-- Le dashboard serveur utilise SUPABASE_SERVICE_ROLE_KEY, qui contourne RLS.
-- Les règles métier d'écriture devront passer par des fonctions serveur/RPC.

COMMENT ON TABLE public.user_risk_score_history IS 'Historique append-only des scores de risque. Chaque ligne identifie la version des règles ayant produit le score.';
COMMENT ON VIEW public.user_risk_scores_current IS 'Dernier score de risque connu par utilisateur, destiné à la lecture courante du dashboard.';
COMMENT ON COLUMN public.user_risk_score_history.scoring_version IS 'Version reproductible des règles ou du modèle de scoring.';
COMMENT ON COLUMN public.user_risk_flags.rule_version IS 'Version de la règle ayant généré le signal.';
COMMENT ON COLUMN public.user_risk_flags.source_transaction_ids IS 'Transactions ayant déclenché le flag, pour accélérer l investigation.';
