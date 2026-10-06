-- Complément sécurisé de la phase 1 (version corrigée) :
-- reconstruit correctement user_risk_scores en table d'historique insert-only
-- après le RENAME, qui ne restructure ni les colonnes ni la clé primaire.
--
-- Note : 20260925_risk_audit_hardening.sql (commité avant celle-ci) contenait
-- ce même bloc sans la restructuration ci-dessous. Sur une base où
-- user_risk_scores existait déjà (PK sur user_id, pas de colonne id/created_at),
-- le RENAME seul laissait la table dans un état incompatible avec la vue
-- user_risk_scores_current (colonnes manquantes) et avec un vrai historique
-- (PK toujours sur user_id -> un 2e score pour le même user faisait planter
-- l'insertion). C'est ce que corrige cette migration ; elle a été testée en
-- conditions réelles (insertions multiples, UPDATE rejeté, vue "current" à jour).

DO $$
BEGIN
  IF to_regclass('public.user_risk_scores') IS NOT NULL
     AND to_regclass('public.user_risk_score_history') IS NULL THEN
    ALTER TABLE public.user_risk_scores RENAME TO user_risk_score_history;

    ALTER TABLE public.user_risk_score_history DROP CONSTRAINT user_risk_scores_pkey;
    ALTER TABLE public.user_risk_score_history
      ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    UPDATE public.user_risk_score_history SET id = gen_random_uuid() WHERE id IS NULL;
    ALTER TABLE public.user_risk_score_history ALTER COLUMN id SET NOT NULL;
    ALTER TABLE public.user_risk_score_history ADD PRIMARY KEY (id);

    DROP TRIGGER IF EXISTS set_updated_at_user_risk_scores ON public.user_risk_score_history;
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
COMMENT ON COLUMN public.user_risk_flags.source_transaction_ids IS 'Transactions ayant déclenché le flag, pour accélérer l''investigation.';
