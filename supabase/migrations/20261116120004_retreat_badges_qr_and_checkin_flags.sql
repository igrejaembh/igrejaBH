-- ============================================================================
-- MIGRATION: Crachás, Check-in via QR Code e Flags Configuráveis na Portaria
-- Task 4 (branch: feat/cracha-checkin-qrcode)
-- ============================================================================

-- 1. Configuração da checklist de portaria por retiro
ALTER TABLE public.retreats
ADD COLUMN IF NOT EXISTS checkin_checklist_config jsonb NOT NULL
DEFAULT '[{"key":"camisa_entregue","label":"Camisa entregue"},{"key":"pagou_dinheiro","label":"Pagou em dinheiro"},{"key":"cracha_entregue","label":"Crachá entregue"}]'::jsonb;

COMMENT ON COLUMN public.retreats.checkin_checklist_config IS
  'Configuração JSONB dos itens de controle (checklist) exibidos durante o check-in na portaria do retiro.';

-- 2. Token QR único e mapa de flags por inscrição
ALTER TABLE public.registrations
ADD COLUMN IF NOT EXISTS qr_token text;

UPDATE public.registrations
SET qr_token = encode(extensions.gen_random_bytes(12), 'hex')
WHERE qr_token IS NULL;

ALTER TABLE public.registrations
ALTER COLUMN qr_token SET DEFAULT encode(extensions.gen_random_bytes(12), 'hex'),
ALTER COLUMN qr_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_qr_token
ON public.registrations(qr_token);

ALTER TABLE public.registrations
ADD COLUMN IF NOT EXISTS checkin_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.registrations.qr_token IS
  'Token hexadecimal único da inscrição usado para geração de crachá e leitura de QR Code na portaria.';

COMMENT ON COLUMN public.registrations.checkin_flags IS
  'Mapa JSONB de marcações de controle na portaria (ex: {"camisa_entregue": true}).';

-- 3. RPC SECURITY INVOKER para check-in atômico via leitura de QR Code
CREATE OR REPLACE FUNCTION public.checkin_registration_by_qr(
  p_retreat_id uuid,
  p_qr_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_is_manager boolean := false;
  v_clean_token text;
  v_reg public.registrations%ROWTYPE;
  v_already_present boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Sessão não autenticada. Faça login para realizar o check-in.'
    );
  END IF;

  SELECT
    p.id,
    (
      COALESCE(p.is_dev, false)
      OR COALESCE(p.is_presbyter, false)
      OR COALESCE(p.is_deacon, false)
      OR EXISTS (
        SELECT 1
        FROM public.home_groups hg
        WHERE hg.leader_1_id = p.id OR hg.leader_2_id = p.id
      )
    )
  INTO v_caller_profile_id, v_is_manager
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF NOT COALESCE(v_is_manager, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'FORBIDDEN',
      'message', 'Apenas presbíteros, diáconos ou líderes autorizados podem realizar check-in na portaria.'
    );
  END IF;

  v_clean_token := lower(trim(COALESCE(p_qr_token, '')));
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_TOKEN',
      'message', 'Código QR vazio ou inválido.'
    );
  END IF;

  SELECT *
  INTO v_reg
  FROM public.registrations r
  WHERE r.retreat_id = p_retreat_id
    AND lower(r.qr_token) = v_clean_token
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
    INTO v_reg
    FROM public.registrations r
    WHERE lower(r.qr_token) = v_clean_token
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'WRONG_RETREAT',
        'message', 'Este crachá pertence a outro evento ou retiro.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_FOUND',
      'message', 'Inscrição não encontrada para este código QR.'
    );
  END IF;

  IF v_reg.status = 'cancelado' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'CANCELLED',
      'id', v_reg.id,
      'status', v_reg.status,
      'message', 'Esta inscrição está cancelada e não pode realizar check-in.'
    );
  END IF;

  v_already_present := (v_reg.status = 'presente' AND v_reg.checked_in_at IS NOT NULL);

  UPDATE public.registrations
  SET
    status = 'presente',
    checked_in_at = COALESCE(checked_in_at, now()),
    checked_in_by = COALESCE(checked_in_by, v_caller_profile_id)
  WHERE id = v_reg.id
  RETURNING * INTO v_reg;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_reg.id,
    'retreat_id', v_reg.retreat_id,
    'status', v_reg.status,
    'checked_in_at', v_reg.checked_in_at,
    'checked_in_by', v_reg.checked_in_by,
    'already_checked_in', v_already_present,
    'qr_token', v_reg.qr_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.checkin_registration_by_qr(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.checkin_registration_by_qr(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.checkin_registration_by_qr(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
