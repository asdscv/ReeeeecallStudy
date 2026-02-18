CREATE TABLE IF NOT EXISTS contents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 TEXT NOT NULL,
  locale               TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ko')),
  title                TEXT NOT NULL,
  subtitle             TEXT,
  thumbnail_url        TEXT,
  content_blocks       JSONB NOT NULL DEFAULT '[]',
  reading_time_minutes INTEGER NOT NULL DEFAULT 5,
  tags                 TEXT[] DEFAULT '{}',

  -- SEO
  meta_title           TEXT,
  meta_description     TEXT,
  og_image_url         TEXT,
  canonical_url        TEXT,

  -- Publishing
  author_name          TEXT DEFAULT 'ReeeCall',
  is_published         BOOLEAN NOT NULL DEFAULT false,
  published_at         TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 같은 slug를 en/ko 각각 가능 (hreflang 쌍)
CREATE UNIQUE INDEX idx_contents_slug_locale ON contents (slug, locale);
-- 목록 쿼리 (published, locale별, 최신순)
CREATE INDEX idx_contents_published ON contents (is_published, locale, published_at DESC) WHERE is_published = true;
-- 커서 기반 페이지네이션
CREATE INDEX idx_contents_cursor ON contents (published_at DESC, id DESC) WHERE is_published = true;
-- 태그 필터
CREATE INDEX idx_contents_tags ON contents USING GIN (tags);

ALTER TABLE contents ENABLE ROW LEVEL SECURITY;

-- Public read (인증 불요)
CREATE POLICY "Anyone can read published contents"
  ON contents FOR SELECT USING (is_published = true);

-- updated_at 자동 갱신 (기존 trigger function 재사용)
CREATE TRIGGER set_contents_updated_at
  BEFORE UPDATE ON contents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
