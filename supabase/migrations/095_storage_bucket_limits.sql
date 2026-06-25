-- ============================================================================
-- 095: Storage bucket upload hardening (security audit round 2).
--
-- card-audio / card-images had NO file_size_limit and NO allowed_mime_types, so
-- a client bypassing the app could upload arbitrary-size / arbitrary-type files
-- to their own folder (storage exhaustion + arbitrary stored content). Enforce
-- limits at the bucket level matching the client's validateFile():
--   card-images   → 5 MB,  image/jpeg|png|webp
--   card-audio    → 10 MB, audio/mpeg|ogg|wav
--   content-images→ 5 MB,  image/jpeg|png|webp
-- Limits apply to NEW uploads only; existing objects are unaffected. Buckets stay
-- public (media served by URL) and the own-folder write policies are unchanged.
-- Already applied to prod via SQL; versioned here for fresh environments.
-- ============================================================================

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'card-images';

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['audio/mpeg','audio/ogg','audio/wav']
WHERE id = 'card-audio';

UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'content-images';
