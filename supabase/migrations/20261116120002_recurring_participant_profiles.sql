-- Migration: Conta para Participantes Recorrentes de Retiros & Estudos
-- Adiciona campos de perfil para participantes recorrentes, atualiza handle_new_user()
-- e cria RPC claim_participant_registrations() para vincular inscrições de convidados.

-- 1. Novas colunas opcionais em public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city_state text,
  ADD COLUMN IF NOT EXISTS dietary_restrictions text,
  ADD COLUMN IF NOT EXISTS emergency_contact text;

COMMENT ON COLUMN public.profiles.city_state IS
  'Cidade e UF informadas por participantes recorrentes de retiros e encontros (ex: Belo Horizonte / MG).';
COMMENT ON COLUMN public.profiles.dietary_restrictions IS
  'Restrições alimentares, alergias ou observações médicas salvas pelo participante para retiros e encontros.';
COMMENT ON COLUMN public.profiles.emergency_contact IS
  'Contato de emergência (nome e telefone) informado pelo participante para retiros e encontros.';

-- Índice auxiliar para consultas de inscrições por participante
CREATE INDEX IF NOT EXISTS idx_registrations_profile_id
  ON public.registrations (profile_id);

-- 2. Preservar proteção de is_church_linked permitindo atualização legítima via trigger interna (auth.users -> handle_new_user)
CREATE OR REPLACE FUNCTION public.handle_is_church_linked_protection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (OLD.is_church_linked IS DISTINCT FROM NEW.is_church_linked) THEN
    IF auth.uid() IS NULL AND pg_trigger_depth() > 1 THEN
      RETURN NEW;
    END IF;

    -- Apenas liderança (presbíteros, diáconos, devs ou líderes de GC) pode alterar o vínculo
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND (is_dev = true OR is_presbyter = true OR is_deacon = true)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.home_groups hg
      JOIN public.profiles p ON p.user_id = auth.uid()
      WHERE hg.leader_1_id = p.id OR hg.leader_2_id = p.id
    ) THEN
      NEW.is_church_linked := OLD.is_church_linked;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Atualizar handle_new_user() para preservar pré-cadastro da igreja e persistir dados de participantes recorrentes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  existing_profile public.profiles%ROWTYPE;
  has_existing boolean := false;
  account_mode text;
  user_cpf text;
  user_phone text;
  clean_cpf text;
  raw_birth_date text;
  user_birth_date date := NULL;
  user_gender text;
  user_city_state text;
  user_dietary_restrictions text;
  user_emergency_contact text;
  user_full_name text;
  user_avatar_url text;
  is_baptized_church_profile boolean := false;
BEGIN
  account_mode := lower(trim(COALESCE(new.raw_user_meta_data->>'account_mode', '')));
  user_cpf := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'cpf', '')), '');
  user_phone := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'phone', '')), '');
  clean_cpf := regexp_replace(COALESCE(user_cpf, ''), '\D', '', 'g');
  raw_birth_date := trim(COALESCE(new.raw_user_meta_data->>'birth_date', ''));
  user_gender := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'gender', '')), '');
  user_city_state := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'city_state', '')), '');
  user_dietary_restrictions := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'dietary_restrictions', '')), '');
  user_emergency_contact := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'emergency_contact', '')), '');
  user_full_name := COALESCE(NULLIF(trim(COALESCE(new.raw_user_meta_data->>'full_name', '')), ''), '');
  user_avatar_url := COALESCE(NULLIF(trim(COALESCE(new.raw_user_meta_data->>'avatar_url', '')), ''), '');

  -- Cast seguro de data de nascimento (YYYY-MM-DD)
  IF raw_birth_date ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      user_birth_date := raw_birth_date::date;
    EXCEPTION WHEN OTHERS THEN
      user_birth_date := NULL;
    END;
  END IF;

  -- 1. Tentar buscar perfil existente pelo CPF limpo
  IF clean_cpf <> '' THEN
    SELECT * INTO existing_profile
    FROM public.profiles
    WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = clean_cpf
    LIMIT 1;
    has_existing := FOUND;
  END IF;

  -- 2. Se não encontrar pelo CPF, tentar buscar pelo e-mail
  IF NOT has_existing AND new.email IS NOT NULL AND trim(new.email) <> '' THEN
    SELECT * INTO existing_profile
    FROM public.profiles
    WHERE lower(email) = lower(trim(new.email))
    LIMIT 1;
    has_existing := FOUND;
  END IF;

  -- 3. Vincular ou criar novo perfil
  IF has_existing THEN
    IF existing_profile.user_id IS NOT NULL AND existing_profile.user_id <> new.id THEN
      RAISE EXCEPTION 'CPF ou e-mail já vinculado a outra conta existente.'
        USING ERRCODE = '23505';
    END IF;

    is_baptized_church_profile := (
      existing_profile.is_church_linked = true
      AND (existing_profile.is_baptized = true OR existing_profile.baptism_date IS NOT NULL)
    );

    IF account_mode = 'visitor' AND NOT is_baptized_church_profile THEN
      -- Visitante / participante recorrente sem reivindicar pré-cadastro batizado da igreja
      UPDATE public.profiles
      SET
        user_id = new.id,
        email = COALESCE(NULLIF(email, ''), new.email),
        phone = COALESCE(NULLIF(phone, ''), user_phone),
        cpf = COALESCE(NULLIF(cpf, ''), user_cpf),
        full_name = COALESCE(NULLIF(full_name, ''), user_full_name),
        avatar_url = COALESCE(NULLIF(avatar_url, ''), user_avatar_url),
        birth_date = COALESCE(birth_date, user_birth_date),
        gender = COALESCE(NULLIF(gender, ''), user_gender),
        city_state = COALESCE(NULLIF(city_state, ''), user_city_state),
        dietary_restrictions = COALESCE(NULLIF(dietary_restrictions, ''), user_dietary_restrictions),
        emergency_contact = COALESCE(NULLIF(emergency_contact, ''), user_emergency_contact),
        is_church_linked = false
      WHERE id = existing_profile.id;
    ELSE
      -- Preserva vinculação de pré-cadastro da igreja
      UPDATE public.profiles
      SET
        user_id = new.id,
        email = COALESCE(NULLIF(email, ''), new.email),
        phone = COALESCE(NULLIF(phone, ''), user_phone),
        cpf = COALESCE(NULLIF(cpf, ''), user_cpf),
        full_name = COALESCE(NULLIF(full_name, ''), user_full_name),
        avatar_url = COALESCE(NULLIF(avatar_url, ''), user_avatar_url),
        birth_date = COALESCE(birth_date, user_birth_date),
        gender = COALESCE(NULLIF(gender, ''), user_gender),
        city_state = COALESCE(NULLIF(city_state, ''), user_city_state),
        dietary_restrictions = COALESCE(NULLIF(dietary_restrictions, ''), user_dietary_restrictions),
        emergency_contact = COALESCE(NULLIF(emergency_contact, ''), user_emergency_contact),
        is_church_linked = true
      WHERE id = existing_profile.id;
    END IF;
  ELSE
    -- Novo perfil não vinculado para participante de retiros e estudos
    INSERT INTO public.profiles (
      user_id,
      full_name,
      email,
      phone,
      cpf,
      avatar_url,
      birth_date,
      gender,
      city_state,
      dietary_restrictions,
      emergency_contact,
      is_church_linked
    )
    VALUES (
      new.id,
      user_full_name,
      new.email,
      user_phone,
      user_cpf,
      user_avatar_url,
      user_birth_date,
      user_gender,
      user_city_state,
      user_dietary_restrictions,
      user_emergency_contact,
      false
    );
  END IF;

  RETURN new;
END;
$function$;

-- 4. RPC para vincular inscrições passadas de convidado ao perfil do participante autenticado
CREATE OR REPLACE FUNCTION public.claim_participant_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_profile_id uuid;
  v_profile_email text;
  v_profile_cpf text;
  v_clean_email text;
  v_clean_cpf text;
  v_claimed_count integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária para vincular inscrições.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, email, cpf
  INTO v_profile_id, v_profile_email, v_profile_cpf
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN 0;
  END IF;

  v_clean_email := lower(trim(COALESCE(NULLIF(v_profile_email, ''), auth.jwt()->>'email', '')));
  v_clean_cpf := regexp_replace(COALESCE(v_profile_cpf, ''), '\D', '', 'g');

  IF v_clean_email = '' AND v_clean_cpf = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.registrations r
  SET profile_id = v_profile_id
  WHERE r.profile_id IS NULL
    AND (
      (
        v_clean_email <> ''
        AND lower(trim(COALESCE(r.guest_data->>'email', ''))) = v_clean_email
      )
      OR
      (
        v_clean_cpf <> ''
        AND regexp_replace(COALESCE(r.guest_data->>'cpf', ''), '\D', '', 'g') = v_clean_cpf
      )
    );

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  RETURN v_claimed_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_participant_registrations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_participant_registrations() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_participant_registrations() TO authenticated;

COMMENT ON FUNCTION public.claim_participant_registrations() IS
  'Vincula ao perfil do usuário autenticado as inscrições antigas em retiros (registrations.profile_id IS NULL) cujo e-mail ou CPF em guest_data corresponda ao cadastro do participante.';
