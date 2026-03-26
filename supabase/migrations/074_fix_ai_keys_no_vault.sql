-- ============================================================
-- 074: AI 키 암호화를 Vault → 프라이빗 테이블 방식으로 전환
-- ============================================================
--
-- WHY: Supabase Vault(vault.decrypted_secrets)를 참조하는 함수는
--      PostgREST 인트로스펙션에서 제외되어 404 Not Found 발생.
--
-- SOLUTION: 프라이빗 테이블 _ai_encryption_config에 시크릿 저장.
--   - RLS 활성화 + 정책 없음 = 일반 유저 접근 완전 차단
--   - SECURITY DEFINER 함수만 접근 가능 (DB 오너 권한)
--   - id=1 CHECK 제약 = 항상 1행만 존재
--
-- SECURITY:
--   - 암호화 시크릿: gen_random_bytes(32) = 256비트 랜덤
--   - pgp_sym_encrypt: AES-256 + SHA-256 무결성
--   - 일반 유저: _ai_encryption_config SELECT 불가 (RLS 차단)
--   - SECURITY DEFINER: auth.uid() 검증 후에만 복호화 실행
--   - DB 탈취 시: encrypted_api_key(BYTEA) + 시크릿 테이블 모두 필요
-- ============================================================

-- ── 1. 암호화 키 프라이빗 테이블 ─────────────────────────────

CREATE TABLE IF NOT EXISTS _ai_encryption_config (
  id     INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret TEXT NOT NULL
);

ALTER TABLE _ai_encryption_config ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = 모든 일반 유저 접근 차단
-- SECURITY DEFINER 함수는 RLS를 우회하므로 접근 가능

INSERT INTO _ai_encryption_config (secret)
VALUES (encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- ── 2. RPC 재생성 (vault → _ai_encryption_config) ───────────

CREATE OR REPLACE FUNCTION upsert_ai_provider_key(
  p_provider_id  TEXT,
  p_api_key      TEXT,
  p_model        TEXT,
  p_base_url     TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_secret TEXT;
BEGIN
  -- SECURITY: 인증 필수
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- SECURITY: 프라이빗 테이블에서 시크릿 조회
  -- RLS 정책 없음 → 일반 쿼리로는 접근 불가
  -- SECURITY DEFINER가 DB 오너 권한으로 우회
  SELECT secret INTO v_secret FROM _ai_encryption_config WHERE id = 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Encryption secret not configured';
  END IF;

  INSERT INTO user_ai_provider_keys (user_id, provider_id, encrypted_api_key, model, base_url)
  VALUES (
    v_uid,
    p_provider_id,
    extensions.pgp_sym_encrypt(p_api_key, v_secret),
    p_model,
    p_base_url
  )
  ON CONFLICT (user_id, provider_id)
  DO UPDATE SET
    encrypted_api_key = extensions.pgp_sym_encrypt(p_api_key, v_secret),
    model   = EXCLUDED.model,
    base_url = EXCLUDED.base_url,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION get_ai_provider_keys()
RETURNS TABLE (
  provider_id TEXT,
  api_key     TEXT,
  model       TEXT,
  base_url    TEXT,
  saved_at    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_secret TEXT;
BEGIN
  -- SECURITY: 인증 필수
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT secret INTO v_secret FROM _ai_encryption_config WHERE id = 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Encryption secret not configured';
  END IF;

  RETURN QUERY
  SELECT
    k.provider_id,
    extensions.pgp_sym_decrypt(k.encrypted_api_key, v_secret),
    k.model,
    k.base_url,
    k.updated_at::text
  FROM user_ai_provider_keys k
  WHERE k.user_id = v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION delete_ai_provider_key(p_provider_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM user_ai_provider_keys
  WHERE user_id = auth.uid()
    AND provider_id = p_provider_id;
END;
$$;

-- ── 3. 권한 부여 ─────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION upsert_ai_provider_key(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_provider_keys() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_ai_provider_key(TEXT) TO authenticated;

-- ── 4. PostgREST 스키마 캐시 리로드 ──────────────────────────

NOTIFY pgrst, 'reload schema';
