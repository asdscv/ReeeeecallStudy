-- ========================================
-- ReeeCall Study - Storage Policies
-- ========================================
-- 001에서 생성한 card-images, card-audio 버킷에 대한 접근 정책
-- 경로 규칙: {user_id}/{deck_id}/{card_id}/{field_key}.{ext}

-- ========================================
-- 1. card-images 버킷 정책
-- ========================================
CREATE POLICY "Users can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'card-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'card-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'card-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Anyone can read images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'card-images');

-- ========================================
-- 2. card-audio 버킷 정책
-- ========================================
CREATE POLICY "Users can upload audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'card-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own audio"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'card-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own audio"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'card-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Anyone can read audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'card-audio');
