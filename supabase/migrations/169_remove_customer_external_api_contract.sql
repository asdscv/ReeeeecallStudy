-- 169: Defense-in-depth contract removal for the retired customer rc_ REST API.
-- Migration 117 already removed these objects on the normal history. This migration
-- closes drifted environments idempotently without touching internal app rate limits.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.resolve_api_key(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.resolve_api_key(text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.resolve_api_key(text);
DROP TABLE IF EXISTS public.api_keys CASCADE;

COMMIT;
