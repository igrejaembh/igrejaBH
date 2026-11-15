SET local check_function_bodies = off;
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
