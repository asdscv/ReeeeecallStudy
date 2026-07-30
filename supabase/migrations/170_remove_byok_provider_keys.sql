-- 170: Remove the retired BYOK (customer-supplied AI provider key) backend.
--
-- WHY: BYOK was replaced by server-side generation on OUR provider key
-- (mig 108+, edge fn `ai-generate`). The client stopped calling these objects
-- when the Settings AI-provider section was removed, and the `ai-keys` edge
-- function is deleted in the same change. What is left is pure attack surface:
--
--   * public._ai_encryption_config  — holds the AES passphrase in PLAINTEXT
--     (the open H1c item). Dropping it closes that at-rest exposure for good.
--   * public.user_ai_provider_keys  — customers' encrypted provider keys.
--   * 3 legacy client RPCs (auth.uid()-based, mig 073/074) + 3 service-role
--     `_secure` RPCs (passphrase-as-parameter, mig 104).
--
-- ⚠️ DESTRUCTIVE + IRREVERSIBLE: this deletes every stored customer AI provider
-- key. That is intended — the feature is retired, users now generate on our key.
-- Nothing reads these rows anymore, so there is no backfill/expand step.
--
-- Idempotent (IF EXISTS / to_regprocedure guards) so drifted environments and
-- fresh bootstraps both apply cleanly.

BEGIN;

-- ── 1. Legacy client-callable RPCs (mig 073 → redefined in 074) ─────────────
DO $$
BEGIN
  IF to_regprocedure('public.upsert_ai_provider_key(text, text, text, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.upsert_ai_provider_key(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.get_ai_provider_keys()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_ai_provider_keys() FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.delete_ai_provider_key(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.delete_ai_provider_key(text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.upsert_ai_provider_key(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_ai_provider_keys();
DROP FUNCTION IF EXISTS public.delete_ai_provider_key(text);

-- ── 2. service-role `_secure` RPCs called by the deleted `ai-keys` edge fn ──
DO $$
BEGIN
  IF to_regprocedure('public.get_ai_provider_keys_secure(uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_ai_provider_keys_secure(uuid, text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.upsert_ai_provider_key_secure(uuid, text, text, text, text, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.upsert_ai_provider_key_secure(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF to_regprocedure('public.delete_ai_provider_key_secure(uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.delete_ai_provider_key_secure(uuid, text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.get_ai_provider_keys_secure(uuid, text);
DROP FUNCTION IF EXISTS public.upsert_ai_provider_key_secure(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.delete_ai_provider_key_secure(uuid, text);

-- ── 3. Tables (key store + the plaintext-passphrase config) ─────────────────
DROP TABLE IF EXISTS public.user_ai_provider_keys CASCADE;
DROP TABLE IF EXISTS public._ai_encryption_config CASCADE;

COMMIT;

-- PostgREST must forget the dropped RPCs.
NOTIFY pgrst, 'reload schema';
