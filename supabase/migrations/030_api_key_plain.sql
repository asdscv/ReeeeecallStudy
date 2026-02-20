-- Migration 030: Store plain API key for user retrieval
-- RLS SELECT policy already restricts to owner only

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_plain TEXT;
