-- Adiciona coluna nucleus_name para armazenar o nome do núcleo do Grupo Caseiro
ALTER TABLE public.home_groups
ADD COLUMN IF NOT EXISTS nucleus_name text;

COMMENT ON COLUMN public.home_groups.nucleus_name IS
'Nome identificador do núcleo ou agrupamento regional ao qual o Grupo Caseiro pertence (ex: Núcleo Castelo / Pampulha).';
