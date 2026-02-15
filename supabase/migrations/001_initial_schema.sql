-- ========================================
-- ReeeCall Study - Initial Schema v2.0
-- ========================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 1. Profiles
-- ========================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  daily_new_limit INTEGER NOT NULL DEFAULT 20,
  default_study_mode TEXT NOT NULL DEFAULT 'srs'
    CHECK (default_study_mode IN ('srs', 'sequential_review', 'random', 'sequential')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  theme TEXT NOT NULL DEFAULT 'system',
  tts_enabled BOOLEAN NOT NULL DEFAULT true,
  tts_lang TEXT NOT NULL DEFAULT 'zh-CN',
  tts_provider TEXT NOT NULL DEFAULT 'web_speech'
    CHECK (tts_provider IN ('web_speech', 'edge_tts')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auth 회원가입 시 자동 프로필 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ========================================
-- 2. Card Templates
-- ========================================
CREATE TABLE card_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]',
  front_layout JSONB NOT NULL DEFAULT '[]',
  back_layout JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE card_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own templates" ON card_templates
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_templates_user ON card_templates(user_id);

-- 신규 사용자에게 기본 템플릿 자동 생성
CREATE OR REPLACE FUNCTION create_default_templates()
RETURNS TRIGGER AS $$
BEGIN
  -- 기본 (앞/뒤) 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"}]',
    true
  );

  -- 중국어 단어 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]',
    true
  );

  -- 영어 단어 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]',
    true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created_templates
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_templates();

-- ========================================
-- 3. Decks
-- ========================================
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_template_id UUID REFERENCES card_templates ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  icon TEXT NOT NULL DEFAULT '📚',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  next_position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own decks" ON decks FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_decks_user ON decks(user_id);

-- ========================================
-- 4. Cards
-- ========================================
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES card_templates ON DELETE RESTRICT,
  field_values JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  sort_position INTEGER NOT NULL DEFAULT 0,
  srs_status TEXT NOT NULL DEFAULT 'new'
    CHECK (srs_status IN ('new', 'learning', 'review', 'suspended')),
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  next_review_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own cards" ON cards FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_user ON cards(user_id);
CREATE INDEX idx_cards_review ON cards(user_id, next_review_at)
  WHERE srs_status IN ('learning', 'review');
CREATE INDEX idx_cards_position ON cards(deck_id, sort_position);
CREATE INDEX idx_cards_created ON cards(deck_id, created_at);
CREATE INDEX idx_cards_status ON cards(deck_id, srs_status);

-- ========================================
-- 5. Deck Study State
-- ========================================
CREATE TABLE deck_study_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  new_start_pos INTEGER NOT NULL DEFAULT 0,
  review_start_pos INTEGER NOT NULL DEFAULT 0,
  new_batch_size INTEGER NOT NULL DEFAULT 100,
  review_batch_size INTEGER NOT NULL DEFAULT 150,
  sequential_pos INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, deck_id)
);

ALTER TABLE deck_study_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own study state" ON deck_study_state
  FOR ALL USING (auth.uid() = user_id);

-- ========================================
-- 6. Study Logs
-- ========================================
CREATE TABLE study_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  study_mode TEXT NOT NULL
    CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential')),
  rating TEXT NOT NULL
    CHECK (rating IN ('again', 'hard', 'good', 'easy', 'known', 'unknown', 'viewed')),
  prev_interval INTEGER,
  new_interval INTEGER,
  prev_ease REAL,
  new_ease REAL,
  review_duration_ms INTEGER,
  studied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE study_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own logs" ON study_logs FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_logs_user_date ON study_logs(user_id, studied_at);
CREATE INDEX idx_logs_card ON study_logs(card_id);
CREATE INDEX idx_logs_deck_date ON study_logs(deck_id, studied_at);
CREATE INDEX idx_logs_mode ON study_logs(user_id, study_mode, studied_at);

-- ========================================
-- 7. updated_at 자동 갱신 트리거
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON card_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON decks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deck_study_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 8. RPC: 덱 통계 함수
-- ========================================
CREATE OR REPLACE FUNCTION get_deck_stats(p_user_id UUID)
RETURNS TABLE (
  deck_id UUID,
  deck_name TEXT,
  total_cards BIGINT,
  new_cards BIGINT,
  review_cards BIGINT,
  learning_cards BIGINT,
  last_studied TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'new'),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'review' AND c.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'learning' AND c.next_review_at <= NOW()),
    MAX(sl.studied_at)
  FROM decks d
  LEFT JOIN cards c ON c.deck_id = d.id
  LEFT JOIN study_logs sl ON sl.card_id = c.id
  WHERE d.user_id = p_user_id AND d.is_archived = false
  GROUP BY d.id, d.name
  ORDER BY d.sort_order, d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 9. RPC: 업로드 일자별 카드 수
-- ========================================
CREATE OR REPLACE FUNCTION get_upload_dates(p_deck_id UUID, p_timezone TEXT DEFAULT 'Asia/Seoul')
RETURNS TABLE (
  upload_date DATE,
  card_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(c.created_at AT TIME ZONE p_timezone),
    COUNT(*)
  FROM cards c
  WHERE c.deck_id = p_deck_id
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 10. Storage 버킷
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('card-images', 'card-images', true),
  ('card-audio', 'card-audio', true);
