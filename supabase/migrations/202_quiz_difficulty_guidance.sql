-- ============================================================================
-- 202: a difficulty band is an INSTRUCTION, and it applies to all three types
--
-- ── Two things wrong with 197-201 ───────────────────────────────────────────
--
-- 1. Difficulty existed only for multiple choice. It was defined as "how many wrong
--    options are near-misses", which short answer and essay do not have. Those two
--    types — the ones we actually charge for — had no difficulty at all.
--
-- 2. The mechanical enforcement did not work. Asked for a deliberately UNRELATED
--    wrong option, the model returns another near-miss at every phrasing, so bands 1
--    and 2 dropped every item. 200/201 worked around it by building the far options
--    from the deck, which is a multiple-choice-only trick and made the problem in (1)
--    permanent.
--
-- ── What the model can actually be told ─────────────────────────────────────
--
-- "Be unrelated" fails because it names no target. "Use a concrete noun where the
-- answer is a verb" succeeds, because it names one. The fix is not a better validator,
-- it is a better instruction — and an instruction is text, which means a band can
-- carry its own and every question type can have one.
--
--   guidance -> {"mcq": "...", "short": "...", "essay": "..."}
--
-- Inserted into the prompt verbatim. Adding level 7, or retuning level 2, or giving
-- essays their own progression, is an UPDATE to one jsonb column. A hundred levels is
-- a hundred rows, and none of them need code, a deploy, or a translator — the guidance
-- is instruction to a model, not text shown to a learner.
--
-- ── Why the near-count is no longer a gate ──────────────────────────────────
--
-- `near_required` / `near_max` stay, and stop being enforced. They were the thing
-- dropping every item, they cannot be evaluated for short answer or essay at all, and
-- "did the model follow the guidance" is not mechanically checkable in the first place.
-- The structural checks — the answer never appears among the distractors, no
-- duplicates, no script mismatch, no length giveaway — are unchanged, because those
-- ARE checkable and they are what makes an item broken rather than merely easy.
--
-- The numbers survive as prompt INPUT (the guidance for the seeded bands is phrased
-- from them) and as the hint the setup screen shows. Nothing reads them as a rule.
-- ============================================================================

BEGIN;

ALTER TABLE public.quiz_difficulty_levels
  ADD COLUMN IF NOT EXISTS guidance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Every key must be a question type we generate, and every value a non-empty string.
-- A typo here would silently drop the guidance and the band would generate at whatever
-- the model felt like, which is exactly the failure this migration exists to end.
-- A CHECK cannot contain a subquery, so the shape test lives in an IMMUTABLE function.
CREATE OR REPLACE FUNCTION public._quiz_guidance_is_valid(g jsonb)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT g IS NULL OR (
    jsonb_typeof(g) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(g) e
       WHERE e.key NOT IN ('mcq', 'short', 'essay')
          OR jsonb_typeof(e.value) <> 'string'
          OR length(e.value #>> '{}') = 0
          OR length(e.value #>> '{}') > 1200));
$$;

ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_guidance_shape;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_guidance_shape
    CHECK (public._quiz_guidance_is_valid(guidance));

COMMENT ON COLUMN public.quiz_difficulty_levels.guidance IS
  'Per question type, the instruction inserted verbatim into the generation prompt. This is where difficulty LIVES: "be unrelated" fails at every phrasing, "use a concrete noun where the answer is a verb" works. Adding or retuning a band is an UPDATE here — no deploy, and no translation, because it is instruction to a model rather than text a learner reads.';

-- ── The three seeded bands, as instructions ─────────────────────────────────
--
-- Written as tasks with a named target rather than as adjectives. Each type gets its
-- own progression, because "harder" means something different when the learner is
-- choosing, recalling, or explaining.
UPDATE public.quiz_difficulty_levels SET guidance = jsonb_build_object(
  'mcq', 'EASY. Each wrong option must come from a DIFFERENT SEMANTIC CATEGORY than the answer — if the answer is an action, use concrete objects; if it is a place, use feelings; if it is a person, use time expressions. Name a different category for each one. A learner who only knows what KIND of thing the answer is should get this right. Do NOT write near-synonyms, opposites, or anything from the answer''s own topic.',
  'short', 'EASY. Ask for the answer in the most direct way the card allows, and include a strong cue in the question: the first character or letter of the answer, or its length in characters, or the category it belongs to. Recognition, not recall.',
  'essay', 'EASY. Ask for ONE thing only, in one sentence, using the card''s own wording. Two criteria at most, both about whether the central fact is present. Do not ask for reasons, examples, limits, or comparisons.'
) WHERE level = 1;

UPDATE public.quiz_difficulty_levels SET guidance = jsonb_build_object(
  'mcq', 'MEDIUM. Exactly ONE wrong option may be a near-miss — something from the answer''s own topic that a learner might confuse it with. The others must come from a DIFFERENT SEMANTIC CATEGORY, named explicitly for each. One real trap, not three.',
  'short', 'MEDIUM. Ask for the answer without cueing its form: no first letter, no length, no category. You may reword the card''s prompt, but do not change what is being asked for.',
  'essay', 'MEDIUM. Ask for the central fact AND one supporting element the card actually contains — a reason, an example, or a condition. Two to three criteria.'
) WHERE level = 2;

UPDATE public.quiz_difficulty_levels SET guidance = jsonb_build_object(
  'mcq', 'HARD. Every wrong option must be a near-miss: something from the answer''s own topic that a learner who half-knows the material would genuinely consider. Vary HOW each one is wrong — one reverses the direction, one is a neighbouring sense, one resembles the answer in form.',
  'short', 'HARD. Approach the answer from a different direction than the card does — ask what it contrasts with, what it applies to, or what follows from it — so that recognising the card''s front is not enough. The answer must still be exactly what the card says.',
  'essay', 'HARD. Ask the learner to explain and to bound: what it is, why, and where it stops or does not apply. Three to four criteria, each grounded in the card''s own text.'
) WHERE level = 3;

-- ── The list carries the guidance ───────────────────────────────────────────
--
-- Server-side only. The client picks a level and never sees these strings — they are
-- prompt material, and shipping them would invite a client to edit them.
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'level', level, 'near_required', near_required, 'near_max', near_max,
           'option_count', option_count, 'allowed_flaws', allowed_flaws,
           'is_default', is_default,
           -- Which types this band can actually be used for. A band with no essay
           -- guidance simply is not offered for essays, rather than generating one at
           -- an unstated difficulty.
           'types', (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                       FROM jsonb_object_keys(guidance) k)
         ) ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

-- ── create_quiz_set hands the guidance to the generator ─────────────────────
--
-- Body from 201 with the guidance added and the type checked against it. The deck fill
-- pool stays: it is still the right answer for a band that asks for far options, and
-- the generator now uses it only when the model comes back short.
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
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint)
  TO authenticated;

-- ── Guidance is editable without a migration ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_quiz_difficulty(
  p_level         smallint,
  p_near_required smallint DEFAULT NULL,
  p_option_count  smallint DEFAULT NULL,
  p_allowed_flaws text[]   DEFAULT NULL,
  p_sort_order    smallint DEFAULT NULL,
  p_is_active     boolean  DEFAULT NULL,
  p_make_default  boolean  DEFAULT false,
  p_near_max      smallint DEFAULT NULL,
  p_guidance      jsonb    DEFAULT NULL
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
                                      allowed_flaws, sort_order, is_active, guidance)
    VALUES (p_level,
            COALESCE(p_near_required, 0),
            COALESCE(p_near_max, COALESCE(p_option_count, 4) - 1),
            COALESCE(p_option_count, 4),
            COALESCE(p_allowed_flaws, '{}'::text[]),
            COALESCE(p_sort_order, p_level),
            COALESCE(p_is_active, true),
            COALESCE(p_guidance, '{}'::jsonb))
  ON CONFLICT (level) DO UPDATE SET
    near_required = COALESCE(p_near_required, quiz_difficulty_levels.near_required),
    near_max      = COALESCE(p_near_max,      quiz_difficulty_levels.near_max),
    option_count  = COALESCE(p_option_count,  quiz_difficulty_levels.option_count),
    allowed_flaws = COALESCE(p_allowed_flaws, quiz_difficulty_levels.allowed_flaws),
    sort_order    = COALESCE(p_sort_order,    quiz_difficulty_levels.sort_order),
    is_active     = COALESCE(p_is_active,     quiz_difficulty_levels.is_active),
    -- MERGED, not replaced: retuning the essay guidance must not silently blank the
    -- other two types and take the band offline for them.
    guidance      = quiz_difficulty_levels.guidance || COALESCE(p_guidance, '{}'::jsonb),
    updated_at    = now();

  IF p_make_default THEN
    UPDATE quiz_difficulty_levels SET is_default = false WHERE is_default;
    UPDATE quiz_difficulty_levels SET is_default = true WHERE level = p_level;
  END IF;

  SELECT * INTO v_row FROM quiz_difficulty_levels WHERE level = p_level;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint, jsonb)
  TO authenticated;
DROP FUNCTION IF EXISTS public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint);

-- ── The generator reads the guidance ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quiz_set_guidance(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_set quiz_sets%ROWTYPE; v_band quiz_difficulty_levels%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not found' USING errcode = 'P0003'; END IF;
  SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = v_set.difficulty;
  IF NOT FOUND THEN RETURN jsonb_build_object('guidance', NULL); END IF;
  RETURN jsonb_build_object(
    'level', v_band.level,
    'guidance', v_band.guidance ->> v_set.question_type,
    'option_count', v_band.option_count,
    'near_required', v_band.near_required,
    'near_max', v_band.near_max);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_set_guidance(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
