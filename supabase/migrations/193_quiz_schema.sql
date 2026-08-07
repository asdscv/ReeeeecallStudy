-- ============================================================================
-- 193: Quiz — the schema for an assessment feature that stands on its own
--
-- ── Why quiz is not a study mode ────────────────────────────────────────────
--
-- Card study is six ordering strategies over one interaction: show, flip, self-rate.
-- `StudyMode` in packages/shared/types/database.ts is a list of orderings, not of
-- interactions, and there is no answer-input mode anywhere in the app. Quiz is a
-- different act — the learner produces an answer and something else judges it — so
-- it gets its own menu, its own tables, and its own money.
--
-- ── Why not `learning_activities` ───────────────────────────────────────────
--
-- That table was built for this shape and is empty (0 rows, no writer). It cannot be
-- used, and the reason is not taste. Measured on production:
--
--     grantee        privilege
--     authenticated  SELECT
--
--     policy                                    qual
--     "Owner can read own activities"           auth.uid() = owner_user_id
--     "Authenticated can read shared activities" owner_user_id IS NULL
--
-- `expected_response` and `rubric` are columns on that table. Putting a quiz answer
-- key there hands it to the client that is about to be asked the question — the
-- owner reads their own row, and anything with a NULL owner is readable by every
-- signed-in user on the platform. An answer key has to live somewhere the learner
-- cannot SELECT, which is why `quiz_questions` below has RLS on and NO grant.
--
-- ── The card contract ───────────────────────────────────────────────────────
--
-- A question is derived from exactly one card, and the card supplies the answer.
-- The app knows no subject facts; it knows what the learner wrote on the back of a
-- card. That is the whole basis on which AI is allowed to grade here: the judgement
-- is "does this mean the same as the card's answer", never "is this true".
--
-- Which field IS the answer is already declared. `LayoutItem.style` is a closed
-- type — 'primary' | 'secondary' | 'hint' | 'detail' | 'media' — and the seeded
-- templates, buildPresetTemplate, and the AI template prompt all populate it. So
-- `reference_answer` is the ONE primary text field, resolved server-side.
--
-- It is deliberately not `cardReferenceAnswer()` (card-answer.ts:103), which joins
-- every back-layout field with ' / ' and yields "빌려주다 / tuː lend / He lent me a
-- book." for a seeded card. Grading against that string would mark a correct
-- one-word answer wrong; building four choices from it would put the answer inside
-- the distractors and let a learner pick the longest option without knowing
-- anything. That function keeps its contract for its existing caller; quiz resolves
-- its own field.
--
-- Measured on production before this file was written — 377,031 cards, 672 decks:
--
--     eligible cards  376,544  (99.9%)     decks with 4+ eligible  652 (97%)
--     no front field       36              decks with 0 eligible    18
--     2+ primary          321
--     ambiguous back      130
--
-- ── Expand-only ─────────────────────────────────────────────────────────────
--
-- Four new tables. The only change to anything that already exists is one nullable
-- column on `answer_attempts` plus the widening of its target CHECK, and a one-line
-- predicate added to `undo_plan_study_rating`. No data is rewritten and no existing
-- reader changes meaning.
-- ============================================================================

BEGIN;

-- ── 1) quiz_sets — a generated bank of questions over one deck ──────────────
--
-- The set is the ASSET. Generation is what costs money; taking the quiz again does
-- not, because re-running a set spends nothing. That split is the whole pricing
-- model: pay to create, retake for free, pay again only when an answer is graded.
CREATE TABLE quiz_sets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  deck_id              uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  question_type        text NOT NULL CHECK (question_type IN ('mcq', 'short', 'essay')),
  scope_kind           text NOT NULL CHECK (scope_kind IN ('deck', 'tags', 'cards')),
  scope_tags           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(scope_tags) <= 20),
  scope_card_ids       uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(scope_card_ids) <= 50),
  requested_count      smallint NOT NULL CHECK (requested_count BETWEEN 1 AND 12),
  generated_count      smallint NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  status               text NOT NULL DEFAULT 'ready'
                         CHECK (status IN ('ready', 'stale', 'archived')),
  -- The UI language at generation time. A question stem is prose the model wrote, so
  -- a set is only re-takeable in the language it was made in. Without this recorded,
  -- a learner who switches locale meets Korean questions with no explanation.
  content_locale       text NOT NULL
                         CHECK (content_locale IN ('en','ko','ja','zh','vi','th','id','es')),
  generated_by_job_ref text REFERENCES ai_generation_jobs(id) ON DELETE SET NULL,
  model_version        text,
  prompt_version       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Exactly one scope shape is populated. Without this a row can claim 'deck' scope
  -- while carrying card ids, and the two readers of scope would disagree about which
  -- cards the set covers.
  CONSTRAINT quiz_set_scope_shape CHECK (
       (scope_kind = 'deck'  AND cardinality(scope_tags) = 0 AND cardinality(scope_card_ids) = 0)
    OR (scope_kind = 'tags'  AND cardinality(scope_tags) > 0 AND cardinality(scope_card_ids) = 0)
    OR (scope_kind = 'cards' AND cardinality(scope_card_ids) > 0 AND cardinality(scope_tags) = 0))
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quiz_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE quiz_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read own quiz sets" ON quiz_sets
  FOR SELECT USING (auth.uid() = owner_user_id);
CREATE INDEX idx_quiz_sets_owner ON quiz_sets(owner_user_id, status, created_at DESC);
CREATE INDEX idx_quiz_sets_deck ON quiz_sets(deck_id);

-- ── 2) quiz_questions — the answer key. No grant to authenticated. ──────────
--
-- RLS is on as defence in depth, but the load-bearing protection is the absent
-- GRANT: privileges are checked before policies, so `authenticated` cannot SELECT
-- this table at all. Questions reach a learner only through get_quiz_run_items(),
-- which returns the stem and the shuffled options and never the correct index.
CREATE TABLE quiz_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id             uuid NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  owner_user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- One question, one card. A multi-card essay would hold references that can be
  -- half-deleted, and grading against a partial reference is grading wrongly. With
  -- 1:1, deleting a card cascades the question away and there is nothing to reconcile.
  card_id            uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  question_type      text NOT NULL CHECK (question_type IN ('mcq', 'short', 'essay')),
  position           smallint NOT NULL CHECK (position >= 0),
  stem               text NOT NULL CHECK (char_length(stem) BETWEEN 1 AND 400),
  -- MCQ only: the canonical four choices AFTER the server has inserted the card's
  -- own primary answer. The model proposes distractors; it never states the answer.
  options            text[] CHECK (options IS NULL OR cardinality(options) = 4),
  correct_index      smallint CHECK (correct_index IS NULL OR correct_index BETWEEN 0 AND 3),
  -- The value of resolveQuizCardFaces().answerKey. Server-resolved, never model-authored.
  reference_answer   text NOT NULL CHECK (char_length(reference_answer) BETWEEN 1 AND 800),
  -- The remaining back-layout text fields. Passed to the grader as context only —
  -- a learner is not required to reproduce it, so it never affects the score.
  reference_context  text CHECK (reference_context IS NULL OR char_length(reference_context) <= 1200),
  -- Essay only: the criteria a grader applies, each with a weight and terms quoted out
  -- of the card's own text. Stored with the QUESTION, not recomputed at grading time —
  -- a learner must be graded against the rubric they were shown, even if the generator
  -- would produce a different one tomorrow.
  rubric             jsonb,
  -- Type-specific presentation extras that are not the answer: distractor flaws for
  -- multiple choice (which render the post-answer explanation), the retrieval angle for
  -- short answer, the length band for essay. Never consulted when scoring.
  meta               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- md5 over the card's prompt+answer field values at generation time. Answers the
  -- question `content_version` was created for and never wired up: has the source
  -- card changed since this question was written?
  source_fingerprint text NOT NULL CHECK (source_fingerprint <> ''),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_question_type_shape CHECK (
       (question_type =  'mcq' AND options IS NOT NULL AND correct_index IS NOT NULL)
    OR (question_type <> 'mcq' AND options IS NULL     AND correct_index IS NULL)),
  -- An essay with no rubric cannot be graded, and would reach the grader as an open
  -- request to judge prose — which is the one thing this design never asks a model to do.
  CONSTRAINT quiz_question_essay_has_rubric CHECK (
    question_type <> 'essay' OR (rubric IS NOT NULL AND jsonb_typeof(rubric) = 'array'
                                 AND jsonb_array_length(rubric) > 0)),
  CONSTRAINT quiz_question_position_unique UNIQUE (set_id, position)
);
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_quiz_questions_set ON quiz_questions(set_id, position);
CREATE INDEX idx_quiz_questions_card ON quiz_questions(card_id);

-- ── 3) quiz_runs — one sitting. A retake is a new row. ──────────────────────
CREATE TABLE quiz_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id         uuid NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  attempt_no     smallint NOT NULL CHECK (attempt_no >= 1),
  status         text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  -- 0 is allowed. Every question in a set can be cascaded away by card deletion, and
  -- an empty run has to be renderable ("the questions in this set are gone") rather
  -- than an impossible row the result screen crashes on.
  item_count     smallint NOT NULL CHECK (item_count BETWEEN 0 AND 12),
  answered_count smallint NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  score_raw      numeric(6,3) NOT NULL DEFAULT 0 CHECK (score_raw >= 0),
  score_max      numeric(6,3) NOT NULL DEFAULT 0 CHECK (score_max >= 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  CONSTRAINT quiz_run_attempt_unique UNIQUE (set_id, user_id, attempt_no),
  CONSTRAINT quiz_run_score_bounds CHECK (score_raw <= score_max)
);
ALTER TABLE quiz_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read own quiz runs" ON quiz_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX idx_quiz_runs_user ON quiz_runs(user_id, started_at DESC);
CREATE INDEX idx_quiz_runs_set ON quiz_runs(set_id);

-- ── 4) quiz_run_items — what this sitting presented ─────────────────────────
CREATE TABLE quiz_run_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES quiz_runs(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a run is a record of what the learner did, and deleting
  -- the source card should not silently shorten a completed quiz's history.
  question_id  uuid REFERENCES quiz_questions(id) ON DELETE SET NULL,
  position     smallint NOT NULL CHECK (position >= 0),
  -- A fresh permutation per sitting, so a retake cannot be passed from memory of
  -- where the answer sat. Server-only; this is why the table has no SELECT grant.
  option_order smallint[] CHECK (option_order IS NULL OR (
                 cardinality(option_order) = 4
                 AND option_order <@ ARRAY[0,1,2,3]::smallint[]
                 AND ARRAY[0,1,2,3]::smallint[] <@ option_order)),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'answered', 'graded', 'failed', 'void')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_run_item_position_unique UNIQUE (run_id, position)
);
ALTER TABLE quiz_run_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_quiz_run_items_run ON quiz_run_items(run_id, position);

-- When a question is deleted its run items keep the row but lose the pointer. Left
-- alone they would sit at 'pending' with nothing to render — a state no screen can
-- draw. This marks them void in the same statement.
--
-- STATEMENT-level on purpose: decks average 561 cards, and deleting one would
-- otherwise fire this once per cascaded question.
CREATE OR REPLACE FUNCTION public._quiz_void_orphan_items()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  UPDATE quiz_run_items
     SET status = 'void'
   WHERE question_id IS NULL
     AND status IN ('pending', 'answered');
  RETURN NULL;
END;
$$;

CREATE TRIGGER quiz_run_items_void_orphans
  AFTER DELETE ON quiz_questions
  FOR EACH STATEMENT EXECUTE FUNCTION public._quiz_void_orphan_items();

-- ── 5) answer_attempts gains a quiz target ──────────────────────────────────
--
-- Reused rather than duplicated: response, normalized_score, evaluator_type,
-- evaluator_result, feedback, hints_used and duration_ms are already exactly what a
-- graded answer needs. A parallel table would be the same columns under new names.
ALTER TABLE answer_attempts
  ADD COLUMN IF NOT EXISTS quiz_run_item_id uuid
    REFERENCES quiz_run_items(id) ON DELETE CASCADE;

ALTER TABLE answer_attempts DROP CONSTRAINT attempt_activity_or_card_required;
ALTER TABLE answer_attempts ADD CONSTRAINT attempt_target_required
  CHECK (activity_id IS NOT NULL OR card_id IS NOT NULL OR quiz_run_item_id IS NOT NULL);

-- One attempt per presented item. A retake is a new run with new items, so this does
-- not stop a learner re-answering — it stops a double-submit being graded twice, and
-- grading is the charged operation.
CREATE UNIQUE INDEX idx_answer_attempts_quiz_run_item
  ON answer_attempts(quiz_run_item_id) WHERE quiz_run_item_id IS NOT NULL;

-- ── 6) Close 189 against quiz attempts ──────────────────────────────────────
--
-- `undo_plan_study_rating` finds its row by (user_id, client_attempt_id) alone and
-- DELETEs it. That is right for a self-rated card — the 5-second 되돌리기 should
-- leave no trace. It is wrong for a quiz attempt, which was paid for: a caller that
-- produced a valid rating event could delete an AI-graded answer and the money spent
-- on it. Quiz attempts carry a server-issued client_attempt_id so the path is narrow,
-- but one predicate closes it structurally instead of relying on that.
--
-- Body reproduced verbatim from 189 apart from that line, so this file is the whole
-- current definition rather than a diff to chase.
CREATE OR REPLACE FUNCTION public.undo_plan_study_rating(
  p_event_id          uuid,
  p_client_attempt_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_undo      jsonb;
  v_attempt   answer_attempts%ROWTYPE;
  v_item      daily_plan_items%ROWTYPE;
  v_reopened  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_event_id IS NULL OR p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'event and client attempt ids are required' USING errcode = '22023';
  END IF;

  -- Schedule half first. It owns every reason an undo can be refused, and a refusal
  -- must leave the plan exactly as it was rather than half-unwound.
  v_undo := public.undo_study_rating(p_event_id);

  SELECT * INTO v_attempt
    FROM answer_attempts
   WHERE user_id = v_uid AND client_attempt_id = p_client_attempt_id
     AND quiz_run_item_id IS NULL   -- a quiz answer is not a plan rating to retract
   FOR UPDATE;

  -- Already undone, or the rating never had a plan half. Both are fine: the caller
  -- retries undos, and `apply_plan_study_rating` is not the only writer of ratings.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', false);
  END IF;

  IF v_attempt.plan_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM daily_plan_items WHERE id = v_attempt.plan_item_id FOR UPDATE;

    -- Only unwind the item THIS attempt completed. If something else completed it
    -- since, decrementing the day's count would take away someone else's work.
    IF FOUND AND v_item.status = 'completed' AND v_item.completion_attempt_id = v_attempt.id THEN
      UPDATE daily_plan_items
         SET status = 'pending', completion_attempt_id = NULL
       WHERE id = v_item.id;

      -- The exact inverse of record_answer_attempt's aggregate update, floored at 0
      -- so a stray double-undo cannot drive a count negative.
      UPDATE daily_plans
         SET completed_items = GREATEST(0, completed_items - 1),
             completed_minutes = GREATEST(0, completed_minutes - COALESCE(v_attempt.duration_ms / 60000, 0)),
             status = CASE
               WHEN GREATEST(0, completed_items - 1) = 0 THEN 'pending'
               WHEN status = 'completed' THEN 'active'
               ELSE status
             END
       WHERE id = v_item.plan_id;

      v_reopened := true;
    END IF;
  END IF;

  -- Mirrors undo_study_rating deleting its study_logs row: the retracted answer
  -- leaves no record that could later be quoted back at the learner or paid to
  -- have explained.
  DELETE FROM answer_attempts WHERE id = v_attempt.id;

  RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', v_reopened);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) TO authenticated;

-- ── 7) Grants ───────────────────────────────────────────────────────────────
--
-- quiz_questions and quiz_run_items get NOTHING. They hold the correct index and the
-- option permutation; a learner who can read either can pass any quiz. Every read
-- path for them is a SECURITY DEFINER function in 195 that projects the safe columns.
REVOKE ALL ON quiz_sets, quiz_questions, quiz_runs, quiz_run_items FROM anon, authenticated;
GRANT SELECT ON quiz_sets, quiz_runs TO authenticated;
GRANT ALL ON quiz_sets, quiz_questions, quiz_runs, quiz_run_items TO service_role;

COMMENT ON TABLE quiz_sets IS
  'A generated bank of questions over one deck. The set is the paid asset; retaking it costs nothing.';
COMMENT ON TABLE quiz_questions IS
  'Question text and answer key. Deliberately has no grant to authenticated — learning_activities was rejected for quiz precisely because it grants SELECT and exposes rows with a NULL owner to every signed-in user.';
COMMENT ON COLUMN quiz_questions.reference_answer IS
  'The single primary back-layout text field, resolved server-side. NOT cardReferenceAnswer(), which joins every back field with " / " and would put the answer inside its own distractors.';
COMMENT ON TABLE quiz_run_items IS
  'One presented question in one sitting. Holds option_order, the per-sitting shuffle, which is why this table is unreadable by clients.';

COMMIT;
