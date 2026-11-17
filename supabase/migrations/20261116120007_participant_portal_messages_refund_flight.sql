-- Migration: 20261116120007_participant_portal_messages_refund_flight.sql
-- Task 7: Portal do Inscrito (token de acesso, mensagens participante-organizador, dados de voo, cancelamento e reembolso)

-- 1. Colunas em public.registrations para portal_token, reembolso e dados de voo
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS portal_token text,
  ADD COLUMN IF NOT EXISTS refund_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_status text CHECK (refund_status IN ('pendente', 'em_analise', 'aprovado', 'recusado', 'reembolsado')),
  ADD COLUMN IF NOT EXISTS refund_pix_key text,
  ADD COLUMN IF NOT EXISTS refund_notes text,
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS flight_details jsonb;

UPDATE public.registrations
SET portal_token = encode(extensions.gen_random_bytes(16), 'hex')
WHERE portal_token IS NULL;

ALTER TABLE public.registrations
  ALTER COLUMN portal_token SET DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  ALTER COLUMN portal_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_portal_token
  ON public.registrations(portal_token);

CREATE INDEX IF NOT EXISTS idx_registrations_refund_requested
  ON public.registrations(retreat_id, refund_requested)
  WHERE refund_requested = true;

COMMENT ON COLUMN public.registrations.portal_token IS 'Token secreto único para acesso do participante ao Portal do Inscrito (/inscricao/:token).';
COMMENT ON COLUMN public.registrations.flight_details IS 'Dados logísticos de voo (chegada, saída, necessidade de transfer e observações) preenchidos pelo participante.';
COMMENT ON COLUMN public.registrations.refund_status IS 'Status da solicitação de reembolso após cancelamento: pendente, em_analise, aprovado, recusado, reembolsado.';

-- 2. Tabela de mensagens entre participante e organizadores do evento
CREATE TABLE public.retreat_participant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retreat_id uuid NOT NULL REFERENCES public.retreats(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('participant', 'organizer')),
  sender_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name text NOT NULL,
  message text NOT NULL CHECK (char_length(trim(message)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_retreat_participant_messages_reg_created
  ON public.retreat_participant_messages(registration_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_retreat_participant_messages_retreat_created
  ON public.retreat_participant_messages(retreat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retreat_participant_messages_sender_profile
  ON public.retreat_participant_messages(sender_profile_id)
  WHERE sender_profile_id IS NOT NULL;

ALTER TABLE public.retreat_participant_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retreat_participant_messages FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.retreat_participant_messages TO authenticated;

-- Políticas RLS em public.retreat_participant_messages
CREATE POLICY "Participantes e organizadores podem ver mensagens do portal"
ON public.retreat_participant_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND (p.is_dev = true OR p.is_presbyter = true OR p.is_deacon = true)
  )
  OR EXISTS (
    SELECT 1 FROM public.home_groups hg
    JOIN public.profiles leader ON (hg.leader_1_id = leader.id OR hg.leader_2_id = leader.id)
    WHERE leader.user_id = (SELECT auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.id = retreat_participant_messages.registration_id
      AND p.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY "Participantes e organizadores podem enviar mensagens no portal"
ON public.retreat_participant_messages
FOR INSERT
TO authenticated
WITH CHECK (
  (
    sender_role = 'organizer'
    AND (
      sender_profile_id IS NULL
      OR sender_profile_id IN (
        SELECT p.id FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.id = retreat_participant_messages.registration_id
        AND r.retreat_id = retreat_participant_messages.retreat_id
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = (SELECT auth.uid())
          AND (p.is_dev = true OR p.is_presbyter = true OR p.is_deacon = true)
      )
      OR EXISTS (
        SELECT 1 FROM public.home_groups hg
        JOIN public.profiles leader ON (hg.leader_1_id = leader.id OR hg.leader_2_id = leader.id)
        WHERE leader.user_id = (SELECT auth.uid())
      )
    )
  )
  OR (
    sender_role = 'participant'
    AND (
      sender_profile_id IS NULL
      OR sender_profile_id IN (
        SELECT p.id FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.registrations r
      JOIN public.profiles p ON p.id = r.profile_id
      WHERE r.id = retreat_participant_messages.registration_id
        AND r.retreat_id = retreat_participant_messages.retreat_id
        AND p.user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "Organizadores podem marcar mensagens do portal como lidas"
ON public.retreat_participant_messages
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND (p.is_dev = true OR p.is_presbyter = true OR p.is_deacon = true)
  )
  OR EXISTS (
    SELECT 1 FROM public.home_groups hg
    JOIN public.profiles leader ON (hg.leader_1_id = leader.id OR hg.leader_2_id = leader.id)
    WHERE leader.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND (p.is_dev = true OR p.is_presbyter = true OR p.is_deacon = true)
  )
  OR EXISTS (
    SELECT 1 FROM public.home_groups hg
    JOIN public.profiles leader ON (hg.leader_1_id = leader.id OR hg.leader_2_id = leader.id)
    WHERE leader.user_id = (SELECT auth.uid())
  )
);

-- 3. RPCs seguras (SECURITY DEFINER, search_path fixo, validadas por portal_token ou ownership via auth.uid())

-- 3.1 get_participant_portal_data
CREATE OR REPLACE FUNCTION public.get_participant_portal_data(
  p_portal_token text DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.registrations%ROWTYPE;
  v_retreat public.retreats%ROWTYPE;
  v_profile_name text;
  v_profile_email text;
  v_profile_phone text;
  v_room_name text;
  v_posts jsonb;
  v_messages jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_portal_token, '')), '') IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.registrations
    WHERE portal_token = trim(p_portal_token);
  ELSIF p_registration_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.registrations r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.id = p_registration_id
      AND p.user_id = auth.uid();
  ELSE
    RAISE EXCEPTION 'Token de acesso ou inscrição autenticada são obrigatórios.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada ou link de acesso inválido.';
  END IF;

  IF v_reg.profile_id IS NOT NULL THEN
    SELECT p.full_name, p.email, p.phone
    INTO v_profile_name, v_profile_email, v_profile_phone
    FROM public.profiles p
    WHERE p.id = v_reg.profile_id;
  END IF;

  IF v_reg.room_id IS NOT NULL THEN
    SELECT rr.name INTO v_room_name
    FROM public.retreat_rooms rr
    WHERE rr.id = v_reg.room_id;
  END IF;

  SELECT * INTO v_retreat
  FROM public.retreats
  WHERE id = v_reg.retreat_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', po.id,
        'title', po.title,
        'content', po.content,
        'category', po.category,
        'event_label', po.event_label,
        'is_public', po.is_public,
        'image_urls', po.image_urls,
        'created_at', po.created_at,
        'updated_at', po.updated_at
      )
      ORDER BY po.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_posts
  FROM public.posts po
  WHERE po.retreat_id = v_reg.retreat_id
    AND po.is_published = true
    AND (
      po.is_public = true
      OR v_reg.id IS NOT NULL
      OR (
        auth.uid() IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.profiles pr
          WHERE pr.user_id = auth.uid()
            AND (pr.is_church_linked = true OR pr.is_dev = true OR pr.is_presbyter = true OR pr.is_deacon = true)
        )
      )
    );

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'retreat_id', m.retreat_id,
        'registration_id', m.registration_id,
        'sender_role', m.sender_role,
        'sender_profile_id', m.sender_profile_id,
        'sender_name', m.sender_name,
        'message', m.message,
        'created_at', m.created_at,
        'read_at', m.read_at
      )
      ORDER BY m.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_messages
  FROM public.retreat_participant_messages m
  WHERE m.registration_id = v_reg.id;

  RETURN jsonb_build_object(
    'registration', jsonb_build_object(
      'id', v_reg.id,
      'retreat_id', v_reg.retreat_id,
      'profile_id', v_reg.profile_id,
      'portal_token', v_reg.portal_token,
      'status', v_reg.status,
      'paid', COALESCE(v_reg.paid, false),
      'payment_method', v_reg.payment_method,
      'payment_reference', v_reg.payment_reference,
      'room_allocation', COALESCE(v_room_name, v_reg.room_allocation),
      'custom_responses', v_reg.custom_responses,
      'guest_data', v_reg.guest_data,
      'notes', v_reg.notes,
      'service_team', v_reg.service_team,
      'checked_in_at', v_reg.checked_in_at,
      'cancellation_reason', v_reg.cancellation_reason,
      'cancelled_at', v_reg.cancelled_at,
      'refund_requested', v_reg.refund_requested,
      'refund_status', v_reg.refund_status,
      'refund_pix_key', v_reg.refund_pix_key,
      'refund_notes', v_reg.refund_notes,
      'refund_requested_at', v_reg.refund_requested_at,
      'refund_resolved_at', v_reg.refund_resolved_at,
      'flight_details', v_reg.flight_details,
      'created_at', v_reg.created_at,
      'participant_name', COALESCE(
        NULLIF(trim(COALESCE(v_reg.guest_data->>'full_name', v_reg.guest_data->>'fullName', '')), ''),
        v_profile_name,
        'Participante'
      ),
      'participant_email', COALESCE(
        NULLIF(trim(COALESCE(v_reg.guest_data->>'email', '')), ''),
        v_profile_email
      ),
      'participant_phone', COALESCE(
        NULLIF(trim(COALESCE(v_reg.guest_data->>'phone', '')), ''),
        v_profile_phone
      )
    ),
    'retreat', CASE
      WHEN v_retreat.id IS NOT NULL THEN jsonb_build_object(
        'id', v_retreat.id,
        'title', v_retreat.title,
        'description', v_retreat.description,
        'start_date', v_retreat.start_date,
        'end_date', v_retreat.end_date,
        'location_text', v_retreat.location_text,
        'image_url', v_retreat.image_url,
        'status', v_retreat.status,
        'price', v_retreat.price,
        'has_payment', v_retreat.has_payment,
        'form_id', v_retreat.form_id
      )
      ELSE NULL
    END,
    'posts', v_posts,
    'messages', v_messages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_participant_portal_data(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_participant_portal_data(text, uuid) TO anon, authenticated;

-- 3.2 send_participant_portal_message
CREATE OR REPLACE FUNCTION public.send_participant_portal_message(
  p_portal_token text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.registrations%ROWTYPE;
  v_clean_msg text;
  v_sender_name text;
  v_sender_profile_id uuid;
  v_inserted public.retreat_participant_messages%ROWTYPE;
BEGIN
  v_clean_msg := trim(COALESCE(p_message, ''));
  IF v_clean_msg = '' THEN
    RAISE EXCEPTION 'A mensagem não pode estar vazia.';
  END IF;

  IF char_length(v_clean_msg) > 2000 THEN
    RAISE EXCEPTION 'A mensagem deve ter no máximo 2000 caracteres.';
  END IF;

  IF NULLIF(trim(COALESCE(p_portal_token, '')), '') IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.registrations
    WHERE portal_token = trim(p_portal_token);
  ELSIF p_registration_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.registrations r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.id = p_registration_id
      AND p.user_id = auth.uid();
  ELSE
    RAISE EXCEPTION 'Token de acesso ou inscrição autenticada são obrigatórios.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada ou acesso não autorizado.';
  END IF;

  IF v_reg.retreat_id IS NULL THEN
    RAISE EXCEPTION 'Esta inscrição não está vinculada a um evento.';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT p.id, p.full_name
    INTO v_sender_profile_id, v_sender_name
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.id = v_reg.profile_id;
  END IF;

  IF v_sender_profile_id IS NULL AND v_reg.profile_id IS NOT NULL THEN
    SELECT p.id, p.full_name
    INTO v_sender_profile_id, v_sender_name
    FROM public.profiles p
    WHERE p.id = v_reg.profile_id;
  END IF;

  v_sender_name := COALESCE(
    NULLIF(trim(COALESCE(v_reg.guest_data->>'full_name', v_reg.guest_data->>'fullName', '')), ''),
    NULLIF(trim(COALESCE(v_sender_name, '')), ''),
    'Participante'
  );

  INSERT INTO public.retreat_participant_messages (
    retreat_id,
    registration_id,
    sender_role,
    sender_profile_id,
    sender_name,
    message
  )
  VALUES (
    v_reg.retreat_id,
    v_reg.id,
    'participant',
    v_sender_profile_id,
    v_sender_name,
    v_clean_msg
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'success', true,
    'message', to_jsonb(v_inserted)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_participant_portal_message(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_participant_portal_message(text, text, uuid) TO anon, authenticated;

-- 3.3 update_participant_flight_details
CREATE OR REPLACE FUNCTION public.update_participant_flight_details(
  p_portal_token text DEFAULT NULL,
  p_flight_details jsonb DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.registrations%ROWTYPE;
  v_saved jsonb;
BEGIN
  IF p_flight_details IS NULL OR jsonb_typeof(p_flight_details) <> 'object' THEN
    RAISE EXCEPTION 'Os dados de voo devem ser um objeto JSON válido.';
  END IF;

  IF NULLIF(trim(COALESCE(p_portal_token, '')), '') IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.registrations
    WHERE portal_token = trim(p_portal_token);
  ELSIF p_registration_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.registrations r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.id = p_registration_id
      AND p.user_id = auth.uid();
  ELSE
    RAISE EXCEPTION 'Token de acesso ou inscrição autenticada são obrigatórios.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada ou acesso não autorizado.';
  END IF;

  IF v_reg.status = 'cancelado' THEN
    RAISE EXCEPTION 'Não é possível atualizar os dados de voo de uma inscrição cancelada.';
  END IF;

  UPDATE public.registrations
  SET flight_details = p_flight_details
  WHERE id = v_reg.id
  RETURNING flight_details INTO v_saved;

  RETURN jsonb_build_object(
    'success', true,
    'flight_details', v_saved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_participant_flight_details(text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_participant_flight_details(text, jsonb, uuid) TO anon, authenticated;

-- 3.4 cancel_and_request_refund
CREATE OR REPLACE FUNCTION public.cancel_and_request_refund(
  p_portal_token text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_request_refund boolean DEFAULT false,
  p_pix_key text DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.registrations%ROWTYPE;
  v_updated public.registrations%ROWTYPE;
  v_clean_reason text;
  v_clean_pix text;
  v_want_refund boolean;
BEGIN
  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_clean_pix := NULLIF(trim(COALESCE(p_pix_key, '')), '');
  v_want_refund := COALESCE(p_request_refund, false);

  IF v_want_refund AND v_clean_pix IS NULL THEN
    RAISE EXCEPTION 'Informe a chave PIX para solicitar o reembolso.';
  END IF;

  IF NULLIF(trim(COALESCE(p_portal_token, '')), '') IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.registrations
    WHERE portal_token = trim(p_portal_token)
    FOR UPDATE;
  ELSIF p_registration_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.registrations r
    JOIN public.profiles p ON p.id = r.profile_id
    WHERE r.id = p_registration_id
      AND p.user_id = auth.uid()
    FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Token de acesso ou inscrição autenticada são obrigatórios.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscrição não encontrada ou acesso não autorizado.';
  END IF;

  IF v_reg.status = 'cancelado' THEN
    IF v_reg.refund_requested THEN
      RAISE EXCEPTION 'Esta inscrição já foi cancelada e a solicitação de reembolso já foi registrada.';
    ELSIF NOT v_want_refund THEN
      RAISE EXCEPTION 'Esta inscrição já está cancelada.';
    END IF;

    UPDATE public.registrations
    SET
      cancellation_reason = COALESCE(v_clean_reason, cancellation_reason),
      refund_requested = true,
      refund_status = 'pendente',
      refund_pix_key = v_clean_pix,
      refund_requested_at = now()
    WHERE id = v_reg.id
    RETURNING * INTO v_updated;
  ELSE
    UPDATE public.registrations
    SET
      status = 'cancelado',
      cancellation_reason = COALESCE(v_clean_reason, cancellation_reason),
      cancelled_at = COALESCE(cancelled_at, now()),
      refund_requested = v_want_refund,
      refund_status = CASE WHEN v_want_refund THEN 'pendente' ELSE refund_status END,
      refund_pix_key = CASE WHEN v_want_refund THEN v_clean_pix ELSE refund_pix_key END,
      refund_requested_at = CASE WHEN v_want_refund THEN now() ELSE refund_requested_at END
    WHERE id = v_reg.id
    RETURNING * INTO v_updated;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'registration_id', v_updated.id,
    'status', v_updated.status,
    'cancellation_reason', v_updated.cancellation_reason,
    'cancelled_at', v_updated.cancelled_at,
    'refund_requested', v_updated.refund_requested,
    'refund_status', v_updated.refund_status,
    'refund_pix_key', v_updated.refund_pix_key,
    'refund_requested_at', v_updated.refund_requested_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_and_request_refund(text, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_and_request_refund(text, text, boolean, text, uuid) TO anon, authenticated;
