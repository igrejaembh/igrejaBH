-- Adiciona flag booleana is_group_nucleus em profiles para identificar integrantes do núcleo do Grupo Caseiro pelo ID do perfil
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_group_nucleus boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_group_nucleus IS
'Indica se o discípulo integra o núcleo de apoio do seu Grupo Caseiro.';
