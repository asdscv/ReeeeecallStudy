-- ============================================================================
-- 199: a difficulty band is a RANGE, because an exact count is unachievable
--
-- 197/198 asked for exactly N near-miss distractors and dropped the item otherwise.
-- The reasoning was sound — "an easy item with two near-misses is not easy" — and it
-- does not survive contact with a model. Run against a real six-word deck at all
-- three bands:
--
--   1단 (near 0)  →  every item dropped: wrong_difficulty_mix
--   2단 (near 1)  →  every item dropped: wrong_difficulty_mix
--   3단 (near 3)  →  dropped on other grounds
--
-- Nothing shipped. An exact count is a coin flip the model has to win three times per
-- item, and losing means the learner paid for nothing.
--
-- ── What actually matters, per band ─────────────────────────────────────────
--
-- The product claim is one-sided at each end, and a range says exactly that:
--
--   easy    at MOST 0 near-misses    — recognising the subject area must be enough
--   medium  at most 1                — one real trap, not three
--   hard    at LEAST 2               — it must not be winnable by elimination
--
-- Only the binding side is enforced. "Hard" does not care whether the third option is
-- a near-miss or merely plausible; "easy" does not care how the far options are far.
-- That is a much easier target and it is the whole of what the band promises.
--
-- ── Why a column and not a constant ─────────────────────────────────────────
--
-- Same reason as 198: a band is a row. `near_required` keeps its name and becomes the
-- MINIMUM; `near_max` is the new ceiling, defaulted from the existing value so the
-- seeded bands do not silently change meaning before they are retuned below.
-- ============================================================================

BEGIN;

ALTER TABLE public.quiz_difficulty_levels
  ADD COLUMN IF NOT EXISTS near_max smallint;

-- Backfill to the current exact semantics, so the column is never null mid-migration.
UPDATE public.quiz_difficulty_levels SET near_max = near_required WHERE near_max IS NULL;

ALTER TABLE public.quiz_difficulty_levels
  ALTER COLUMN near_max SET NOT NULL;

ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_near_fits_options,
  DROP CONSTRAINT IF EXISTS quiz_difficulty_near_range;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_near_range CHECK (
    near_required >= 0
    AND near_max >= near_required
    AND near_max <= option_count - 1);

COMMENT ON COLUMN public.quiz_difficulty_levels.near_required IS
  'MINIMUM near-miss distractors. Binding for hard bands ("must not be winnable by elimination").';
COMMENT ON COLUMN public.quiz_difficulty_levels.near_max IS
  'MAXIMUM near-miss distractors. Binding for easy bands ("recognising the area must be enough"). An exact count was tried in 197/198 and dropped every item a real model produced.';

-- Retune the three seeded bands to the one-sided claims they actually make.
UPDATE public.quiz_difficulty_levels SET near_required = 0, near_max = 0 WHERE level = 1;
UPDATE public.quiz_difficulty_levels SET near_required = 0, near_max = 1 WHERE level = 2;
UPDATE public.quiz_difficulty_levels SET near_required = 2, near_max = 3 WHERE level = 3;

-- ── The list, and the upsert, carry the range ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'level', level, 'near_required', near_required, 'near_max', near_max,
           'option_count', option_count, 'allowed_flaws', allowed_flaws,
           'is_default', is_default) ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_quiz_difficulty(
  p_level         smallint,
  p_near_required smallint DEFAULT NULL,
  p_option_count  smallint DEFAULT NULL,
  p_allowed_flaws text[]   DEFAULT NULL,
  p_sort_order    smallint DEFAULT NULL,
  p_is_active     boolean  DEFAULT NULL,
  p_make_default  boolean  DEFAULT false,
  p_near_max      smallint DEFAULT NULL
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

  INSERT INTO quiz_difficulty_levels (level, near_required, near_max, option_count,
                                      allowed_flaws, sort_order, is_active)
    VALUES (p_level,
            COALESCE(p_near_required, 0),
            -- Defaults to "no ceiling for this width", which is the permissive reading and
            -- the one that cannot silently drop every item.
            COALESCE(p_near_max, COALESCE(p_option_count, 4) - 1),
            COALESCE(p_option_count, 4),
            COALESCE(p_allowed_flaws, '{}'::text[]),
            COALESCE(p_sort_order, p_level),
            COALESCE(p_is_active, true))
  ON CONFLICT (level) DO UPDATE SET
    near_required = COALESCE(p_near_required, quiz_difficulty_levels.near_required),
    near_max      = COALESCE(p_near_max,      quiz_difficulty_levels.near_max),
    option_count  = COALESCE(p_option_count,  quiz_difficulty_levels.option_count),
    allowed_flaws = COALESCE(p_allowed_flaws, quiz_difficulty_levels.allowed_flaws),
    sort_order    = COALESCE(p_sort_order,    quiz_difficulty_levels.sort_order),
    is_active     = COALESCE(p_is_active,     quiz_difficulty_levels.is_active),
    updated_at    = now();

  IF p_make_default THEN
    UPDATE quiz_difficulty_levels SET is_default = false WHERE is_default;
    UPDATE quiz_difficulty_levels SET is_default = true WHERE level = p_level;
  END IF;

  SELECT * INTO v_row FROM quiz_difficulty_levels WHERE level = p_level;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint)
  TO authenticated;
DROP FUNCTION IF EXISTS public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean);

-- ── create_quiz_set reports the range ───────────────────────────────────────
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
      SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_active ORDER BY sort_order LIMIT 1;
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
                            'near_max', v_band.near_max,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;

COMMIT;
