SET local check_function_bodies = off;
DROP POLICY "Allow anon read for media_resources" ON "public"."media_resources";
DROP POLICY "Allow anon read for studies" ON "public"."studies";
DROP POLICY "Allow anon read for study_steps" ON "public"."study_steps";
DROP POLICY "Allow anon read on ensinos bucket" ON "storage"."objects";
DROP INDEX "public"."idx_event_coupons_code";
DROP INDEX "public"."idx_event_coupons_form_id";
DROP INDEX "public"."idx_event_coupons_retreat_id";
ALTER TABLE "public"."retreats"
  ADD COLUMN "spreadsheet_data" jsonb DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  existing_profile_id uuid;
  user_cpf text;
  user_phone text;
  clean_cpf text;
BEGIN
  -- Obter CPF e telefone do metadata do usuário, se houver
  user_cpf := new.raw_user_meta_data->>'cpf';
  user_phone := new.raw_user_meta_data->>'phone';
  clean_cpf := regexp_replace(COALESCE(user_cpf, ''), '\D', '', 'g');
  -- 1. Tentar buscar perfil existente pelo CPF (limpando pontuação)
  IF clean_cpf <> '' THEN
    SELECT id INTO existing_profile_id
    FROM public.profiles
    WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = clean_cpf;
  END IF;
  -- 2. Se não encontrar pelo CPF, tentar buscar pelo e-mail
  IF existing_profile_id IS NULL AND new.email IS NOT NULL AND new.email <> '' THEN
    SELECT id INTO existing_profile_id
    FROM public.profiles
    WHERE lower(email) = lower(new.email);
  END IF;
  -- 3. Vincular ou criar novo perfil
  IF existing_profile_id IS NOT NULL THEN
    -- Atualizar o perfil existente vinculando-o ao novo usuário de autenticação
    UPDATE public.profiles
    SET 
      user_id = new.id,
      email = COALESCE(NULLIF(email, ''), new.email),
      phone = COALESCE(NULLIF(phone, ''), user_phone),
      cpf = COALESCE(NULLIF(cpf, ''), user_cpf),
      full_name = COALESCE(NULLIF(full_name, ''), COALESCE(new.raw_user_meta_data->>'full_name', '')),
      avatar_url = COALESCE(NULLIF(avatar_url, ''), COALESCE(new.raw_user_meta_data->>'avatar_url', '')),
      is_church_linked = true
    WHERE id = existing_profile_id;
  ELSE
    -- Criar um novo perfil não vinculado para quem está criando conta de estudos
    INSERT INTO public.profiles (
      user_id, 
      full_name, 
      email, 
      phone,
      cpf, 
      avatar_url,
      is_church_linked
    )
    VALUES (
      new.id, 
      COALESCE(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      user_phone,
      user_cpf,
      COALESCE(new.raw_user_meta_data->>'avatar_url', ''),
      false
    );
  END IF;
  RETURN new;
END;
$function$;
CREATE OR REPLACE FUNCTION public.handle_profiles_spouse_sync()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  -- Prevent recursive loops
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  -- 1. If spouse was removed or changed, unlink the former spouse
  IF TG_OP = 'UPDATE' THEN
    IF OLD.spouse_id IS NOT NULL AND (NEW.spouse_id IS NULL OR NEW.spouse_id <> OLD.spouse_id) THEN
      UPDATE public.profiles
      SET spouse_id = NULL
      WHERE id = OLD.spouse_id AND spouse_id = OLD.id;
    END IF;
  END IF;
  -- 2. If new spouse is set
  IF NEW.spouse_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.spouse_id IS NULL OR NEW.spouse_id <> OLD.spouse_id) THEN
    -- If the new partner is currently linked to someone else, unlink that former person
    UPDATE public.profiles
    SET spouse_id = NULL
    WHERE spouse_id = NEW.spouse_id AND id <> NEW.id;
    -- Link the new partner back to this profile
    UPDATE public.profiles
    SET spouse_id = NEW.id
    WHERE id = NEW.spouse_id AND (spouse_id IS NULL OR spouse_id <> NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.patch_retreat_sheet_metadata (
  p_retreat_id uuid,
  p_sheet_name text,
  p_metadata   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  UPDATE public.retreats
  SET spreadsheet_data = jsonb_set(
    COALESCE(spreadsheet_data, '{}'::jsonb),
    ARRAY['_sheets', p_sheet_name],
    p_metadata,
    true
  )
  WHERE id = p_retreat_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.patch_retreat_spreadsheet_cell (
  p_retreat_id uuid,
  p_sheet_name text,
  p_cell_coord text,
  p_value      jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  UPDATE public.retreats
  SET spreadsheet_data = jsonb_set(
    COALESCE(spreadsheet_data, '{}'::jsonb),
    ARRAY[p_sheet_name, p_cell_coord],
    p_value,
    true
  )
  WHERE id = p_retreat_id;
END;
$function$;
CREATE INDEX idx_study_notes_media_resource_id ON public.study_notes USING btree (media_resource_id);
CREATE INDEX idx_study_notes_profile_id ON public.study_notes USING btree (profile_id);
CREATE INDEX idx_study_notes_study_id ON public.study_notes USING btree (study_id);
CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();
COMMENT ON COLUMN "public"."profiles"."father_id" IS 'Reference to the father profile';
COMMENT ON COLUMN "public"."profiles"."mother_id" IS 'Reference to the mother profile';
COMMENT ON COLUMN "public"."profiles"."spouse_id" IS 'Reference to the spouse profile';
