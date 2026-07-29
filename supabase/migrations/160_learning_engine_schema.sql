-- ============================================================================
-- 160: MODULAR LEARNING ENGINE — Schema Foundation (expand-only)
--
-- Tables: learning_goals, content_sources, learning_concepts, learning_activities,
--         learning_goal_decks, learning_goal_concepts, answer_attempts,
--         daily_plans, daily_plan_items, study_recommendations, user_enrichments
--
-- Design: DOCS/TODO/2026-07-29-modular-learning-engine-design.md §7, §21
-- Architecture: DOCS/STANDARD/ARCHITECTURE.md §2
--
-- Principles:
--   * Expand-only — no existing table/column/function is modified.
--   * UUID PKs, timestamptz audit columns.
--   * Reuse existing update_updated_at() trigger.
--   * RLS enabled, owner-scoped SELECTs, shared-content SELECTs where applicable.
--   * Direct INSERT/UPDATE/DELETE revoked from anon + authenticated.
--   * All writes go through SECURITY DEFINER RPCs (migs 161–163).
--   * service_role retains full DML for import/maintenance.
--   * Closed SQL enums only for stable lifecycle states.
--   * Extensible type strings (activity/media/evaluator/action) use CHECK <> ''.
-- ============================================================================

-- ── 1) learning_goals ───────────────────────────────────────────────────────
CREATE TABLE learning_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  domain_id     text NOT NULL CHECK (domain_id <> ''),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  target_date   date,
  daily_minutes integer NOT NULL CHECK (daily_minutes BETWEEN 1 AND 1440),
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','completed','archived')),
  target        jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON learning_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE learning_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own goals"
  ON learning_goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_learning_goals_user_status ON learning_goals(user_id, status);

-- ── 2) content_sources ──────────────────────────────────────────────────────
CREATE TABLE content_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid REFERENCES auth.users ON DELETE CASCADE,
  domain_id      text NOT NULL CHECK (domain_id <> ''),
  source_type    text NOT NULL CHECK (source_type <> ''),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  source_uri     text,
  citation       text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON content_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

-- Owner reads their own sources
CREATE POLICY "Owner can read own sources"
  ON content_sources FOR SELECT
  USING (auth.uid() = owner_user_id);

-- Shared/curated sources (owner_user_id IS NULL) readable by all authenticated
CREATE POLICY "Authenticated can read shared sources"
  ON content_sources FOR SELECT
  USING (owner_user_id IS NULL);

CREATE INDEX idx_content_sources_owner ON content_sources(owner_user_id);
CREATE INDEX idx_content_sources_domain ON content_sources(domain_id);

-- ── 3) learning_concepts ────────────────────────────────────────────────────
CREATE TABLE learning_concepts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid REFERENCES auth.users ON DELETE CASCADE,
  domain_id      text NOT NULL CHECK (domain_id <> ''),
  concept_key    text NOT NULL CHECK (concept_key <> ''),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description    text,
  source_id      uuid REFERENCES content_sources(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON learning_concepts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE learning_concepts ENABLE ROW LEVEL SECURITY;

-- Owner reads their private concepts
CREATE POLICY "Owner can read own concepts"
  ON learning_concepts FOR SELECT
  USING (auth.uid() = owner_user_id);

-- Shared/curated concepts readable by authenticated
CREATE POLICY "Authenticated can read shared concepts"
  ON learning_concepts FOR SELECT
  USING (owner_user_id IS NULL);

-- Partial unique: one concept_key per owner+domain scope
CREATE UNIQUE INDEX idx_learning_concepts_private_key
  ON learning_concepts(owner_user_id, domain_id, concept_key)
  WHERE owner_user_id IS NOT NULL;

-- Partial unique: one concept_key per shared domain scope
CREATE UNIQUE INDEX idx_learning_concepts_shared_key
  ON learning_concepts(domain_id, concept_key)
  WHERE owner_user_id IS NULL;

CREATE INDEX idx_learning_concepts_domain ON learning_concepts(domain_id);

-- ── 4) learning_activities ──────────────────────────────────────────────────
CREATE TABLE learning_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid REFERENCES auth.users ON DELETE CASCADE,
  concept_id       uuid REFERENCES learning_concepts(id) ON DELETE SET NULL,
  card_id          uuid REFERENCES cards(id) ON DELETE SET NULL,
  source_id        uuid REFERENCES content_sources(id) ON DELETE SET NULL,
  activity_type    text NOT NULL CHECK (activity_type <> ''),
  stimulus_type    text NOT NULL CHECK (stimulus_type <> ''),
  response_type    text NOT NULL CHECK (response_type <> ''),
  evaluator_type   text NOT NULL CHECK (evaluator_type <> ''),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  instructions     text,
  stimulus         jsonb,
  expected_response jsonb,
  rubric           jsonb,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty       numeric CHECK (difficulty IS NULL OR (difficulty >= 0 AND difficulty <= 1)),
  content_version  integer NOT NULL DEFAULT 1 CHECK (content_version > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- At least one of card_id or a non-empty JSON object stimulus must exist
  CONSTRAINT activity_card_or_stimulus_required
    CHECK (
      card_id IS NOT NULL
      OR (jsonb_typeof(stimulus) = 'object' AND stimulus <> '{}'::jsonb)
    )
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON learning_activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE learning_activities ENABLE ROW LEVEL SECURITY;

-- Owner reads own activities
CREATE POLICY "Owner can read own activities"
  ON learning_activities FOR SELECT
  USING (auth.uid() = owner_user_id);

-- Shared/curated activities readable by authenticated
CREATE POLICY "Authenticated can read shared activities"
  ON learning_activities FOR SELECT
  USING (owner_user_id IS NULL);

CREATE INDEX idx_learning_activities_owner ON learning_activities(owner_user_id);
CREATE INDEX idx_learning_activities_concept ON learning_activities(concept_id);
CREATE INDEX idx_learning_activities_card ON learning_activities(card_id);

-- ── 5) learning_goal_decks (join) ───────────────────────────────────────────
CREATE TABLE learning_goal_decks (
  goal_id    uuid NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
  deck_id    uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  importance numeric NOT NULL DEFAULT 0.5
               CHECK (importance >= 0 AND importance <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, deck_id)
);

ALTER TABLE learning_goal_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own goal decks"
  ON learning_goal_decks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM learning_goals g WHERE g.id = goal_id AND g.user_id = auth.uid()
  ));

-- ── 6) learning_goal_concepts (join) ────────────────────────────────────────
CREATE TABLE learning_goal_concepts (
  goal_id    uuid NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES learning_concepts(id) ON DELETE CASCADE,
  importance numeric NOT NULL DEFAULT 0.5
               CHECK (importance >= 0 AND importance <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, concept_id)
);

ALTER TABLE learning_goal_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own goal concepts"
  ON learning_goal_concepts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM learning_goals g WHERE g.id = goal_id AND g.user_id = auth.uid()
  ));

-- ── 7) answer_attempts ──────────────────────────────────────────────────────
CREATE TABLE answer_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id           uuid REFERENCES learning_goals(id) ON DELETE SET NULL,
  activity_id       uuid REFERENCES learning_activities(id) ON DELETE SET NULL,
  card_id           uuid REFERENCES cards(id) ON DELETE SET NULL,
  plan_item_id      uuid, -- FK added after daily_plan_items creation
  client_attempt_id uuid NOT NULL,
  activity_type     text NOT NULL CHECK (activity_type <> ''),
  response_type     text NOT NULL CHECK (response_type <> ''),
  evaluator_type    text NOT NULL CHECK (evaluator_type <> ''),
  response          jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_score  numeric CHECK (normalized_score IS NULL OR (normalized_score >= 0 AND normalized_score <= 1)),
  evaluator_result  jsonb,
  feedback          jsonb,
  hints_used        integer NOT NULL DEFAULT 0 CHECK (hints_used >= 0),
  duration_ms       integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  evaluator_version text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- At least one of activity_id or card_id must be present
  CONSTRAINT attempt_activity_or_card_required
    CHECK (activity_id IS NOT NULL OR card_id IS NOT NULL)
);

ALTER TABLE answer_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own attempts"
  ON answer_attempts FOR SELECT
  USING (auth.uid() = user_id);

-- Client idempotency: unique per user
CREATE UNIQUE INDEX idx_answer_attempts_client_id
  ON answer_attempts(user_id, client_attempt_id);

CREATE INDEX idx_answer_attempts_user_created ON answer_attempts(user_id, created_at DESC);
CREATE INDEX idx_answer_attempts_activity ON answer_attempts(activity_id);
CREATE INDEX idx_answer_attempts_card ON answer_attempts(card_id);
CREATE INDEX idx_answer_attempts_goal ON answer_attempts(goal_id);

-- ── 8) daily_plans ──────────────────────────────────────────────────────────
CREATE TABLE daily_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id            uuid NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
  plan_date          date NOT NULL,
  timezone           text NOT NULL CHECK (timezone <> ''),
  algorithm_version  text NOT NULL CHECK (algorithm_version <> ''),
  input_fingerprint  text NOT NULL CHECK (input_fingerprint <> ''),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','completed','abandoned')),
  budget_minutes     integer NOT NULL CHECK (budget_minutes BETWEEN 1 AND 1440),
  completed_minutes  integer NOT NULL DEFAULT 0 CHECK (completed_minutes >= 0),
  completed_items    integer NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  total_items        integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON daily_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own plans"
  ON daily_plans FOR SELECT
  USING (auth.uid() = user_id);

-- §21.5: plan requires a goal, unique per user+goal+date
CREATE UNIQUE INDEX idx_daily_plans_user_goal_date
  ON daily_plans(user_id, goal_id, plan_date);

CREATE INDEX idx_daily_plans_user_date ON daily_plans(user_id, plan_date DESC);

-- ── 9) daily_plan_items ─────────────────────────────────────────────────────
CREATE TABLE daily_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  position         integer NOT NULL CHECK (position >= 0),
  activity_id      uuid REFERENCES learning_activities(id) ON DELETE SET NULL,
  card_id          uuid REFERENCES cards(id) ON DELETE SET NULL,
  concept_id       uuid REFERENCES learning_concepts(id) ON DELETE SET NULL,
  activity_type    text NOT NULL CHECK (activity_type <> ''),
  stimulus_type    text NOT NULL CHECK (stimulus_type <> ''),
  response_type    text NOT NULL CHECK (response_type <> ''),
  evaluator_type   text NOT NULL CHECK (evaluator_type <> ''),
  reason_code      text,
  priority         numeric NOT NULL DEFAULT 0,
  estimated_minutes numeric NOT NULL DEFAULT 1 CHECK (estimated_minutes > 0),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','completed','skipped')),
  completion_attempt_id uuid REFERENCES answer_attempts(id) ON DELETE SET NULL,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON daily_plan_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE daily_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own plan items"
  ON daily_plan_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM daily_plans p WHERE p.id = plan_id AND p.user_id = auth.uid()
  ));

-- Unique position within a plan
CREATE UNIQUE INDEX idx_daily_plan_items_plan_position
  ON daily_plan_items(plan_id, position);

CREATE INDEX idx_daily_plan_items_plan ON daily_plan_items(plan_id);

-- ── Now add the deferred FK from answer_attempts to daily_plan_items ────────
ALTER TABLE answer_attempts
  ADD CONSTRAINT fk_answer_attempts_plan_item
  FOREIGN KEY (plan_item_id) REFERENCES daily_plan_items(id) ON DELETE SET NULL;

-- ── 10) study_recommendations ───────────────────────────────────────────────
CREATE TABLE study_recommendations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id           uuid REFERENCES learning_goals(id) ON DELETE SET NULL,
  concept_id        uuid REFERENCES learning_concepts(id) ON DELETE SET NULL,
  card_id           uuid REFERENCES cards(id) ON DELETE SET NULL,
  activity_id       uuid REFERENCES learning_activities(id) ON DELETE SET NULL,
  action_type       text NOT NULL CHECK (action_type <> ''),
  provider          text NOT NULL CHECK (provider <> ''),
  reason            text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version text,
  model_version     text,
  prompt_version    text,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','dismissed','expired')),
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON study_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE study_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own recommendations"
  ON study_recommendations FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_study_recommendations_user_status
  ON study_recommendations(user_id, status);
CREATE INDEX idx_study_recommendations_goal
  ON study_recommendations(goal_id);

-- ── 11) user_enrichments ────────────────────────────────────────────────────
CREATE TABLE user_enrichments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  goal_id           uuid REFERENCES learning_goals(id) ON DELETE SET NULL,
  concept_id        uuid REFERENCES learning_concepts(id) ON DELETE SET NULL,
  card_id           uuid REFERENCES cards(id) ON DELETE SET NULL,
  activity_id       uuid REFERENCES learning_activities(id) ON DELETE SET NULL,
  action            text NOT NULL CHECK (action <> ''),
  request_fingerprint text,
  content           jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_references jsonb,
  model_version     text,
  provider          text,
  prompt_version    text,
  status            text NOT NULL DEFAULT 'preview'
                      CHECK (status IN ('preview','accepted','rejected','deleted')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_enrichments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE user_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own enrichments"
  ON user_enrichments FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_enrichments_user_status
  ON user_enrichments(user_id, status);
CREATE INDEX idx_user_enrichments_card
  ON user_enrichments(card_id);
CREATE INDEX idx_user_enrichments_concept
  ON user_enrichments(concept_id);

-- ============================================================================
-- REVOKE direct writes from anon and authenticated on all new tables.
-- Writes will go through SECURITY DEFINER RPCs (migs 161–163).
-- service_role retains full access for import/maintenance.
-- ============================================================================

REVOKE ALL ON learning_goals FROM anon, authenticated;
REVOKE ALL ON content_sources FROM anon, authenticated;
REVOKE ALL ON learning_concepts FROM anon, authenticated;
REVOKE ALL ON learning_activities FROM anon, authenticated;
REVOKE ALL ON learning_goal_decks FROM anon, authenticated;
REVOKE ALL ON learning_goal_concepts FROM anon, authenticated;
REVOKE ALL ON answer_attempts FROM anon, authenticated;
REVOKE ALL ON daily_plans FROM anon, authenticated;
REVOKE ALL ON daily_plan_items FROM anon, authenticated;
REVOKE ALL ON study_recommendations FROM anon, authenticated;
REVOKE ALL ON user_enrichments FROM anon, authenticated;

-- Explicit SELECT grant for authenticated (RLS will still filter rows)
GRANT SELECT ON learning_goals TO authenticated;
GRANT SELECT ON content_sources TO authenticated;
GRANT SELECT ON learning_concepts TO authenticated;
GRANT SELECT ON learning_activities TO authenticated;
GRANT SELECT ON learning_goal_decks TO authenticated;
GRANT SELECT ON learning_goal_concepts TO authenticated;
GRANT SELECT ON answer_attempts TO authenticated;
GRANT SELECT ON daily_plans TO authenticated;
GRANT SELECT ON daily_plan_items TO authenticated;
GRANT SELECT ON study_recommendations TO authenticated;
GRANT SELECT ON user_enrichments TO authenticated;

-- service_role full DML for administrative operations
GRANT ALL ON learning_goals TO service_role;
GRANT ALL ON content_sources TO service_role;
GRANT ALL ON learning_concepts TO service_role;
GRANT ALL ON learning_activities TO service_role;
GRANT ALL ON learning_goal_decks TO service_role;
GRANT ALL ON learning_goal_concepts TO service_role;
GRANT ALL ON answer_attempts TO service_role;
GRANT ALL ON daily_plans TO service_role;
GRANT ALL ON daily_plan_items TO service_role;
GRANT ALL ON study_recommendations TO service_role;
GRANT ALL ON user_enrichments TO service_role;
