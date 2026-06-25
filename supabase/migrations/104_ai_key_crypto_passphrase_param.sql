-- ============================================================================
-- 104: AI-key crypto functions that take the passphrase as a PARAMETER (H1 a).
--
-- H1: the AES passphrase is stored PLAINTEXT in public._ai_encryption_config, so
-- a DB dump / service-role leak can decrypt every user's AI provider key. The
-- simple "read passphrase from Vault" fix is impossible (PostgREST excludes any
-- function referencing vault.decrypted_secrets → /rpc 404; that's why mig 074
-- moved off Vault). Correct fix: move the passphrase to a Supabase EDGE SECRET
-- (AI_KEY_PASSPHRASE) and have the `ai-keys` Edge function pass it to these
-- service-role-only functions. pgcrypto stays in the DB, so existing
-- encrypted_api_key rows decrypt unchanged with the SAME passphrase (no
-- re-encryption / rotation).
--
-- ADDITIVE phase: the old RPCs (get/upsert/delete_ai_provider_key) and the
-- _ai_encryption_config table remain in place until the client is switched to
-- the Edge function (phase b) and verified, then dropped (phase c). Nothing here
-- changes existing behavior.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ai_provider_keys_secure(p_user_id uuid, p_passphrase text)
  RETURNS TABLE(provider_id text, api_key text, model text, base_url text, saved_at text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  IF p_user_id IS NULL OR p_passphrase IS NULL OR p_passphrase = '' THEN
    RAISE EXCEPTION 'missing args';
  END IF;
  RETURN QUERY
    SELECT k.provider_id,
           extensions.pgp_sym_decrypt(k.encrypted_api_key, p_passphrase),
           k.model, k.base_url, k.updated_at::text
    FROM user_ai_provider_keys k
    WHERE k.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ai_provider_key_secure(
  p_user_id uuid, p_provider_id text, p_api_key text, p_model text,
  p_base_url text, p_passphrase text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  IF p_user_id IS NULL OR p_passphrase IS NULL OR p_passphrase = '' THEN
    RAISE EXCEPTION 'missing args';
  END IF;
  INSERT INTO user_ai_provider_keys (user_id, provider_id, encrypted_api_key, model, base_url)
  VALUES (p_user_id, p_provider_id, extensions.pgp_sym_encrypt(p_api_key, p_passphrase), p_model, p_base_url)
  ON CONFLICT (user_id, provider_id) DO UPDATE SET
    encrypted_api_key = extensions.pgp_sym_encrypt(p_api_key, p_passphrase),
    model = EXCLUDED.model,
    base_url = EXCLUDED.base_url,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_ai_provider_key_secure(p_user_id uuid, p_provider_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing args';
  END IF;
  DELETE FROM user_ai_provider_keys WHERE user_id = p_user_id AND provider_id = p_provider_id;
END;
$$;

-- service-role ONLY: these accept a user_id + passphrase, so they must never be
-- client-callable. The `ai-keys` Edge function calls them with the service-role
-- key after verifying the user's JWT.
REVOKE EXECUTE ON FUNCTION public.get_ai_provider_keys_secure(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_ai_provider_key_secure(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_ai_provider_key_secure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_provider_keys_secure(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ai_provider_key_secure(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_ai_provider_key_secure(uuid, text) TO service_role;
