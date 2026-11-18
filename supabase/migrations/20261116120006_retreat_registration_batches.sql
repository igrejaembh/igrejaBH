-- Migration: Support multiple registration batches ("lotes") per retreat
-- Task 6: Gestão de Lotes de Inscrição

-- 1. Create retreat_batches table
CREATE TABLE public.retreat_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retreat_id uuid NOT NULL REFERENCES public.retreats(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  max_spots integer NULL CHECK (max_spots IS NULL OR max_spots > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retreat_batches_end_after_start CHECK (end_at >= start_at)
);

COMMENT ON TABLE public.retreat_batches IS 'Lotes de inscrição com janelas de vigência, preços e limite opcional de vagas por encontro/retiro.';

-- 2. Performance indexes on retreat_batches
CREATE INDEX IF NOT EXISTS idx_retreat_batches_retreat_window
  ON public.retreat_batches (retreat_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_retreat_batches_retreat_order
  ON public.retreat_batches (retreat_id, sort_order);

-- 3. Enable RLS and configure policies
ALTER TABLE public.retreat_batches ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.retreat_batches TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.retreat_batches TO authenticated;

DROP POLICY IF EXISTS "Permitir leitura de lotes para todos" ON public.retreat_batches;
CREATE POLICY "Permitir leitura de lotes para todos"
  ON public.retreat_batches
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Presbíteros e devs podem inserir lotes" ON public.retreat_batches;
CREATE POLICY "Presbíteros e devs podem inserir lotes"
  ON public.retreat_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = (SELECT auth.uid())
        AND (profiles.is_dev = true OR profiles.is_presbyter = true)
    )
  );

DROP POLICY IF EXISTS "Presbíteros e devs podem atualizar lotes" ON public.retreat_batches;
CREATE POLICY "Presbíteros e devs podem atualizar lotes"
  ON public.retreat_batches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = (SELECT auth.uid())
        AND (profiles.is_dev = true OR profiles.is_presbyter = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = (SELECT auth.uid())
        AND (profiles.is_dev = true OR profiles.is_presbyter = true)
    )
  );

DROP POLICY IF EXISTS "Presbíteros e devs podem excluir lotes" ON public.retreat_batches;
CREATE POLICY "Presbíteros e devs podem excluir lotes"
  ON public.retreat_batches
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = (SELECT auth.uid())
        AND (profiles.is_dev = true OR profiles.is_presbyter = true)
    )
  );

-- 4. Add batch tracking columns and price snapshot to registrations
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.retreat_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_price_snapshot numeric(10,2);

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_batch_price_snapshot_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_batch_price_snapshot_check
  CHECK (batch_price_snapshot IS NULL OR batch_price_snapshot >= 0);

CREATE INDEX IF NOT EXISTS idx_registrations_batch_id
  ON public.registrations (batch_id);

COMMENT ON COLUMN public.registrations.batch_id IS 'Lote de inscrição utilizado no momento do cadastro.';
COMMENT ON COLUMN public.registrations.batch_price_snapshot IS 'Snapshot do valor base do lote no momento da inscrição para preservação histórica financeira.';

-- 5. Safe aggregate RPC for public/disciple batch capacity evaluation without exposing registration PII
CREATE OR REPLACE FUNCTION public.get_retreat_batch_counts(p_retreat_ids uuid[])
RETURNS TABLE (
  retreat_id uuid,
  batch_id uuid,
  active_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.retreat_id,
    r.batch_id,
    COUNT(*)::bigint AS active_count
  FROM public.registrations r
  WHERE r.retreat_id = ANY(p_retreat_ids)
    AND r.batch_id IS NOT NULL
    AND COALESCE(r.status, 'confirmado') IN ('confirmado', 'presente')
  GROUP BY r.retreat_id, r.batch_id;
$$;

REVOKE ALL ON FUNCTION public.get_retreat_batch_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_retreat_batch_counts(uuid[]) TO anon, authenticated, service_role;
