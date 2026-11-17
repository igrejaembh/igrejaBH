-- Migration: 20261116120005_retreat_expense_attachments.sql
-- Descrição: Tabela de anexos/comprovantes para despesas de retiros + bucket privado e políticas RLS/Storage.

-- 1. Tabela de metadados dos anexos de despesas
CREATE TABLE public.retreat_expense_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.retreat_expenses(id) ON DELETE CASCADE,
  retreat_id uuid NOT NULL REFERENCES public.retreats(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.retreat_expense_attachments IS 'Comprovantes e notas fiscais anexados aos lançamentos de despesas de retiros/eventos.';

-- 2. Índices de performance e chaves estrangeiras
CREATE INDEX IF NOT EXISTS idx_retreat_expense_attachments_expense_id
  ON public.retreat_expense_attachments (expense_id);

CREATE INDEX IF NOT EXISTS idx_retreat_expense_attachments_retreat_id
  ON public.retreat_expense_attachments (retreat_id);

CREATE INDEX IF NOT EXISTS idx_retreat_expense_attachments_uploaded_by
  ON public.retreat_expense_attachments (uploaded_by);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.retreat_expense_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Presbíteros, diáconos e devs podem gerenciar anexos de despesas" ON public.retreat_expense_attachments;
CREATE POLICY "Presbíteros, diáconos e devs podem gerenciar anexos de despesas"
ON public.retreat_expense_attachments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
);

-- 4. Bucket privado para comprovantes de despesas (máximo 10MB, PDF e imagens)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'retreat-expense-attachments',
  'retreat-expense-attachments',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 5. Políticas de Storage para bucket retreat-expense-attachments (SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "Liderança pode visualizar anexos de despesas no storage" ON storage.objects;
CREATE POLICY "Liderança pode visualizar anexos de despesas no storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'retreat-expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
);

DROP POLICY IF EXISTS "Liderança pode enviar anexos de despesas no storage" ON storage.objects;
CREATE POLICY "Liderança pode enviar anexos de despesas no storage"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'retreat-expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
);

DROP POLICY IF EXISTS "Liderança pode atualizar anexos de despesas no storage" ON storage.objects;
CREATE POLICY "Liderança pode atualizar anexos de despesas no storage"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'retreat-expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
)
WITH CHECK (
  bucket_id = 'retreat-expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
);

DROP POLICY IF EXISTS "Liderança pode excluir anexos de despesas no storage" ON storage.objects;
CREATE POLICY "Liderança pode excluir anexos de despesas no storage"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'retreat-expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = (SELECT auth.uid())
      AND (profiles.is_dev = true OR profiles.is_presbyter = true OR profiles.is_deacon = true)
  )
);
