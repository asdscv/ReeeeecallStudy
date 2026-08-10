-- A quiz may be up to 20 questions, not 12. Owner: the choices were too limited.
--
-- Four things capped the length, and widening fewer than all four moves nothing:
--
--   1. `quiz_sets.requested_count  CHECK (BETWEEN 1 AND 12)`  — mig 193, what the learner asked for
--   2. `quiz_runs.item_count       CHECK (BETWEEN 0 AND 12)`  — mig 193, what a sitting contains
--   3. `ai_pricing_settings.quiz_max_units_per_call = 40`     — mig 194, checked by
--      `get_ai_quiz_quote` AND `reserve_ai_quiz`
--   4. `COUNTS` in the two setup screens                      — presentation only
--
-- 20 is where the arithmetic stops being comfortable rather than where the schema does.
-- Generation costs 2 units a question for multiple choice and short answer and 3 for essay
-- (`ai_quiz_price_units`), so 20 questions is 40 or 60 units — hence the new per-call ceiling of
-- 60. Past that it is the generator that pushes back, not the meter: `MAX_QUIZ_BATCH` allows 3
-- essays per model call, so a 30-essay set would be ten sequential calls inside one
-- edge-function invocation. 20 keeps the worst case at seven.
--
-- Both CHECKs are widened, never narrowed, so no existing row can fail them.
--
-- The constraints are dropped BY LOOKUP rather than by their conventional
-- `<table>_<column>_check` name. An inline CHECK gets an auto-generated name, and if it ever
-- differed here a `DROP CONSTRAINT IF EXISTS` would no-op, the ADD below would succeed under a
-- new name, and the OLD constraint would still cap the column at 12 — a migration that reports
-- success and changes nothing.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conrelid::regclass AS tbl, con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.contype = 'c'
       AND (
         (con.conrelid = 'public.quiz_sets'::regclass AND att.attname = 'requested_count') OR
         (con.conrelid = 'public.quiz_runs'::regclass AND att.attname = 'item_count')
       )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.quiz_sets
  ADD CONSTRAINT quiz_sets_requested_count_check
  CHECK (requested_count BETWEEN 1 AND 20);

ALTER TABLE public.quiz_runs
  ADD CONSTRAINT quiz_runs_item_count_check
  CHECK (item_count BETWEEN 0 AND 20);

UPDATE public.ai_pricing_settings
   SET quiz_max_units_per_call = 60
 WHERE id = 1
   AND quiz_max_units_per_call < 60;

ALTER TABLE public.ai_pricing_settings
  ALTER COLUMN quiz_max_units_per_call SET DEFAULT 60;

COMMENT ON COLUMN public.ai_pricing_settings.quiz_max_units_per_call IS
  'Ceiling on units in one quiz reservation. 60 since 205 = 20 essay questions at 3 units each, the longest set the setup screen offers.';

-- ── The count guard inside `create_quiz_set` ────────────────────────────────
--
-- Widening the CHECKs is not enough: the function raises P0009 for anything over 12 before it
-- ever reaches them, and the client renders that as AI_REQUEST_TOO_LARGE. Body copied verbatim
-- from 202 with the single bound changed, because a hand-retyped 90-line money function is how
-- a difficulty band or a clamp quietly goes missing.
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
  v_uid     uuid := auth.uid();
  v_set     uuid;
  v_cards   jsonb;
  v_n       integer;
  v_band    quiz_difficulty_levels%ROWTYPE;
  v_fillers text[];
  v_guide   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF p_question_type NOT IN ('mcq', 'short', 'essay') THEN
    RAISE EXCEPTION 'Unknown question type' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 20 THEN
    RAISE EXCEPTION 'Question count out of range' USING errcode = 'P0009';
  END IF;

  IF p_difficulty IS NULL THEN
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_default AND is_active;
    IF NOT FOUND THEN
      SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_active ORDER BY sort_order LIMIT 1;
    END IF;
  ELSE
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = p_difficulty AND is_active;
  END IF;
  IF NOT FOUND OR v_band.level IS NULL THEN
    RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'invalid_parameter_value';
  END IF;

  -- A band with no guidance for this type cannot state what it means here, and
  -- generating anyway would produce a question at a difficulty nobody chose.
  v_guide := v_band.guidance ->> p_question_type;
  IF v_guide IS NULL OR btrim(v_guide) = '' THEN
    RAISE EXCEPTION 'This difficulty is not available for that question type'
      USING errcode = 'P0013';
  END IF;

  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
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

  SELECT array_agg(a ORDER BY random()) INTO v_fillers
    FROM (SELECT DISTINCT answer_text AS a
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           LIMIT 40) f;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', v_band.level,
                            'near_required', v_band.near_required,
                            'near_max', v_band.near_max,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'fillers', to_jsonb(COALESCE(v_fillers, '{}'::text[])),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;
