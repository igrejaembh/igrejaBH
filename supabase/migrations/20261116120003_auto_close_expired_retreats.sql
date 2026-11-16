-- Migration: Encerramento automático de retiros após data de término (pg_cron + RPC)
-- Transiciona automaticamente retreats.status de 'ativo' para 'encerrado'
-- quando end_date já tiver passado no fuso horário America/Sao_Paulo.

-- 1. Instalar extensão pg_cron com segurança no schema pg_catalog
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Garantir permissão de uso do schema cron para o role postgres (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    GRANT USAGE ON SCHEMA cron TO postgres;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END
$$;

-- 2. Função determinística para encerrar retiros ativos expirados (America/Sao_Paulo)
CREATE OR REPLACE FUNCTION public.close_expired_retreats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_count integer := 0;
BEGIN
  UPDATE public.retreats
  SET status = 'encerrado'
  WHERE status = 'ativo'
    AND end_date IS NOT NULL
    AND end_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  RETURN v_closed_count;
END;
$$;

COMMENT ON FUNCTION public.close_expired_retreats() IS
  'Automatically transitions active retreats to encerrado after end_date passes in America/Sao_Paulo timezone and returns the count of updated rows.';

-- Restringir execução pública genérica e conceder explicitamente para os roles da API
REVOKE ALL ON FUNCTION public.close_expired_retreats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_expired_retreats() TO authenticated, anon, service_role;

-- 3. Agendar execução diária às 03:05 UTC (00:05 BRT) via pg_cron de forma idempotente
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'close-expired-retreats-daily'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'close-expired-retreats-daily',
  '5 3 * * *',
  $$SELECT public.close_expired_retreats();$$
);

-- 4. Sincronização inicial imediata dos retiros já vencidos
SELECT public.close_expired_retreats();
