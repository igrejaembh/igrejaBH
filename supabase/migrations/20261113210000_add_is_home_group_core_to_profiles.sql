-- Migration: Add is_home_group_core to profiles
-- Adiciona a marcação de núcleo do grupo caseiro (apoio/liderança de GC) aos discípulos.
-- Nota: Discípulos no núcleo NÃO são líderes de GC e não possuem permissões de liderança/gestão.

-- 1. Adicionar a coluna is_home_group_core
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_home_group_core boolean NOT NULL DEFAULT false;

-- 2. Índice para consultas rápidas de membros do núcleo por grupo
CREATE INDEX IF NOT EXISTS idx_profiles_home_group_core
ON public.profiles (home_group_id, is_home_group_core)
WHERE is_home_group_core = true;

-- 3. Função e trigger para garantir integridade e proteção
-- - Se home_group_id for nulo, is_home_group_core é automaticamente resetado para false
-- - Apenas presbíteros, diáconos, devs ou líderes do grupo caseiro podem alterar is_home_group_core
CREATE OR REPLACE FUNCTION public.handle_profile_core_protection()
RETURNS TRIGGER AS $$
BEGIN
    -- Se o irmão não pertencer a nenhum grupo caseiro, nunca pode ser núcleo
    IF NEW.home_group_id IS NULL THEN
        NEW.is_home_group_core := false;
    END IF;

    -- Se o campo is_home_group_core foi alterado, verificar permissões de liderança
    IF (TG_OP = 'UPDATE' AND OLD.is_home_group_core IS DISTINCT FROM NEW.is_home_group_core) THEN
        -- Permitir se o usuário autenticado for Dev, Presbítero, Diácono (Tier 3)
        -- OU se for Líder do Grupo Caseiro ao qual o perfil pertence
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.user_id = auth.uid()
            AND (
                p.is_dev = true 
                OR p.is_presbyter = true 
                OR p.is_deacon = true
                OR EXISTS (
                    SELECT 1 FROM public.home_groups hg
                    WHERE (hg.leader_1_id = p.id OR hg.leader_2_id = p.id)
                    AND (hg.id = NEW.home_group_id OR hg.id = OLD.home_group_id)
                )
            )
        ) THEN
            -- Reverte para o valor anterior caso usuário não tenha permissão de liderança
            NEW.is_home_group_core := OLD.is_home_group_core;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_core_on_update ON public.profiles;
CREATE TRIGGER protect_core_on_update
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profile_core_protection();
