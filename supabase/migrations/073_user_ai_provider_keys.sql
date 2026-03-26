-- ============================================================
-- 073: Supabase 서버사이드 AI 프로바이더 키 저장소
-- ============================================================
--
-- SECURITY ARCHITECTURE:
--
--   이전 방식 (localStorage + AES-GCM):
--     - 암호화 키를 UID에서 파생 → UID는 비밀이 아님 (JWT, 로그에 노출)
--     - XSS 공격 시 localStorage + UID 모두 탈취 가능
--     - 디바이스 간 동기화 불가
--
--   현재 방식 (Supabase + pgcrypto + Vault):
--     - 암호화 키(passphrase)는 Supabase Vault에 저장 → 클라이언트 접근 불가
--     - pgp_sym_encrypt: AES-256 + SHA-256 무결성 검증
--     - SECURITY DEFINER RPC: auth.uid() 검증 후에만 복호화
--     - RLS: 방어 다중화 (defense-in-depth)
--     - TLS: 복호화된 키는 HTTPS로만 전송
--
--   위협 모델:
--     - DB 탈취: BYTEA 암호문만 획득, Vault 시크릿 없이 복호화 불가
--     - 클라이언트 탈취: 인증된 유저의 키만 RPC로 접근 가능
--     - 네트워크: TLS가 복호화된 키 보호
--     - Vault 시크릿 로테이션: 재암호화 마이그레이션 필요 (별도 스크립트)
--
-- SETUP (Supabase SQL Editor에서 1회 실행):
--   SELECT vault.create_secret('your-strong-random-passphrase', 'ai_key_encryption_secret');
--
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 테이블 ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_ai_provider_keys (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id      TEXT NOT NULL,          -- 'openai' | 'anthropic' | 'google' | 'xai' | 'custom'

  -- SECURITY: pgp_sym_encrypt 출력 (Vault 시크릿으로 암호화)
  -- 클라이언트는 이 컬럼을 직접 읽을 수 없음 (RPC를 통해서만 복호화)
  encrypted_api_key  BYTEA NOT NULL,

  model            TEXT NOT NULL,          -- 'gpt-4o', 'claude-sonnet-4-6', etc.
  base_url         TEXT,                   -- 'custom' 프로바이더 전용

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 유저당 프로바이더 1개
  CONSTRAINT uq_user_ai_provider UNIQUE (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ai_keys_user
  ON user_ai_provider_keys (user_id);

-- ── RLS (defense-in-depth) ──────────────────────────────────
-- RPC가 SECURITY DEFINER라 RLS를 우회하지만, 직접 쿼리 방어용

ALTER TABLE user_ai_provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own AI provider keys"
  ON user_ai_provider_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── RPC: 키 저장 (암호화) ───────────────────────────────────
-- SECURITY DEFINER: DB 오너 권한으로 Vault 시크릿 접근
-- auth.uid() 검증으로 타 유저 키 접근 방지

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

  -- SECURITY: Vault에서 암호화 시크릿 조회
  -- 이 시크릿은 클라이언트에 절대 노출되지 않음
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'ai_key_encryption_secret'
    LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Encryption secret not configured. Run: SELECT vault.create_secret(...)';
  END IF;

  INSERT INTO user_ai_provider_keys (user_id, provider_id, encrypted_api_key, model, base_url)
  VALUES (
    v_uid,
    p_provider_id,
    pgp_sym_encrypt(p_api_key, v_secret),
    p_model,
    p_base_url
  )
  ON CONFLICT (user_id, provider_id)
  DO UPDATE SET
    encrypted_api_key = pgp_sym_encrypt(p_api_key, v_secret),
    model   = EXCLUDED.model,
    base_url = EXCLUDED.base_url,
    updated_at = now();
END;
$$;

-- ── RPC: 키 조회 (복호화) ───────────────────────────────────

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

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'ai_key_encryption_secret'
    LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Encryption secret not configured';
  END IF;

  RETURN QUERY
  SELECT
    k.provider_id,
    pgp_sym_decrypt(k.encrypted_api_key, v_secret),
    k.model,
    k.base_url,
    k.updated_at::text
  FROM user_ai_provider_keys k
  WHERE k.user_id = v_uid;
END;
$$;

-- ── RPC: 키 삭제 ────────────────────────────────────────────

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
