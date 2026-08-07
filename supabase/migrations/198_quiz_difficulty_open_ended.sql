-- ============================================================================
-- 198: difficulty bands that actually scale past three
--
-- 197 made bands rows rather than an enum, which was the right shape and not enough.
-- Audited against "make it five, or ten, or a hundred later", five things still
-- required a deploy or a translator:
--
--   1. `level` was CHECK (BETWEEN 1 AND 9). Ten was impossible.
--   2. `near_required` was the only axis. With three distractors that is FOUR
--      distinguishable bands, so ten was not merely unimplemented — it was
--      unexpressible.
--   3. Labels were `t('difficulty.' || level)`. A hundred bands meant a hundred keys
--      in sixteen files before the first one could be shown.
--   4. The default band, `3`, was hardcoded in the column default, in the RPC, in the
--      store and in two screens. Changing which band is offered first meant a release.
--   5. There was no way to add, retune or retire a band except by hand-writing SQL
--      against production.
--
-- ── The axes ────────────────────────────────────────────────────────────────
--
-- Difficulty is now three numbers and a list, all data:
--
--   near_required   how many wrong options are near-misses (the 197 axis)
--   option_count    how many options the question has — more options, harder
--   allowed_flaws   restrict which flaws may be used; empty means all of them
--
-- Together these span far more bands than anyone will define, and adding a fourth
-- knob later is a column plus a line in the prompt builder — not a redesign.
--
-- ── Labels, without a hundred translations ─────────────────────────────────
--
-- A band renders `t('difficulty.' || level)` and falls back to `t('difficulty.generic',
-- { level })` — "Level 7" — when that key does not exist. So a new band is usable the
-- moment it is inserted, and naming it properly is an improvement rather than a
-- prerequisite. The three seeded bands keep their hand-written names.
-- ============================================================================

BEGIN;

-- ── 1) Off the ceiling, and onto more axes ──────────────────────────────────
ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_levels_level_check;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_levels_level_check CHECK (level > 0);

ALTER TABLE public.quiz_difficulty_levels
  -- 4 is what every band used implicitly. Capped at 6 because a phone cannot show more
  -- without scrolling the options away from the question.
  ADD COLUMN IF NOT EXISTS option_count  smallint NOT NULL DEFAULT 4
    CHECK (option_count BETWEEN 2 AND 6),
  -- Empty = every flaw is allowed. A band that wants only look-alikes sets
  -- {plausible_form}; the near/far split still applies on top.
  ADD COLUMN IF NOT EXISTS allowed_flaws text[] NOT NULL DEFAULT '{}'::text[],
  -- Which band the setup screen offers first. Data, so changing it is an UPDATE.
  ADD COLUMN IF NOT EXISTS is_default    boolean NOT NULL DEFAULT false;

-- near_required must fit inside option_count, and cannot exceed the distractors there are.
ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_levels_near_required_check;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_near_fits_options
    CHECK (near_required >= 0 AND near_required <= option_count - 1);

-- Exactly one default, enforced rather than remembered.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_difficulty_one_default
  ON public.quiz_difficulty_levels ((true)) WHERE is_default;

UPDATE public.quiz_difficulty_levels SET is_default = true WHERE level = 3;

COMMENT ON COLUMN public.quiz_difficulty_levels.allowed_flaws IS
  'Restrict a band to these distractor flaws. Empty means all. Validated against the edge contract by quiz_difficulty_test.sql, so a typo here cannot silently make a band unbuildable.';

-- ── 2) The list the client renders ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'level', level, 'near_required', near_required,
           'option_count', option_count, 'allowed_flaws', allowed_flaws,
           'is_default', is_default) ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

-- ── 3) Add, retune or retire a band without a migration ─────────────────────
--
-- The whole point of 198. `p_level` is the key: absent rows are inserted, present rows
-- updated, and `p_is_active := false` retires one without destroying the sets that were
-- built at it — which a DELETE would, via the foreign key.
CREATE OR REPLACE FUNCTION public.admin_set_quiz_difficulty(
  p_level         smallint,
  p_near_required smallint DEFAULT NULL,
  p_option_count  smallint DEFAULT NULL,
  p_allowed_flaws text[]   DEFAULT NULL,
  p_sort_order    smallint DEFAULT NULL,
  p_is_active     boolean  DEFAULT NULL,
  p_make_default  boolean  DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row quiz_difficulty_levels%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = '42501';
  END IF;
  IF p_level IS NULL OR p_level <= 0 THEN
    RAISE EXCEPTION 'level must be positive' USING errcode = 'invalid_parameter_value';
  END IF;

  INSERT INTO quiz_difficulty_levels (level, near_required, option_count, allowed_flaws,
                                      sort_order, is_active)
    VALUES (p_level,
            COALESCE(p_near_required, 1),
            COALESCE(p_option_count, 4),
            COALESCE(p_allowed_flaws, '{}'::text[]),
            COALESCE(p_sort_order, p_level),
            COALESCE(p_is_active, true))
  ON CONFLICT (level) DO UPDATE SET
    near_required = COALESCE(p_near_required, quiz_difficulty_levels.near_required),
    option_count  = COALESCE(p_option_count,  quiz_difficulty_levels.option_count),
    allowed_flaws = COALESCE(p_allowed_flaws, quiz_difficulty_levels.allowed_flaws),
    sort_order    = COALESCE(p_sort_order,    quiz_difficulty_levels.sort_order),
    is_active     = COALESCE(p_is_active,     quiz_difficulty_levels.is_active),
    updated_at    = now();

  IF p_make_default THEN
    -- Cleared first: the unique partial index means two defaults is an error, not a
    -- last-writer-wins race.
    UPDATE quiz_difficulty_levels SET is_default = false WHERE is_default;
    UPDATE quiz_difficulty_levels SET is_default = true WHERE level = p_level;
  END IF;

  SELECT * INTO v_row FROM quiz_difficulty_levels WHERE level = p_level;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean)
  TO authenticated;

-- ── 4) The default comes from the data ──────────────────────────────────────
--
-- `p_difficulty` now defaults to NULL, meaning "whichever band is marked default". An
-- older client that omits it therefore follows the owner's current choice instead of a
-- number frozen into a shipped build.
CREATE OR REPLACE FUNCTION public.create_quiz_set(
  p_deck_id        uuid,
  p_title          text,
  p_question_type  text,
  p_count          integer,
  p_content_locale text,
  p_scope_kind     text     DEFAULT 'deck',
  p_tags           text[]   DEFAULT '{}'::text[],
  p_card_ids       uuid[]   DEFAULT '{}'::uuid[],
  p_difficulty     smallint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_n     integer;
  v_band  quiz_difficulty_levels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF p_question_type NOT IN ('mcq', 'short', 'essay') THEN
    RAISE EXCEPTION 'Unknown question type' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 12 THEN
    RAISE EXCEPTION 'Question count out of range' USING errcode = 'P0009';
  END IF;

  IF p_difficulty IS NULL THEN
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_default AND is_active;
    IF NOT FOUND THEN
      -- No default marked: take the gentlest active band rather than refusing. A missing
      -- flag is an owner's oversight, and it must not stop a learner making a quiz.
      SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_active
       ORDER BY sort_order LIMIT 1;
    END IF;
  ELSE
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = p_difficulty AND is_active;
  END IF;
  IF NOT FOUND OR v_band.level IS NULL THEN
    RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
  -- Scales with the band: a six-option question needs six cards to draw from, not four.
  IF p_question_type = 'mcq' AND v_n < v_band.option_count THEN
    RAISE EXCEPTION 'Not enough cards for multiple choice' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         scope_tags, scope_card_ids, requested_count, content_locale, difficulty)
    VALUES (v_uid, p_deck_id, p_title, p_question_type, p_scope_kind,
            CASE WHEN p_scope_kind = 'tags'  THEN p_tags     ELSE '{}'::text[] END,
            CASE WHEN p_scope_kind = 'cards' THEN p_card_ids ELSE '{}'::uuid[] END,
            LEAST(p_count, v_n), p_content_locale, v_band.level)
    RETURNING id INTO v_set;

  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key) ORDER BY ord)
    INTO v_cards
    FROM (SELECT card_id, answer_key, random() AS ord
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           ORDER BY random() LIMIT LEAST(p_count, v_n)) s;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', v_band.level,
                            'near_required', v_band.near_required,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;

-- ── 5) The option array grows with the band ─────────────────────────────────
--
-- 193 fixed it at four. A band with six options cannot store its question otherwise, and
-- the type shape check has to bend the same way.
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_options_check;
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_correct_index_check;
ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_options_check
    CHECK (options IS NULL OR cardinality(options) BETWEEN 2 AND 6),
  ADD CONSTRAINT quiz_questions_correct_index_check
    CHECK (correct_index IS NULL
           OR (correct_index >= 0 AND correct_index < cardinality(options)));

-- A CHECK cannot contain a subquery, and 193's containment trick only worked because the
-- length was fixed at four. An IMMUTABLE helper is the standard way out, and it says what it
-- means where a pair of `<@` operators did not.
CREATE OR REPLACE FUNCTION public._is_index_permutation(a smallint[])
  RETURNS boolean
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT a IS NULL OR (
    cardinality(a) BETWEEN 2 AND 6
    AND (SELECT count(DISTINCT v) = cardinality(a)
              AND min(v) = 0
              AND max(v) = cardinality(a) - 1
           FROM unnest(a) v));
$$;

ALTER TABLE public.quiz_run_items DROP CONSTRAINT IF EXISTS quiz_run_items_option_order_check;
ALTER TABLE public.quiz_run_items
  ADD CONSTRAINT quiz_run_items_option_order_check
    CHECK (public._is_index_permutation(option_order));

-- ── 6) A sitting shuffles as many options as the question has ───────────────
CREATE OR REPLACE FUNCTION public.start_quiz_run(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_set     quiz_sets%ROWTYPE;
  v_run     uuid;
  v_attempt smallint;
  v_n       integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501'; END IF;

  SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt
    FROM quiz_runs WHERE set_id = p_set_id AND user_id = v_uid;
  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = p_set_id;

  INSERT INTO quiz_runs (set_id, user_id, attempt_no, item_count, score_max)
    VALUES (p_set_id, v_uid, v_attempt, v_n, v_n) RETURNING id INTO v_run;

  -- Permutation length read off the question, not a constant: a four-option and a
  -- six-option question can sit in the same set if the band was retuned between them.
  INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
  SELECT v_run, q.id, q.position,
         CASE WHEN q.question_type = 'mcq' AND q.options IS NOT NULL
              THEN ARRAY(SELECT i FROM generate_series(0, cardinality(q.options) - 1) i
                          ORDER BY random())::smallint[]
         END
  FROM quiz_questions q WHERE q.set_id = p_set_id ORDER BY q.position;

  RETURN jsonb_build_object('run_id', v_run, 'attempt_no', v_attempt, 'item_count', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.start_quiz_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_quiz_run(uuid) TO authenticated;

-- ── 7) Answering accepts as many choices as were shown ──────────────────────
CREATE OR REPLACE FUNCTION public.submit_quiz_answer(
  p_run_item_id uuid,
  p_response    jsonb,
  p_duration_ms integer DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_item    quiz_run_items%ROWTYPE;
  v_q       quiz_questions%ROWTYPE;
  v_run     quiz_runs%ROWTYPE;
  v_choice  smallint;
  v_canon   smallint;
  v_correct boolean;
  v_score   numeric;
  v_attempt uuid;
  v_rtype   text;
  v_etype   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT i.* INTO v_item FROM quiz_run_items i
    JOIN quiz_runs r ON r.id = i.run_id
   WHERE i.id = p_run_item_id AND r.user_id = v_uid
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not accessible' USING errcode = '42501'; END IF;
  IF v_item.status = 'void' OR v_item.question_id IS NULL THEN
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'Item already answered' USING errcode = 'P0011';
  END IF;

  SELECT * INTO v_q FROM quiz_questions WHERE id = v_item.question_id;
  IF NOT FOUND THEN
    UPDATE quiz_run_items SET status = 'void' WHERE id = p_run_item_id;
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = v_item.run_id FOR UPDATE;

  IF v_q.question_type = 'mcq' THEN
    v_choice := (p_response->>'choice')::smallint;
    -- Bounded by what was actually shown, not by a hardcoded 3.
    IF v_choice IS NULL OR v_choice < 0 OR v_choice >= cardinality(v_item.option_order) THEN
      RAISE EXCEPTION 'choice is outside the options shown' USING errcode = 'invalid_parameter_value';
    END IF;
    v_canon  := v_item.option_order[v_choice + 1];
    v_correct := v_canon = v_q.correct_index;
    v_score  := CASE WHEN v_correct THEN 1 ELSE 0 END;
    v_rtype  := 'choice'; v_etype := 'choice';
  ELSE
    IF coalesce(btrim(p_response->>'text'), '') = '' THEN
      RAISE EXCEPTION 'answer text is required' USING errcode = 'invalid_parameter_value';
    END IF;
    v_score := NULL;
    v_rtype := 'text'; v_etype := CASE WHEN v_q.question_type = 'essay' THEN 'rubric' ELSE 'ai' END;
  END IF;

  INSERT INTO answer_attempts (
    user_id, card_id, quiz_run_item_id, client_attempt_id,
    activity_type, response_type, evaluator_type,
    response, normalized_score, duration_ms)
  VALUES (
    v_uid, v_q.card_id, p_run_item_id, gen_random_uuid(),
    CASE WHEN v_q.question_type = 'essay' THEN 'produce' ELSE 'recall' END,
    v_rtype, v_etype,
    p_response, v_score, COALESCE(p_duration_ms, 0))
  RETURNING id INTO v_attempt;

  UPDATE quiz_run_items
     SET status = CASE WHEN v_score IS NULL THEN 'answered' ELSE 'graded' END
   WHERE id = p_run_item_id;
  UPDATE quiz_runs
     SET answered_count = answered_count + 1,
         score_raw = score_raw + COALESCE(v_score, 0)
   WHERE id = v_item.run_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt,
    'graded', v_score IS NOT NULL,
    'score', v_score,
    'correct_display_index', CASE WHEN v_q.question_type = 'mcq'
      THEN (SELECT k - 1 FROM generate_subscripts(v_item.option_order, 1) k
             WHERE v_item.option_order[k] = v_q.correct_index) END,
    'reference_answer', CASE WHEN v_q.question_type = 'mcq' THEN v_q.reference_answer END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) TO authenticated;

COMMIT;
