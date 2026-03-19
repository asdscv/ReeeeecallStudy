-- ============================================================
-- 053_marketplace_reviews.sql
-- Ratings & reviews system for marketplace listings
-- ============================================================

-- ─── 1. marketplace_reviews table ──────────────────────────

CREATE TABLE marketplace_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title          TEXT,
  body           TEXT,
  is_edited      BOOLEAN DEFAULT false,
  helpful_count  INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(listing_id, user_id)  -- one review per user per listing
);

CREATE INDEX idx_mr_listing ON marketplace_reviews(listing_id, created_at DESC);
CREATE INDEX idx_mr_user ON marketplace_reviews(user_id);

ALTER TABLE marketplace_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read reviews
CREATE POLICY "Anyone reads reviews" ON marketplace_reviews
  FOR SELECT USING (true);

-- Users manage own reviews
CREATE POLICY "Users manage own reviews" ON marketplace_reviews
  FOR ALL USING (auth.uid() = user_id);

-- ─── 2. review_helpfuls table (one helpful vote per user per review) ─

CREATE TABLE review_helpfuls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL REFERENCES marketplace_reviews(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(review_id, user_id)
);

CREATE INDEX idx_rh_review ON review_helpfuls(review_id);
CREATE INDEX idx_rh_user ON review_helpfuls(user_id);

ALTER TABLE review_helpfuls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads helpfuls" ON review_helpfuls
  FOR SELECT USING (true);

CREATE POLICY "Users manage own helpfuls" ON review_helpfuls
  FOR ALL USING (auth.uid() = user_id);

-- ─── 3. Add rating columns to marketplace_listings ─────────

ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

-- ─── 4. Trigger: auto-update avg_rating & review_count ─────

CREATE OR REPLACE FUNCTION update_listing_review_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_id UUID;
BEGIN
  -- Determine the affected listing_id
  IF TG_OP = 'DELETE' THEN
    v_listing_id := OLD.listing_id;
  ELSE
    v_listing_id := NEW.listing_id;
  END IF;

  -- Recompute stats
  UPDATE marketplace_listings
  SET
    avg_rating = COALESCE((
      SELECT ROUND(AVG(rating)::NUMERIC, 2)
      FROM marketplace_reviews
      WHERE listing_id = v_listing_id
    ), 0),
    review_count = (
      SELECT COUNT(*)
      FROM marketplace_reviews
      WHERE listing_id = v_listing_id
    ),
    updated_at = NOW()
  WHERE id = v_listing_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_listing_review_stats
  AFTER INSERT OR UPDATE OR DELETE ON marketplace_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_review_stats();

-- ─── 5. RPC: submit_review (upsert) ────────────────────────

CREATE OR REPLACE FUNCTION submit_review(
  p_listing_id UUID,
  p_rating INTEGER,
  p_title TEXT DEFAULT NULL,
  p_body TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_review_id UUID;
  v_has_acquired BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate rating
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- Check that user is not the owner and has acquired the deck
  IF EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE id = p_listing_id AND owner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Cannot review your own listing';
  END IF;

  -- Check user has acquired the deck (via deck_shares)
  SELECT EXISTS (
    SELECT 1 FROM deck_shares ds
    JOIN marketplace_listings ml ON ml.deck_id = ds.deck_id
    WHERE ml.id = p_listing_id
      AND ds.recipient_id = v_user_id
      AND ds.status = 'active'
  ) INTO v_has_acquired;

  IF NOT v_has_acquired THEN
    RAISE EXCEPTION 'Must acquire deck before reviewing';
  END IF;

  -- Upsert review
  INSERT INTO marketplace_reviews (listing_id, user_id, rating, title, body)
  VALUES (p_listing_id, v_user_id, p_rating, p_title, p_body)
  ON CONFLICT (listing_id, user_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    is_edited = true,
    updated_at = NOW()
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$$;

-- ─── 6. RPC: delete_review (own reviews only) ──────────────

CREATE OR REPLACE FUNCTION delete_review(p_review_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM marketplace_reviews
  WHERE id = p_review_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found or not owned by user';
  END IF;
END;
$$;

-- ─── 7. RPC: mark_review_helpful ────────────────────────────

CREATE OR REPLACE FUNCTION mark_review_helpful(p_review_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Cannot mark own review as helpful
  IF EXISTS (
    SELECT 1 FROM marketplace_reviews
    WHERE id = p_review_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Cannot mark own review as helpful';
  END IF;

  -- Insert helpful vote (unique constraint prevents duplicates)
  INSERT INTO review_helpfuls (review_id, user_id)
  VALUES (p_review_id, v_user_id)
  ON CONFLICT (review_id, user_id) DO NOTHING;

  -- Update helpful_count on the review
  UPDATE marketplace_reviews
  SET helpful_count = (
    SELECT COUNT(*) FROM review_helpfuls WHERE review_id = p_review_id
  )
  WHERE id = p_review_id;
END;
$$;

-- ─── 8. RPC: get_review_stats (rating distribution) ────────

CREATE OR REPLACE FUNCTION get_review_stats(p_listing_id UUID)
RETURNS TABLE (
  avg_rating NUMERIC,
  review_count BIGINT,
  rating_1 BIGINT,
  rating_2 BIGINT,
  rating_3 BIGINT,
  rating_4 BIGINT,
  rating_5 BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(ROUND(AVG(r.rating)::NUMERIC, 2), 0) AS avg_rating,
    COUNT(*) AS review_count,
    COUNT(*) FILTER (WHERE r.rating = 1) AS rating_1,
    COUNT(*) FILTER (WHERE r.rating = 2) AS rating_2,
    COUNT(*) FILTER (WHERE r.rating = 3) AS rating_3,
    COUNT(*) FILTER (WHERE r.rating = 4) AS rating_4,
    COUNT(*) FILTER (WHERE r.rating = 5) AS rating_5
  FROM marketplace_reviews r
  WHERE r.listing_id = p_listing_id;
END;
$$;
