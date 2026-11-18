-- Include qr_token in get_participant_portal_data so the Participant Portal renders the Digital QR Badge directly
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
      'qr_token', v_reg.qr_token,
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
