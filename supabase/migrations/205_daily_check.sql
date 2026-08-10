-- ============================================================================
-- 205: 오늘의 확인 — the app finally asks whether the learner actually knew it
--
-- ── The hole this fills ─────────────────────────────────────────────────────
--
-- Every activity this app has ever recorded is the learner grading themselves.
-- `activitiesForLegacyCard` emits exactly one shape — `activityType: 'recall'`,
-- `evaluatorType: 'self_rate'`, `responseType: 'self_rate'` — while both domain
-- adapters declare `defaultPlanMix {recall .6, practice .25, produce .15}`. So 40%
-- of every planned day is budgeted to activity classes with zero candidates, and
-- `recordAttempt`, the one function that could store a typed answer, has no caller
-- outside tests.
--
-- That is the real reason the learning plan's AI looks weak. There is no model to
-- be smart with, because nothing in the product ever checks whether the learner
-- was right. A coach reading this data is reading the learner's own optimism.
--
-- ── Why this costs almost nothing to run ────────────────────────────────────
--
-- Two decisions, both taken from `200_quiz_easy_band_without_ai.sql`, which built
-- the easy quiz band with no model at all:
--
--   1. THE CARD IS THE QUESTION. Measured against production: all 377,067 cards sit
--      on a template whose `back_layout` declares which field is the answer. So the
--      front fields are the prompt and the declared back field is the reference —
--      no generation call, $0, and nothing to hallucinate.
--
--   2. MOST GRADING IS A STRING COMPARISON. `_normalize_answer` below is the SQL
--      twin of `normalizeAnswer` in `ai-quiz.ts` (NFKC, casefold, drop everything
--      that is not a letter or digit). A learner who types the answer is told so
--      instantly and free. Only a genuinely ambiguous answer reaches the grader,
--      and that is the only thing they are ever charged for.
--
-- The result is a daily ritual whose price scales with how much the learner is
-- actually struggling, which is the only version of this worth selling. It also
-- makes the free tier buy something completable for the first time: 10 free units
-- cannot finish a 10-question multiple-choice set (20u), but they cover a week of
-- days on which two or three answers were close-but-not-right.
--
-- ── What it deliberately is not ─────────────────────────────────────────────
--
-- Not a quiz. No difficulty band, no generation step, no streak, and it must never
-- block finishing the day. It rides `quiz_sets`/`quiz_runs` because that runner,
-- its wallet, and its reserve/settle protocol already exist and are tested — not
-- because this is a second quiz.
-- ============================================================================

BEGIN;

-- ── 0) "What day is it for this learner?" ───────────────────────────────────
--
-- The client sends `resolveTimezoneLabel()`, which is an IANA name when the runtime has
-- ICU and a `UTC±HH:MM` label when it does not — which is exactly the Hermes build the
-- mobile app ships. Postgres accepts both and gets the second one BACKWARDS: it reads
-- POSIX sign conventions, so `AT TIME ZONE 'UTC+09:00'` shifts NINE HOURS WEST.
--
--   timestamptz '2026-08-10 20:00+00' AT TIME ZONE 'Asia/Seoul'  → 2026-08-11 05:00  ✓
--   timestamptz '2026-08-10 20:00+00' AT TIME ZONE 'UTC+09:00'   → 2026-08-10 11:00  ✗
--
-- An eighteen-hour error, landing on precisely the learners whose runtime could not name
-- their zone. Everything that decides "today" goes through here instead.
CREATE OR REPLACE FUNCTION public._local_date(p_ts timestamptz, p_timezone text)
  RETURNS date LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_sign int;
  v_h    int;
  v_m    int;
BEGIN
  IF p_timezone IS NULL OR btrim(p_timezone) = '' THEN
    RETURN (p_ts AT TIME ZONE 'UTC')::date;
  END IF;
  -- A real zone name: let Postgres do it, including DST.
  IF EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RETURN (p_ts AT TIME ZONE p_timezone)::date;
  END IF;
  -- `UTC+09:00` / `UTC-03:30`, applied with the sign the client meant.
  IF p_timezone ~ '^UTC[+-][0-9]{2}:[0-9]{2}$' THEN
    v_sign := CASE WHEN substring(p_timezone from 4 for 1) = '-' THEN -1 ELSE 1 END;
    v_h := substring(p_timezone from 5 for 2)::int;
    v_m := substring(p_timezone from 8 for 2)::int;
    RETURN (p_ts + (v_sign * (v_h * interval '1 hour' + v_m * interval '1 minute')))::date;
  END IF;
  RETURN (p_ts AT TIME ZONE 'UTC')::date;
END;
$$;

COMMENT ON FUNCTION public._local_date(timestamptz, text) IS
  'The learner''s calendar date for an instant. Handles the UTC±HH:MM labels an ICU-less Hermes build sends, which AT TIME ZONE silently interprets with the opposite sign.';

-- ── 1) The normalizer, shared by the grader and the check ───────────────────
--
-- IMMUTABLE so it can be used in an index or a CHECK later. Kept deliberately equal
-- to `normalizeAnswer` (ai-quiz.ts): NFKC first so half-width kana and full-width
-- latin fold, then casefold, then drop every non-alphanumeric character — which is
-- what makes "빌려주다." and "빌려주다  " and "빌려주다" one string, and why the
-- comparison works in the four locales that do not write spaces between words.
CREATE OR REPLACE FUNCTION public._normalize_answer(p_text text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT lower(regexp_replace(normalize(COALESCE(p_text, ''), NFKC), '[^[:alnum:]]', '', 'g'));
$$;

COMMENT ON FUNCTION public._normalize_answer(text) IS
  'SQL twin of normalizeAnswer() in ai-quiz.ts. Any change here must be mirrored there, or the same answer is graded differently depending on which side judged it.';

-- ── 2) A check belongs to a goal ────────────────────────────────────────────
ALTER TABLE public.quiz_sets
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.learning_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quiz_sets_goal_created_idx
  ON public.quiz_sets (goal_id, created_at DESC) WHERE goal_id IS NOT NULL;

COMMENT ON COLUMN public.quiz_sets.goal_id IS
  'Set when this set is a daily check for a learning goal rather than a quiz the learner composed. Nullable: an ordinary quiz has no goal.';

-- ── 3) Answer resolution for an arbitrary card list ─────────────────────────
--
-- `_quiz_eligible_cards` answers the same question but only within ONE deck, because
-- a quiz is composed from a deck. A day's study crosses decks, so this is the same
-- rule — a single declared `primary` back field, or a single candidate — over a list
-- of ids. The rule is not relaxed: a card whose template does not say which field is
-- the answer is dropped rather than guessed at, exactly as in 195.
CREATE OR REPLACE FUNCTION public._quiz_answer_for_cards(
  p_uid      uuid,
  p_card_ids uuid[]
) RETURNS TABLE (card_id uuid, prompt_text text, answer_text text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH scoped AS (
    SELECT c.id, c.field_values, c.template_id
      FROM cards c
     WHERE c.id = ANY(p_card_ids) AND c.user_id = p_uid
  ),
  tpl AS (
    SELECT t.id,
           (SELECT jsonb_object_agg(f->>'key', f->>'type')
              FROM jsonb_array_elements(t.fields) f) AS ftype,
           t.front_layout, t.back_layout
      FROM card_templates t
     WHERE t.id IN (SELECT DISTINCT template_id FROM scoped)
  ),
  front AS (
    SELECT s.id AS card_id,
           array_agg(DISTINCT fl->>'field_key') AS keys,
           btrim(concat_ws(' / ', VARIADIC array_agg(
             btrim(s.field_values ->> (fl->>'field_key')) ORDER BY fl->>'field_key'))) AS prompt
      FROM scoped s JOIN tpl ON tpl.id = s.template_id
      CROSS JOIN LATERAL jsonb_array_elements(tpl.front_layout) fl
     WHERE tpl.ftype ->> (fl->>'field_key') = 'text'
       AND coalesce(btrim(s.field_values ->> (fl->>'field_key')), '') <> ''
     GROUP BY s.id
  ),
  back AS (
    SELECT s.id AS card_id,
           count(*) AS cand_n,
           count(*) FILTER (WHERE bl->>'style' = 'primary') AS primary_n,
           min(bl->>'field_key') FILTER (WHERE bl->>'style' = 'primary') AS primary_key,
           min(bl->>'field_key') AS only_key
      FROM scoped s JOIN tpl ON tpl.id = s.template_id
      CROSS JOIN LATERAL jsonb_array_elements(tpl.back_layout) bl
     WHERE tpl.ftype ->> (bl->>'field_key') = 'text'
       AND coalesce(btrim(s.field_values ->> (bl->>'field_key')), '') <> ''
     GROUP BY s.id
  )
  SELECT s.id, f.prompt, btrim(s.field_values ->> k.answer_key)
    FROM scoped s
    JOIN front f ON f.card_id = s.id
    JOIN back  b ON b.card_id = s.id
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN b.primary_n = 1 THEN b.primary_key
               WHEN b.primary_n = 0 AND b.cand_n = 1 THEN b.only_key
             END AS answer_key
    ) k
   WHERE k.answer_key IS NOT NULL
     AND NOT (k.answer_key = ANY(f.keys))
     AND coalesce(btrim(s.field_values ->> k.answer_key), '') <> '';
$$;
REVOKE EXECUTE ON FUNCTION public._quiz_answer_for_cards(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._quiz_answer_for_cards(uuid, uuid[]) TO authenticated;

-- ── 4) How many of today's cards could be checked ───────────────────────────
--
-- Its own function so the button can say a real number — or not appear at all —
-- without creating anything. Building a set the learner then abandons would leave a
-- row and a wallet hold behind for a screen they never asked for.
CREATE OR REPLACE FUNCTION public.count_daily_check_cards(
  p_timezone text DEFAULT 'UTC'
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date;
  v_n     integer;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  v_today := public._local_date(now(), p_timezone);

  WITH studied AS (
    -- Both writers, because which one fires depends on the study mode and neither is
    -- the whole picture. DISTINCT, since a card re-rated in one day is still one card.
    SELECT DISTINCT e.card_id
      FROM study_rating_events e
     WHERE e.user_id = v_uid
       AND public._local_date(e.created_at, p_timezone) = v_today
    UNION
    SELECT DISTINCT l.card_id
      FROM study_logs l
     WHERE l.user_id = v_uid
       AND public._local_date(l.studied_at, p_timezone) = v_today
  )
  SELECT count(*) INTO v_total FROM studied;

  SELECT count(*) INTO v_n
    FROM _quiz_answer_for_cards(v_uid, ARRAY(SELECT card_id FROM (
      SELECT DISTINCT e.card_id FROM study_rating_events e
       WHERE e.user_id = v_uid
         AND public._local_date(e.created_at, p_timezone) = v_today
      UNION
      SELECT DISTINCT l.card_id FROM study_logs l
       WHERE l.user_id = v_uid
         AND public._local_date(l.studied_at, p_timezone) = v_today
    ) s));

  RETURN jsonb_build_object('studied_today', COALESCE(v_total, 0),
                            'checkable', COALESCE(v_n, 0));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.count_daily_check_cards(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_daily_check_cards(text) TO authenticated;

-- ── 5) Build the check — no model, no charge ────────────────────────────────
CREATE OR REPLACE FUNCTION public.build_daily_check(
  p_goal_id  uuid DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_limit    integer DEFAULT 8
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date;
  v_studied uuid[];
  v_chosen  uuid[];
  v_set     uuid;
  v_pos     smallint := 0;
  v_n       integer := 0;
  r         record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'limit out of range' USING errcode = 'P0009';
  END IF;
  IF p_goal_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM learning_goals g WHERE g.id = p_goal_id AND g.user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;

  v_today := public._local_date(now(), p_timezone);

  -- One check per goal per day. Re-opening the screen must reuse the set rather than
  -- charge a second reservation and split the day's answers across two histories.
  SELECT id INTO v_set FROM quiz_sets
   WHERE owner_user_id = v_uid
     AND goal_id IS NOT DISTINCT FROM p_goal_id
     AND question_type = 'short'
     AND title = '__daily_check__'
     AND public._local_date(created_at, p_timezone) = v_today
   ORDER BY created_at DESC LIMIT 1;
  IF v_set IS NOT NULL THEN
    RETURN jsonb_build_object('set_id', v_set, 'reused', true, 'price_micro', 0,
      'persisted', (SELECT generated_count FROM quiz_sets WHERE id = v_set));
  END IF;

  -- What was studied today, once. Both writers, because which one fires depends on the
  -- study mode and neither is the whole picture.
  SELECT array_agg(DISTINCT card_id) INTO v_studied FROM (
    SELECT e.card_id FROM study_rating_events e
     WHERE e.user_id = v_uid
       AND public._local_date(e.created_at, p_timezone) = v_today
    UNION
    SELECT l.card_id FROM study_logs l
     WHERE l.user_id = v_uid
       AND public._local_date(l.studied_at, p_timezone) = v_today
  ) s WHERE card_id IS NOT NULL;

  IF v_studied IS NULL OR cardinality(v_studied) = 0 THEN
    RAISE EXCEPTION 'Nothing studied today to check' USING errcode = 'P0010';
  END IF;

  -- Of those, the ones whose template actually says which field is the answer. A card
  -- that does not is dropped, never guessed at.
  SELECT array_agg(card_id) INTO v_chosen FROM (
    SELECT a.card_id FROM _quiz_answer_for_cards(v_uid, v_studied) a
     ORDER BY random() LIMIT p_limit
  ) c;

  IF v_chosen IS NULL OR cardinality(v_chosen) = 0 THEN
    RAISE EXCEPTION 'Nothing studied today to check' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, goal_id, title, question_type, scope_kind,
                         scope_card_ids, requested_count, content_locale, difficulty,
                         generated_count)
  VALUES (
    v_uid,
    -- The deck of the first chosen card. A day crosses decks, so this column is not the
    -- set's definition — `scope_card_ids` is. It is populated because `quiz_sets.deck_id`
    -- is NOT NULL and widening it would touch every quiz path for no gain here.
    (SELECT c.deck_id FROM cards c WHERE c.id = v_chosen[1]),
    p_goal_id, '__daily_check__', 'short', 'cards',
    v_chosen, cardinality(v_chosen), 'ko', 1, 0)
  RETURNING id INTO v_set;

  FOR r IN
    SELECT a.card_id, a.prompt_text, a.answer_text
      FROM _quiz_answer_for_cards(v_uid, v_chosen) a
  LOOP
    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      reference_answer, source_fingerprint, difficulty, meta)
    VALUES (
      v_set, v_uid, r.card_id, 'short', v_pos,
      -- The card's own prompt, verbatim. No model wrote any part of this question, so
      -- there is nothing here to validate and nothing that can leak the answer.
      r.prompt_text,
      r.answer_text, md5(r.prompt_text || ' ' || r.answer_text), 1,
      jsonb_build_object('source', 'daily_check'));
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  UPDATE quiz_sets SET generated_count = v_n, updated_at = now() WHERE id = v_set;
  RETURN jsonb_build_object('set_id', v_set, 'persisted', v_n, 'reused', false,
                            'price_micro', 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_daily_check(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.build_daily_check(uuid, text, integer) IS
  'Build today''s check from the cards the learner actually studied, using each card''s own fields as question and reference. No model call and no charge — the price of this feature is only in grading the answers a string comparison cannot settle.';

-- ── 6) A right answer costs nothing ─────────────────────────────────────────
--
-- Recreated from 198 — NOT 195 — with the exact-match branch added. 198 replaced this
-- function to support bands wider than four options; rebuilding from 195 silently reverted
-- that and broke `quiz_difficulty_test` with "choice must be 0..3". This is what keeps the daily
-- check honest as a product: the learner is charged only for the answers a string
-- comparison could not settle, so a good day is free and a hard day is the one that
-- costs — which is the only version of this worth selling.
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
    v_rtype := 'text';
    -- 205: a short answer that IS the answer is settled here, free, by string comparison.
    -- `_normalize_answer` folds width, case and punctuation exactly as the TypeScript grader
    -- does, so "빙하." and "빙하" are one string. Charging a learner to be told they typed the
    -- right word is the same mistake as charging for multiple-choice grading, which
    -- `ai_quiz_price_units` omits on purpose.
    --
    -- Essays are never settled this way: their reference is a model answer, not a key, and an
    -- exact match against it would mean nothing.
    IF v_q.question_type = 'short'
       AND coalesce(v_q.reference_answer, '') <> ''
       AND public._normalize_answer(p_response->>'text') = public._normalize_answer(v_q.reference_answer)
    THEN
      v_score := 1;
      v_etype := 'exact';
    ELSE
      v_score := NULL;
      v_etype := CASE WHEN v_q.question_type = 'essay' THEN 'rubric' ELSE 'ai' END;
    END IF;
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
    -- Revealed once the item is settled: multiple choice always, and a short answer the
    -- learner got exactly right — they typed it, so it discloses nothing.
    'reference_answer', CASE WHEN v_q.question_type = 'mcq' OR v_etype = 'exact'
                             THEN v_q.reference_answer END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer(uuid, jsonb, integer) TO authenticated;

-- ── 7) The same trap, closed in 204's resolver ──────────────────────────────
--
-- `_pending_plan_item_for_card` compares `plan_date` against `now() AT TIME ZONE
-- p.timezone`, and `daily_plans.timezone` is written by the same client helper — so an
-- ICU-less learner's plan item was matched against a day up to eighteen hours off. Same
-- fix, same reason.
CREATE OR REPLACE FUNCTION public._pending_plan_item_for_card(
  p_user_id uuid,
  p_card_id uuid
) RETURNS TABLE (
  item_id       uuid,
  goal_id       uuid,
  activity_type text,
  response_type text,
  evaluator_type text
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT i.id, p.goal_id, i.activity_type, i.response_type, i.evaluator_type
    FROM daily_plan_items i
    JOIN daily_plans p ON p.id = i.plan_id
   WHERE p.user_id = p_user_id
     AND i.card_id = p_card_id
     AND i.status = 'pending'
     AND p.plan_date = public._local_date(now(), p.timezone)
     AND i.evaluator_type = 'self_rate'
   ORDER BY i.position
   LIMIT 1;
$fn$;
REVOKE EXECUTE ON FUNCTION public._pending_plan_item_for_card(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
