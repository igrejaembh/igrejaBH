-- ============================================================================
-- MIGRATION: Arquitetura RBAC N:N (profile_roles, resource_permissions,
--            account_type, profile_directory e novas políticas RLS)
-- ============================================================================

-- 1. Novas colunas em public.profiles para Tipo de Conta e Auditoria de Desvinculação
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'study'
    CHECK (account_type IN ('study', 'frequent_participant', 'unlinked', 'disciple')),
  ADD COLUMN IF NOT EXISTS unlinked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS unlinked_reason text NULL,
  ADD COLUMN IF NOT EXISTS unlinked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.account_type IS
  'Tipo de vínculo do usuário: study (Estudo), frequent_participant (Participante Frequente), unlinked (Desvinculado) ou disciple (Discípulo vinculado à igreja).';
COMMENT ON COLUMN public.profiles.unlinked_at IS
  'Data/hora em que um discípulo foi desvinculado da igreja.';
COMMENT ON COLUMN public.profiles.unlinked_reason IS
  'Motivo ou observação registrada na desvinculação.';
COMMENT ON COLUMN public.profiles.unlinked_by IS
  'Perfil da liderança que registrou a desvinculação.';

CREATE INDEX IF NOT EXISTS idx_profiles_account_type
  ON public.profiles (account_type);

-- Backfill do account_type com base no estado atual
UPDATE public.profiles p
SET account_type = CASE
  WHEN p.is_church_linked = true THEN 'disciple'
  WHEN EXISTS (
    SELECT 1 FROM public.registrations r WHERE r.profile_id = p.id
  ) THEN 'frequent_participant'
  ELSE 'study'
END;

-- 2. Tabela N:N de Papéis Administrativos/Ministeriais (public.profile_roles)
CREATE TABLE IF NOT EXISTS public.profile_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('dev', 'presbyter', 'deacon', 'publisher')),
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, role)
);

CREATE INDEX IF NOT EXISTS idx_profile_roles_profile_id
  ON public.profile_roles (profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_roles_role
  ON public.profile_roles (role);

ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;

-- Backfill inicial de papéis a partir das flags legadas em profiles
INSERT INTO public.profile_roles (profile_id, role)
SELECT id, 'dev' FROM public.profiles WHERE is_dev = true
ON CONFLICT (profile_id, role) DO NOTHING;

INSERT INTO public.profile_roles (profile_id, role)
SELECT id, 'presbyter' FROM public.profiles WHERE is_presbyter = true
ON CONFLICT (profile_id, role) DO NOTHING;

INSERT INTO public.profile_roles (profile_id, role)
SELECT id, 'deacon' FROM public.profiles WHERE is_deacon = true
ON CONFLICT (profile_id, role) DO NOTHING;

INSERT INTO public.profile_roles (profile_id, role)
SELECT id, 'publisher' FROM public.profiles WHERE can_post = true
ON CONFLICT (profile_id, role) DO NOTHING;

-- 3. Tabela N:N de Permissões Granulares por Recurso (Eventos e Formulários)
CREATE TABLE IF NOT EXISTS public.resource_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('event', 'form')),
  resource_id text NOT NULL,
  granted_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_permissions_profile
  ON public.resource_permissions (profile_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_resource_permissions_resource
  ON public.resource_permissions (resource_type, resource_id);

ALTER TABLE public.resource_permissions ENABLE ROW LEVEL SECURITY;

-- 4. Tabela de Diretório Não-Sensível (public.profile_directory)
-- Evita exposição de CPF, renda familiar, endereço e dados diaconais para contas sem permissão.
CREATE TABLE IF NOT EXISTS public.profile_directory (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NULL,
  full_name text NOT NULL,
  avatar_url text NULL,
  phone text NULL,
  home_group_id uuid NULL REFERENCES public.home_groups(id) ON DELETE SET NULL,
  discipler_id uuid NULL,
  spouse_id uuid NULL,
  father_id uuid NULL,
  mother_id uuid NULL,
  account_type text NOT NULL DEFAULT 'study',
  is_group_nucleus boolean NOT NULL DEFAULT false,
  is_baptized boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_profile_directory_account_type
  ON public.profile_directory (account_type);
CREATE INDEX IF NOT EXISTS idx_profile_directory_home_group_id
  ON public.profile_directory (home_group_id);
CREATE INDEX IF NOT EXISTS idx_profile_directory_discipler_id
  ON public.profile_directory (discipler_id);

ALTER TABLE public.profile_directory ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.profile_directory TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.profile_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resource_permissions TO authenticated;

INSERT INTO public.profile_directory (
  id, user_id, full_name, avatar_url, phone, home_group_id,
  discipler_id, spouse_id, father_id, mother_id,
  account_type, is_group_nucleus, is_baptized
)
SELECT
  id, user_id, full_name, avatar_url, phone, home_group_id,
  discipler_id, spouse_id, father_id, mother_id,
  account_type, is_group_nucleus, is_baptized
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  phone = EXCLUDED.phone,
  home_group_id = EXCLUDED.home_group_id,
  discipler_id = EXCLUDED.discipler_id,
  spouse_id = EXCLUDED.spouse_id,
  father_id = EXCLUDED.father_id,
  mother_id = EXCLUDED.mother_id,
  account_type = EXCLUDED.account_type,
  is_group_nucleus = EXCLUDED.is_group_nucleus,
  is_baptized = EXCLUDED.is_baptized;

-- 5. Funções Auxiliares Centrais de Autorização (SECURITY DEFINER, sem recursão em RLS)
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_account_type()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.account_type
  FROM public.profiles p
  WHERE p.user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    JOIN public.profiles p ON p.id = pr.profile_id
    WHERE p.user_id = (SELECT auth.uid())
      AND pr.role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gc_leader(p_group_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.home_groups hg
    JOIN public.profiles p ON (hg.leader_1_id = p.id OR hg.leader_2_id = p.id)
    WHERE p.user_id = (SELECT auth.uid())
      AND (p_group_id IS NULL OR hg.id = p_group_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_people()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('presbyter')
    OR public.has_role('deacon')
    OR public.is_gc_leader(NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_people(p_group_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('presbyter')
    OR (p_group_id IS NOT NULL AND public.is_gc_leader(p_group_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event(p_retreat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('deacon')
    OR (
      p_retreat_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.resource_permissions rp
        JOIN public.profiles p ON p.id = rp.profile_id
        WHERE p.user_id = (SELECT auth.uid())
          AND rp.resource_type = 'event'
          AND rp.resource_id = p_retreat_id::text
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_events_any()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('deacon')
    OR EXISTS (
      SELECT 1
      FROM public.resource_permissions rp
      JOIN public.profiles p ON p.id = rp.profile_id
      WHERE p.user_id = (SELECT auth.uid())
        AND rp.resource_type = 'event'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_form(p_form_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('deacon')
    OR (
      p_form_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.resource_permissions rp
        JOIN public.profiles p ON p.id = rp.profile_id
        WHERE p.user_id = (SELECT auth.uid())
          AND rp.resource_type = 'form'
          AND rp.resource_id = p_form_id
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_post_news(p_retreat_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('deacon')
    OR public.has_role('publisher')
    OR (
      p_retreat_id IS NOT NULL
      AND public.can_manage_event(p_retreat_id)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_post_any()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    public.has_role('dev')
    OR public.has_role('deacon')
    OR public.has_role('publisher')
    OR EXISTS (
      SELECT 1
      FROM public.resource_permissions rp
      JOIN public.profiles p ON p.id = rp.profile_id
      WHERE p.user_id = (SELECT auth.uid())
        AND rp.resource_type = 'event'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_account_type() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_gc_leader(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_people() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_people(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_events_any() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_form(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_news(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_post_any() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.current_account_type() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_gc_leader(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_view_people() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_people(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_event(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_events_any() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_form(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_post_news(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_post_any() TO authenticated, anon;

-- 6. Sincronização de profile_directory, flags legadas e proteção de account_type/roles
CREATE OR REPLACE FUNCTION public.sync_legacy_flags_from_profile_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := COALESCE(NEW.profile_id, OLD.profile_id);

  UPDATE public.profiles p
  SET
    is_dev = EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id = v_profile_id AND pr.role = 'dev'),
    is_presbyter = EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id = v_profile_id AND pr.role = 'presbyter'),
    is_deacon = EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id = v_profile_id AND pr.role = 'deacon'),
    can_post = EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id = v_profile_id AND pr.role = 'publisher')
  WHERE p.id = v_profile_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_flags_from_profile_roles ON public.profile_roles;
CREATE TRIGGER trg_sync_legacy_flags_from_profile_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.profile_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_legacy_flags_from_profile_roles();

CREATE OR REPLACE FUNCTION public.handle_profiles_security_and_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_internal boolean;
  v_can_change_link boolean;
BEGIN
  v_is_internal := (auth.uid() IS NULL OR pg_trigger_depth() > 1);

  IF TG_OP = 'INSERT' THEN
    IF NEW.account_type IS NULL OR (NEW.is_church_linked = true AND NEW.account_type = 'study') THEN
      NEW.account_type := CASE WHEN NEW.is_church_linked = true THEN 'disciple' ELSE 'study' END;
    END IF;
    NEW.is_church_linked := (NEW.account_type = 'disciple');

    -- Bloqueia escrita direta de colunas legadas de cargo fora de triggers internas
    IF NOT v_is_internal THEN
      NEW.is_dev := false;
      NEW.is_presbyter := false;
      NEW.is_deacon := false;
      NEW.can_post := false;
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NOT v_is_internal THEN
    -- Colunas legadas só são atualizadas via trigger de profile_roles
    NEW.is_dev := OLD.is_dev;
    NEW.is_presbyter := OLD.is_presbyter;
    NEW.is_deacon := OLD.is_deacon;
    NEW.can_post := OLD.can_post;

    -- Se alguém tentar mudar apenas is_church_linked sem mudar account_type, manter coerência
    IF (OLD.is_church_linked IS DISTINCT FROM NEW.is_church_linked) AND (OLD.account_type IS NOT DISTINCT FROM NEW.account_type) THEN
      NEW.account_type := CASE WHEN NEW.is_church_linked = true THEN 'disciple' ELSE 'unlinked' END;
    END IF;

    IF (OLD.account_type IS DISTINCT FROM NEW.account_type)
       OR (OLD.unlinked_at IS DISTINCT FROM NEW.unlinked_at)
       OR (OLD.unlinked_reason IS DISTINCT FROM NEW.unlinked_reason)
       OR (OLD.unlinked_by IS DISTINCT FROM NEW.unlinked_by) THEN
      v_can_change_link := (
        public.has_role('dev')
        OR public.has_role('presbyter')
        OR (
          OLD.home_group_id IS NOT NULL
          AND public.is_gc_leader(OLD.home_group_id)
        )
        OR (
          NEW.home_group_id IS NOT NULL
          AND public.is_gc_leader(NEW.home_group_id)
        )
      );

      IF NOT v_can_change_link THEN
        NEW.account_type := OLD.account_type;
        NEW.unlinked_at := OLD.unlinked_at;
        NEW.unlinked_reason := OLD.unlinked_reason;
        NEW.unlinked_by := OLD.unlinked_by;
      END IF;
    END IF;
  END IF;

  NEW.is_church_linked := (NEW.account_type = 'disciple');

  IF NEW.account_type = 'unlinked' AND OLD.account_type IS DISTINCT FROM 'unlinked' THEN
    NEW.unlinked_at := COALESCE(NEW.unlinked_at, now());
    NEW.unlinked_by := COALESCE(NEW.unlinked_by, public.current_profile_id());
  ELSIF NEW.account_type = 'disciple' AND OLD.account_type = 'unlinked' THEN
    NEW.unlinked_at := NULL;
    NEW.unlinked_reason := NULL;
    NEW.unlinked_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_is_dev_on_update ON public.profiles;
DROP TRIGGER IF EXISTS protect_is_church_linked_on_update ON public.profiles;
DROP TRIGGER IF EXISTS trg_protect_profile_roles ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_security_and_sync ON public.profiles;

CREATE TRIGGER trg_profiles_security_and_sync
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profiles_security_and_sync();

CREATE OR REPLACE FUNCTION public.handle_profiles_after_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sincroniza diretório não-sensível
  INSERT INTO public.profile_directory (
    id, user_id, full_name, avatar_url, phone, home_group_id,
    discipler_id, spouse_id, father_id, mother_id,
    account_type, is_group_nucleus, is_baptized
  )
  VALUES (
    NEW.id, NEW.user_id, NEW.full_name, NEW.avatar_url, NEW.phone, NEW.home_group_id,
    NEW.discipler_id, NEW.spouse_id, NEW.father_id, NEW.mother_id,
    NEW.account_type, NEW.is_group_nucleus, NEW.is_baptized
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    phone = EXCLUDED.phone,
    home_group_id = EXCLUDED.home_group_id,
    discipler_id = EXCLUDED.discipler_id,
    spouse_id = EXCLUDED.spouse_id,
    father_id = EXCLUDED.father_id,
    mother_id = EXCLUDED.mother_id,
    account_type = EXCLUDED.account_type,
    is_group_nucleus = EXCLUDED.is_group_nucleus,
    is_baptized = EXCLUDED.is_baptized;

  -- Ao desvincular, remove papéis administrativos, permissões por recurso e liderança de GC
  IF TG_OP = 'UPDATE' THEN
    IF OLD.account_type IS DISTINCT FROM NEW.account_type AND NEW.account_type = 'unlinked' THEN
      DELETE FROM public.profile_roles WHERE profile_id = NEW.id;
      DELETE FROM public.resource_permissions WHERE profile_id = NEW.id;
      UPDATE public.home_groups SET leader_1_id = NULL WHERE leader_1_id = NEW.id;
      UPDATE public.home_groups SET leader_2_id = NULL WHERE leader_2_id = NEW.id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_after_sync ON public.profiles;
CREATE TRIGGER trg_profiles_after_sync
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profiles_after_sync();

-- 7. Validação de CPF obrigatório em eventos + Reconhecimento & Promoção Estudo -> Participante Frequente
CREATE OR REPLACE FUNCTION public.validate_registration_mandatory_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guest jsonb;
  v_full_name text;
  v_email text;
  v_phone text;
  v_gender text;
  v_cpf text;
BEGIN
  v_guest := NEW.guest_data;

  IF v_guest IS NOT NULL AND v_guest != '{}'::jsonb THEN
    v_full_name := COALESCE(v_guest->>'full_name', v_guest->>'fullName');
    v_email := v_guest->>'email';
    v_phone := v_guest->>'phone';
    v_gender := v_guest->>'gender';
    v_cpf := regexp_replace(COALESCE(v_guest->>'cpf', ''), '\D', '', 'g');

    IF v_full_name IS NULL OR length(trim(v_full_name)) = 0 THEN
      RAISE EXCEPTION 'Erro de validação: O nome completo do participante é obrigatório.';
    END IF;

    IF v_email IS NULL OR length(trim(v_email)) = 0 THEN
      RAISE EXCEPTION 'Erro de validação: O e-mail do participante é obrigatório.';
    END IF;

    IF v_phone IS NULL OR length(trim(v_phone)) = 0 THEN
      RAISE EXCEPTION 'Erro de validação: O telefone de contato é obrigatório.';
    END IF;

    IF v_gender IS NULL OR length(trim(v_gender)) = 0 THEN
      RAISE EXCEPTION 'Erro de validação: O sexo/gênero é obrigatório para alocação de alojamentos.';
    END IF;

    IF NEW.retreat_id IS NOT NULL AND length(v_cpf) <> 11 THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'Erro de validação: O CPF válido (11 dígitos) é obrigatório para inscrição em eventos.';
      ELSIF NEW.guest_data IS DISTINCT FROM OLD.guest_data THEN
        RAISE EXCEPTION 'Erro de validação: O CPF válido (11 dígitos) é obrigatório para inscrição em eventos.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_and_promote_registration_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guest jsonb;
  v_clean_cpf text;
  v_clean_email text;
  v_matched_id uuid;
BEGIN
  v_guest := NEW.guest_data;

  IF NEW.profile_id IS NULL AND v_guest IS NOT NULL AND v_guest != '{}'::jsonb THEN
    v_clean_cpf := regexp_replace(COALESCE(v_guest->>'cpf', ''), '\D', '', 'g');
    v_clean_email := lower(trim(COALESCE(v_guest->>'email', '')));

    IF length(v_clean_cpf) = 11 THEN
      SELECT id INTO v_matched_id
      FROM public.profiles
      WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = v_clean_cpf
      LIMIT 1;
    END IF;

    IF v_matched_id IS NULL AND v_clean_email <> '' THEN
      SELECT id INTO v_matched_id
      FROM public.profiles
      WHERE lower(trim(COALESCE(email, ''))) = v_clean_email
      LIMIT 1;
    END IF;

    IF v_matched_id IS NOT NULL THEN
      NEW.profile_id := v_matched_id;
    END IF;
  END IF;

  -- Promove automaticamente conta de Estudo para Participante Frequente ao participar de evento
  IF NEW.profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET account_type = 'frequent_participant'
    WHERE id = NEW.profile_id
      AND account_type = 'study';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_and_promote_registration_profile ON public.registrations;
CREATE TRIGGER trg_link_and_promote_registration_profile
  BEFORE INSERT ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.link_and_promote_registration_profile();

-- Atualiza handle_new_user() para lidar com study, frequent_participant, unlinked e disciple
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
  clean_email text;
  raw_birth_date text;
  user_birth_date date := NULL;
  user_gender text;
  user_city_state text;
  user_dietary_restrictions text;
  user_emergency_contact text;
  user_full_name text;
  user_avatar_url text;
  has_past_registrations boolean := false;
  next_account_type text;
BEGIN
  account_mode := lower(trim(COALESCE(new.raw_user_meta_data->>'account_mode', '')));
  user_cpf := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'cpf', '')), '');
  user_phone := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'phone', '')), '');
  clean_cpf := regexp_replace(COALESCE(user_cpf, ''), '\D', '', 'g');
  clean_email := lower(trim(COALESCE(new.email, '')));
  raw_birth_date := trim(COALESCE(new.raw_user_meta_data->>'birth_date', ''));
  user_gender := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'gender', '')), '');
  user_city_state := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'city_state', '')), '');
  user_dietary_restrictions := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'dietary_restrictions', '')), '');
  user_emergency_contact := NULLIF(trim(COALESCE(new.raw_user_meta_data->>'emergency_contact', '')), '');
  user_full_name := COALESCE(NULLIF(trim(COALESCE(new.raw_user_meta_data->>'full_name', '')), ''), '');
  user_avatar_url := COALESCE(NULLIF(trim(COALESCE(new.raw_user_meta_data->>'avatar_url', '')), ''), '');

  IF raw_birth_date ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      user_birth_date := raw_birth_date::date;
    EXCEPTION WHEN OTHERS THEN
      user_birth_date := NULL;
    END;
  END IF;

  IF clean_cpf <> '' THEN
    SELECT * INTO existing_profile
    FROM public.profiles
    WHERE regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = clean_cpf
    LIMIT 1;
    has_existing := FOUND;
  END IF;

  IF NOT has_existing AND clean_email <> '' THEN
    SELECT * INTO existing_profile
    FROM public.profiles
    WHERE lower(trim(COALESCE(email, ''))) = clean_email
    LIMIT 1;
    has_existing := FOUND;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.registrations r
    WHERE (clean_email <> '' AND lower(trim(COALESCE(r.guest_data->>'email', ''))) = clean_email)
       OR (length(clean_cpf) = 11 AND regexp_replace(COALESCE(r.guest_data->>'cpf', ''), '\D', '', 'g') = clean_cpf)
       OR (has_existing AND r.profile_id = existing_profile.id)
  ) INTO has_past_registrations;

  IF has_existing THEN
    IF existing_profile.user_id IS NOT NULL AND existing_profile.user_id <> new.id THEN
      RAISE EXCEPTION 'CPF ou e-mail já vinculado a outra conta existente.'
        USING ERRCODE = '23505';
    END IF;

    IF existing_profile.account_type = 'disciple' OR existing_profile.is_baptized = true OR existing_profile.baptism_date IS NOT NULL THEN
      next_account_type := 'disciple';
    ELSIF existing_profile.account_type = 'unlinked' THEN
      next_account_type := 'unlinked';
    ELSIF account_mode = 'frequent_participant' OR existing_profile.account_type = 'frequent_participant' OR has_past_registrations THEN
      next_account_type := 'frequent_participant';
    ELSIF account_mode IN ('study', 'visitor') THEN
      next_account_type := 'study';
    ELSE
      next_account_type := 'disciple';
    END IF;

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
      account_type = next_account_type
    WHERE id = existing_profile.id;
  ELSE
    IF account_mode = 'frequent_participant' OR has_past_registrations THEN
      next_account_type := 'frequent_participant';
    ELSE
      next_account_type := 'study';
    END IF;

    INSERT INTO public.profiles (
      user_id, full_name, email, phone, cpf, avatar_url,
      birth_date, gender, city_state, dietary_restrictions, emergency_contact,
      account_type
    )
    VALUES (
      new.id, user_full_name, new.email, user_phone, user_cpf, user_avatar_url,
      user_birth_date, user_gender, user_city_state, user_dietary_restrictions, user_emergency_contact,
      next_account_type
    );
  END IF;

  RETURN new;
END;
$function$;

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
  v_has_any_registration boolean := false;
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
      (v_clean_email <> '' AND lower(trim(COALESCE(r.guest_data->>'email', ''))) = v_clean_email)
      OR
      (length(v_clean_cpf) = 11 AND regexp_replace(COALESCE(r.guest_data->>'cpf', ''), '\D', '', 'g') = v_clean_cpf)
    );

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1 FROM public.registrations r WHERE r.profile_id = v_profile_id
  ) INTO v_has_any_registration;

  IF v_claimed_count > 0 OR v_has_any_registration THEN
    UPDATE public.profiles
    SET account_type = 'frequent_participant'
    WHERE id = v_profile_id
      AND account_type = 'study';
  END IF;

  RETURN v_claimed_count;
END;
$function$;

-- Atualiza checkin_registration_by_qr() para respeitar can_manage_event(p_retreat_id)
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

  v_caller_profile_id := public.current_profile_id();
  v_is_manager := public.can_manage_event(p_retreat_id);

  IF NOT COALESCE(v_is_manager, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'FORBIDDEN',
      'message', 'Você não possui permissão para realizar check-in neste evento.'
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

  SELECT * INTO v_reg
  FROM public.registrations r
  WHERE r.retreat_id = p_retreat_id
    AND lower(r.qr_token) = v_clean_token
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_reg
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

-- Hardening das RPCs de planilha de retiro para respeitar can_manage_event(p_retreat_id)
CREATE OR REPLACE FUNCTION public.patch_retreat_sheet_metadata(
  p_retreat_id uuid,
  p_sheet_name text,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.can_manage_event(p_retreat_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar planilhas deste evento.' USING ERRCODE = '42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.patch_retreat_spreadsheet_cell(
  p_retreat_id uuid,
  p_sheet_name text,
  p_cell_coord text,
  p_value jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.can_manage_event(p_retreat_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar planilhas deste evento.' USING ERRCODE = '42501';
  END IF;

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

-- ============================================================================
-- 8. POLÍTICAS RLS (Substituição Limpa para Todas as Tabelas Afetadas)
-- ============================================================================

-- 8.1. public.profiles
DROP POLICY IF EXISTS "Usuários autenticados podem ver perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuários podem atualizar seus próprios perfis" ON public.profiles;
DROP POLICY IF EXISTS "Liderança pode inserir perfis" ON public.profiles;
DROP POLICY IF EXISTS "Liderança pode atualizar perfis" ON public.profiles;
DROP POLICY IF EXISTS "Liderança pode excluir perfis provisórios" ON public.profiles;

CREATE POLICY "Perfis: leitura restrita ao dono e gestao"
ON public.profiles FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.has_role('dev')
  OR public.has_role('presbyter')
  OR public.has_role('deacon')
  OR (home_group_id IS NOT NULL AND public.is_gc_leader(home_group_id))
);

CREATE POLICY "Perfis: insercao por presbitero, dev ou lider do grupo"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (
  public.has_role('dev')
  OR public.has_role('presbyter')
  OR (home_group_id IS NOT NULL AND public.is_gc_leader(home_group_id))
);

CREATE POLICY "Perfis: atualizacao pelo dono, presbitero, dev ou lider do grupo"
ON public.profiles FOR UPDATE TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.has_role('dev')
  OR public.has_role('presbyter')
  OR (home_group_id IS NOT NULL AND public.is_gc_leader(home_group_id))
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  OR public.has_role('dev')
  OR public.has_role('presbyter')
  OR public.is_gc_leader(NULL)
);

CREATE POLICY "Perfis: exclusao de provisorios por presbitero, dev ou lider do grupo"
ON public.profiles FOR DELETE TO authenticated
USING (
  user_id IS NULL
  AND (
    public.has_role('dev')
    OR public.has_role('presbyter')
    OR (home_group_id IS NOT NULL AND public.is_gc_leader(home_group_id))
  )
);

-- 8.2. public.profile_directory
DROP POLICY IF EXISTS "Diretorio: leitura para discipulos, gestao e autores publicos" ON public.profile_directory;
DROP POLICY IF EXISTS "Diretorio: leitura anonima de autores publicos" ON public.profile_directory;

CREATE POLICY "Diretorio: leitura para discipulos, gestao e autores publicos"
ON public.profile_directory FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.can_view_people()
  OR (public.current_account_type() = 'disciple' AND account_type = 'disciple')
  OR EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.author_id = profile_directory.id
      AND p.is_published = true
      AND p.is_public = true
  )
);

CREATE POLICY "Diretorio: leitura anonima de autores publicos"
ON public.profile_directory FOR SELECT TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.author_id = profile_directory.id
      AND p.is_published = true
      AND p.is_public = true
  )
);

-- 8.3. public.profile_roles
CREATE POLICY "Papeis: leitura para o proprio ou gestao"
ON public.profile_roles FOR SELECT TO authenticated
USING (
  profile_id = public.current_profile_id()
  OR public.can_view_people()
);

CREATE POLICY "Papeis: insercao conforme hierarquia"
ON public.profile_roles FOR INSERT TO authenticated
WITH CHECK (
  public.has_role('dev')
  OR (role IN ('presbyter', 'deacon') AND public.has_role('presbyter'))
  OR (role = 'publisher' AND public.has_role('deacon'))
);

CREATE POLICY "Papeis: remocao conforme hierarquia"
ON public.profile_roles FOR DELETE TO authenticated
USING (
  public.has_role('dev')
  OR (role IN ('presbyter', 'deacon') AND public.has_role('presbyter'))
  OR (role = 'publisher' AND public.has_role('deacon'))
);

-- 8.4. public.resource_permissions
CREATE POLICY "Permissoes por recurso: leitura para dono, diacono ou dev"
ON public.resource_permissions FOR SELECT TO authenticated
USING (
  profile_id = public.current_profile_id()
  OR public.has_role('dev')
  OR public.has_role('deacon')
);

CREATE POLICY "Permissoes por recurso: gestao apenas diacono ou dev"
ON public.resource_permissions FOR ALL TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'))
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

-- 8.5. public.home_groups, public.sectors, public.fellowships (Diácono apenas visualiza)
DROP POLICY IF EXISTS "Usuários autenticados podem ver grupos caseiros" ON public.home_groups;
DROP POLICY IF EXISTS "Liderança ampla pode gerenciar grupos caseiros" ON public.home_groups;
DROP POLICY IF EXISTS "Líderes podem atualizar seu próprio grupo" ON public.home_groups;

CREATE POLICY "Grupos: leitura para discipulos e gestao"
ON public.home_groups FOR SELECT TO authenticated
USING (public.current_account_type() = 'disciple' OR public.can_view_people());

CREATE POLICY "Grupos: gestao completa por presbitero ou dev"
ON public.home_groups FOR ALL TO authenticated
USING (public.has_role('dev') OR public.has_role('presbyter'))
WITH CHECK (public.has_role('dev') OR public.has_role('presbyter'));

CREATE POLICY "Grupos: lideres atualizam o proprio grupo"
ON public.home_groups FOR UPDATE TO authenticated
USING (public.is_gc_leader(id))
WITH CHECK (public.is_gc_leader(id));

DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON public.sectors;
DROP POLICY IF EXISTS "Allow write access for leadership" ON public.sectors;

CREATE POLICY "Setores: leitura para discipulos e gestao"
ON public.sectors FOR SELECT TO authenticated
USING (public.current_account_type() = 'disciple' OR public.can_view_people());

CREATE POLICY "Setores: escrita por presbitero ou dev"
ON public.sectors FOR ALL TO authenticated
USING (public.has_role('dev') OR public.has_role('presbyter'))
WITH CHECK (public.has_role('dev') OR public.has_role('presbyter'));

DROP POLICY IF EXISTS "Usuários podem ver suas próprias comunhões" ON public.fellowships;
DROP POLICY IF EXISTS "Liderança ampla pode gerenciar comunhões" ON public.fellowships;

CREATE POLICY "Comunhoes: leitura para proprios, discipulos em gestao ou lideres"
ON public.fellowships FOR SELECT TO authenticated
USING (
  member_a_id = public.current_profile_id()
  OR member_b_id = public.current_profile_id()
  OR public.can_view_people()
);

CREATE POLICY "Comunhoes: gestao por presbitero, dev ou lider do grupo"
ON public.fellowships FOR ALL TO authenticated
USING (
  public.has_role('dev')
  OR public.has_role('presbyter')
  OR EXISTS (
    SELECT 1 FROM public.profiles pa, public.profiles pb
    WHERE pa.id = fellowships.member_a_id
      AND pb.id = fellowships.member_b_id
      AND (public.is_gc_leader(pa.home_group_id) OR public.is_gc_leader(pb.home_group_id))
  )
)
WITH CHECK (
  public.has_role('dev')
  OR public.has_role('presbyter')
  OR EXISTS (
    SELECT 1 FROM public.profiles pa, public.profiles pb
    WHERE pa.id = fellowships.member_a_id
      AND pb.id = fellowships.member_b_id
      AND (public.is_gc_leader(pa.home_group_id) OR public.is_gc_leader(pb.home_group_id))
  )
);

-- 8.6. public.posts (Presbítero NÃO publica/edita; gestor de evento posta apenas para seu evento)
DROP POLICY IF EXISTS "Allow public read for public published posts" ON public.posts;
DROP POLICY IF EXISTS "Allow anon read for published posts" ON public.posts;
DROP POLICY IF EXISTS "Allow authenticated read for posts" ON public.posts;
DROP POLICY IF EXISTS "Allow authorized users to insert posts" ON public.posts;
DROP POLICY IF EXISTS "Allow authors and leaders to update posts" ON public.posts;
DROP POLICY IF EXISTS "Allow authors and leaders to delete posts" ON public.posts;

CREATE POLICY "Posts: leitura anonima apenas publicos publicados"
ON public.posts FOR SELECT TO anon
USING (is_published = true AND is_public = true);

CREATE POLICY "Posts: leitura autenticada por vinculo ou autorizacao"
ON public.posts FOR SELECT TO authenticated
USING (
  (is_published = true AND is_public = true)
  OR (is_published = true AND public.current_account_type() = 'disciple')
  OR author_id = public.current_profile_id()
  OR public.has_role('dev')
  OR public.has_role('deacon')
  OR public.has_role('publisher')
  OR (retreat_id IS NOT NULL AND public.can_manage_event(retreat_id))
);

CREATE POLICY "Posts: insercao por diacono, dev, publicador ou gestor do evento"
ON public.posts FOR INSERT TO authenticated
WITH CHECK (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR public.has_role('publisher')
  OR (
    retreat_id IS NOT NULL
    AND category = 'evento'
    AND public.can_manage_event(retreat_id)
  )
);

CREATE POLICY "Posts: atualizacao por diacono, dev, autor autorizado ou gestor do evento"
ON public.posts FOR UPDATE TO authenticated
USING (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR (author_id = public.current_profile_id() AND public.can_post_news(retreat_id))
  OR (retreat_id IS NOT NULL AND public.can_manage_event(retreat_id))
)
WITH CHECK (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR (author_id = public.current_profile_id() AND public.can_post_news(retreat_id))
  OR (
    retreat_id IS NOT NULL
    AND category = 'evento'
    AND public.can_manage_event(retreat_id)
  )
);

CREATE POLICY "Posts: exclusao por diacono, dev, autor autorizado ou gestor do evento"
ON public.posts FOR DELETE TO authenticated
USING (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR (author_id = public.current_profile_id() AND public.can_post_news(retreat_id))
  OR (retreat_id IS NOT NULL AND public.can_manage_event(retreat_id))
);

-- 8.7. public.forms & public.form_submissions
DROP POLICY IF EXISTS "Allow SELECT on forms for everyone if public, or authenticated" ON public.forms;
DROP POLICY IF EXISTS "Allow ALL on forms for leadership" ON public.forms;

CREATE POLICY "Forms: leitura publica ou para discipulos/gestores"
ON public.forms FOR SELECT TO anon, authenticated
USING (
  is_public = true
  OR (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      public.current_account_type() = 'disciple'
      OR public.can_manage_form(id)
    )
  )
);

CREATE POLICY "Forms: criacao apenas por diacono ou dev"
ON public.forms FOR INSERT TO authenticated
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

CREATE POLICY "Forms: atualizacao por diacono, dev ou permissao no formulario"
ON public.forms FOR UPDATE TO authenticated
USING (public.can_manage_form(id))
WITH CHECK (public.can_manage_form(id));

CREATE POLICY "Forms: exclusao apenas por diacono ou dev"
ON public.forms FOR DELETE TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'));

DROP POLICY IF EXISTS "Allow INSERT on submissions if form is public or user is authenticated" ON public.form_submissions;
DROP POLICY IF EXISTS "Allow SELECT on submissions for leadership" ON public.form_submissions;
DROP POLICY IF EXISTS "Allow UPDATE/DELETE on submissions for leadership" ON public.form_submissions;

CREATE POLICY "FormSubmissions: envio em formularios publicos ou privados por discipulo"
ON public.form_submissions FOR INSERT TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.forms f
    WHERE f.id = form_submissions.form_id
      AND (
        f.is_public = true
        OR (
          (SELECT auth.uid()) IS NOT NULL
          AND (form_submissions.user_id = (SELECT auth.uid()) OR form_submissions.user_id IS NULL)
          AND (public.current_account_type() = 'disciple' OR public.can_manage_form(f.id))
        )
      )
  )
);

CREATE POLICY "FormSubmissions: leitura por diacono, dev ou permissao no formulario"
ON public.form_submissions FOR SELECT TO authenticated
USING (public.can_manage_form(form_id));

CREATE POLICY "FormSubmissions: atualizacao/exclusao por diacono, dev ou permissao no formulario"
ON public.form_submissions FOR UPDATE TO authenticated
USING (public.can_manage_form(form_id))
WITH CHECK (public.can_manage_form(form_id));

CREATE POLICY "FormSubmissions: exclusao por diacono, dev ou permissao no formulario"
ON public.form_submissions FOR DELETE TO authenticated
USING (public.can_manage_form(form_id));

-- 8.8. Eventos e Tabelas Filhas (Diácono, Dev ou permissão no evento específico)
DROP POLICY IF EXISTS "Presbíteros e devs podem gerenciar retiros" ON public.retreats;
DROP POLICY IF EXISTS "Permitir leitura de retiros para todos" ON public.retreats;

CREATE POLICY "Retreats: leitura publica"
ON public.retreats FOR SELECT TO anon, authenticated
USING (true);

CREATE POLICY "Retreats: criacao apenas por diacono ou dev"
ON public.retreats FOR INSERT TO authenticated
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

CREATE POLICY "Retreats: atualizacao por diacono, dev ou permissao no evento"
ON public.retreats FOR UPDATE TO authenticated
USING (public.can_manage_event(id))
WITH CHECK (public.can_manage_event(id));

CREATE POLICY "Retreats: exclusao apenas por diacono ou dev"
ON public.retreats FOR DELETE TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'));

DROP POLICY IF EXISTS "Presbíteros e devs podem atualizar lotes" ON public.retreat_batches;
DROP POLICY IF EXISTS "Presbíteros e devs podem excluir lotes" ON public.retreat_batches;
DROP POLICY IF EXISTS "Presbíteros e devs podem inserir lotes" ON public.retreat_batches;

CREATE POLICY "Lotes: insercao por gestor do evento"
ON public.retreat_batches FOR INSERT TO authenticated
WITH CHECK (public.can_manage_event(retreat_id));

CREATE POLICY "Lotes: atualizacao por gestor do evento"
ON public.retreat_batches FOR UPDATE TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

CREATE POLICY "Lotes: exclusao por gestor do evento"
ON public.retreat_batches FOR DELETE TO authenticated
USING (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Presbíteros, deacons e devs podem gerenciar quartos" ON public.retreat_rooms;
CREATE POLICY "Quartos: gestao por gestor do evento"
ON public.retreat_rooms FOR ALL TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Presbíteros, deacons e devs podem gerenciar despesas" ON public.retreat_expenses;
CREATE POLICY "Despesas: gestao por gestor do evento"
ON public.retreat_expenses FOR ALL TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Presbíteros, diáconos e devs podem gerenciar anexos de despesas" ON public.retreat_expense_attachments;
CREATE POLICY "AnexosDespesas: gestao por gestor do evento"
ON public.retreat_expense_attachments FOR ALL TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Gestores e presbiteros podem gerenciar cupons" ON public.event_coupons;
CREATE POLICY "Cupons: gestao por diacono, dev ou gestor do evento"
ON public.event_coupons FOR ALL TO authenticated
USING (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR (retreat_id IS NOT NULL AND public.can_manage_event(retreat_id))
  OR (form_id IS NOT NULL AND public.can_manage_form(form_id))
)
WITH CHECK (
  public.has_role('dev')
  OR public.has_role('deacon')
  OR (retreat_id IS NOT NULL AND public.can_manage_event(retreat_id))
  OR (form_id IS NOT NULL AND public.can_manage_form(form_id))
);

DROP POLICY IF EXISTS "Liderança e devs podem visualizar lista de espera" ON public.event_waitlist;
DROP POLICY IF EXISTS "Liderança e devs podem atualizar lista de espera" ON public.event_waitlist;
DROP POLICY IF EXISTS "Liderança e devs podem deletar da lista de espera" ON public.event_waitlist;

CREATE POLICY "Waitlist: leitura por gestor do evento"
ON public.event_waitlist FOR SELECT TO authenticated
USING (public.can_manage_event(retreat_id));

CREATE POLICY "Waitlist: atualizacao por gestor do evento"
ON public.event_waitlist FOR UPDATE TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

CREATE POLICY "Waitlist: exclusao por gestor do evento"
ON public.event_waitlist FOR DELETE TO authenticated
USING (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Presbíteros, deacons e liderança podem ver todas as inscrições" ON public.registrations;
DROP POLICY IF EXISTS "Presbíteros, deacons e liderança podem atualizar todas as inscrições" ON public.registrations;
DROP POLICY IF EXISTS "Presbíteros, deacons e liderança podem deletar inscrições" ON public.registrations;

CREATE POLICY "Inscricoes: leitura por gestor do evento"
ON public.registrations FOR SELECT TO authenticated
USING (public.can_manage_event(retreat_id));

CREATE POLICY "Inscricoes: atualizacao por gestor do evento"
ON public.registrations FOR UPDATE TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

CREATE POLICY "Inscricoes: exclusao por gestor do evento"
ON public.registrations FOR DELETE TO authenticated
USING (public.can_manage_event(retreat_id));

DROP POLICY IF EXISTS "Participantes e organizadores podem ver mensagens do portal" ON public.retreat_participant_messages;
DROP POLICY IF EXISTS "Participantes e organizadores podem enviar mensagens no portal" ON public.retreat_participant_messages;
DROP POLICY IF EXISTS "Organizadores podem marcar mensagens do portal como lidas" ON public.retreat_participant_messages;

CREATE POLICY "MensagensPortal: leitura por participante ou gestor do evento"
ON public.retreat_participant_messages FOR SELECT TO authenticated
USING (
  public.can_manage_event(retreat_id)
  OR EXISTS (
    SELECT 1 FROM public.registrations r
    WHERE r.id = retreat_participant_messages.registration_id
      AND r.profile_id = public.current_profile_id()
  )
);

CREATE POLICY "MensagensPortal: envio por participante ou gestor do evento"
ON public.retreat_participant_messages FOR INSERT TO authenticated
WITH CHECK (
  (
    sender_role = 'organizer'
    AND (sender_profile_id IS NULL OR sender_profile_id = public.current_profile_id())
    AND EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.id = retreat_participant_messages.registration_id
        AND r.retreat_id = retreat_participant_messages.retreat_id
    )
    AND public.can_manage_event(retreat_id)
  )
  OR (
    sender_role = 'participant'
    AND (sender_profile_id IS NULL OR sender_profile_id = public.current_profile_id())
    AND EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.id = retreat_participant_messages.registration_id
        AND r.retreat_id = retreat_participant_messages.retreat_id
        AND r.profile_id = public.current_profile_id()
    )
  )
);

CREATE POLICY "MensagensPortal: atualizacao por gestor do evento"
ON public.retreat_participant_messages FOR UPDATE TO authenticated
USING (public.can_manage_event(retreat_id))
WITH CHECK (public.can_manage_event(retreat_id));

-- 8.9. Estudos e Mídias (Diácono e Dev gerenciam; todos autenticados e anon leem)
DROP POLICY IF EXISTS "Permitir inserção para liderança" ON public.media_resources;
DROP POLICY IF EXISTS "Permitir delete para liderança" ON public.media_resources;
DROP POLICY IF EXISTS "Allow leadership to manage studies" ON public.studies;
DROP POLICY IF EXISTS "Allow leadership to manage study steps" ON public.study_steps;

CREATE POLICY "MediaResources: insercao por diacono ou dev"
ON public.media_resources FOR INSERT TO authenticated
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

CREATE POLICY "MediaResources: exclusao por diacono ou dev"
ON public.media_resources FOR DELETE TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'));

CREATE POLICY "Studies: gestao por diacono ou dev"
ON public.studies FOR ALL TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'))
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

CREATE POLICY "StudySteps: gestao por diacono ou dev"
ON public.study_steps FOR ALL TO authenticated
USING (public.has_role('dev') OR public.has_role('deacon'))
WITH CHECK (public.has_role('dev') OR public.has_role('deacon'));

-- 8.10. Storage Buckets
DROP POLICY IF EXISTS "Allow leadership to manage objects in ensinos bucket" ON storage.objects;
CREATE POLICY "EnsinosStorage: gestao por diacono ou dev"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'ensinos' AND (public.has_role('dev') OR public.has_role('deacon')))
WITH CHECK (bucket_id = 'ensinos' AND (public.has_role('dev') OR public.has_role('deacon')));

DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated update to post-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete to post-images" ON storage.objects;

CREATE POLICY "PostImagesStorage: upload por autorizados"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'post-images' AND public.can_post_any());

CREATE POLICY "PostImagesStorage: atualizacao por autorizados"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'post-images' AND public.can_post_any())
WITH CHECK (bucket_id = 'post-images' AND public.can_post_any());

CREATE POLICY "PostImagesStorage: exclusao por autorizados"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'post-images' AND public.can_post_any());

DROP POLICY IF EXISTS "Liderança pode visualizar anexos de despesas no storage" ON storage.objects;
DROP POLICY IF EXISTS "Liderança pode enviar anexos de despesas no storage" ON storage.objects;
DROP POLICY IF EXISTS "Liderança pode atualizar anexos de despesas no storage" ON storage.objects;
DROP POLICY IF EXISTS "Liderança pode excluir anexos de despesas no storage" ON storage.objects;

CREATE POLICY "DespesasStorage: gestao por quem gerencia eventos"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'retreat-expense-attachments' AND public.can_manage_events_any())
WITH CHECK (bucket_id = 'retreat-expense-attachments' AND public.can_manage_events_any());

NOTIFY pgrst, 'reload schema';
