-- ============================================================================
-- CI Bootstrap — minimal Supabase auth schema for migration testing.
-- This file replicates the parts of Supabase's auth + GoTrue setup that
-- migrations 001..082 transitively depend on. Production environments have
-- these already (provisioned by Supabase). CI uses plain postgres:15, so we
-- create them here.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Supabase mounts pgcrypto under the `extensions` schema; alias the function
-- there so migrations that reference `extensions.gen_random_bytes` resolve.
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(n INTEGER)
  RETURNS BYTEA
  LANGUAGE sql VOLATILE
  AS $$ SELECT public.gen_random_bytes(n) $$;

-- storage.foldername() — Supabase utility for path-based RLS policies.
-- Production has this in pgsodium; here we stub it.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
  RETURNS TEXT[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT string_to_array(name, '/') $$;

-- Minimal Supabase Storage schema (just enough for migration INSERTs)
CREATE TABLE IF NOT EXISTS storage.buckets (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  owner         UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  public        BOOLEAN DEFAULT FALSE,
  avif_autodetection BOOLEAN DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id     TEXT REFERENCES storage.buckets(id),
  name          TEXT,
  owner         UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
  metadata      JSONB
);

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id        UUID,
  id                 UUID PRIMARY KEY,
  aud                VARCHAR(255),
  role               VARCHAR(255),
  email              VARCHAR(255) UNIQUE,
  encrypted_password VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ,
  invited_at         TIMESTAMPTZ,
  confirmation_token VARCHAR(255),
  confirmation_sent_at TIMESTAMPTZ,
  recovery_token     VARCHAR(255),
  recovery_sent_at   TIMESTAMPTZ,
  email_change_token VARCHAR(255),
  email_change       VARCHAR(255),
  email_change_sent_at TIMESTAMPTZ,
  last_sign_in_at    TIMESTAMPTZ,
  raw_app_meta_data  JSONB,
  raw_user_meta_data JSONB,
  is_super_admin     BOOLEAN,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  phone              VARCHAR(255),
  phone_confirmed_at TIMESTAMPTZ,
  phone_change       VARCHAR(255),
  phone_change_token VARCHAR(255),
  phone_change_sent_at TIMESTAMPTZ,
  confirmed_at       TIMESTAMPTZ,
  email_change_confirm_status SMALLINT,
  banned_until       TIMESTAMPTZ,
  reauthentication_token VARCHAR(255),
  reauthentication_sent_at TIMESTAMPTZ,
  is_sso_user        BOOLEAN DEFAULT false,
  deleted_at         TIMESTAMPTZ,
  is_anonymous       BOOLEAN DEFAULT false
);

-- auth helpers that migrations reference via auth.uid() / auth.role()
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('request.jwt.claim.email', true), '') $$;

-- Roles that GRANT statements expect
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA auth TO service_role, authenticated, anon;
GRANT USAGE ON SCHEMA extensions TO service_role, authenticated, anon;
