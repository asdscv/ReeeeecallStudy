-- Rollback for 198.
--
-- Returns to 197's shape: one difficulty axis, four options, a level ceiling of nine, and a
-- default frozen at band 3.
--
-- REFUSES rather than truncates. If any band above level 9 exists, or any question was built
-- with other than four options, restoring 197's constraints would fail on the data — so this
-- says so plainly instead of leaving a half-applied rollback. Retire the offending bands
-- (`is_active := false` does not help; they must be deleted) and regenerate those sets first.

BEGIN;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM quiz_difficulty_levels WHERE level > 9;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 198: % band(s) above level 9 exist. Delete them first.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM quiz_questions
   WHERE options IS NOT NULL AND cardinality(options) <> 4;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 198: % question(s) do not have exactly 4 options.', v_n;
  END IF;
END;
$$;

-- Constraints back to their 193/197 form.
ALTER TABLE public.quiz_run_items DROP CONSTRAINT IF EXISTS quiz_run_items_option_order_check;
ALTER TABLE public.quiz_run_items
  ADD CONSTRAINT quiz_run_items_option_order_check
    CHECK (option_order IS NULL OR (
      cardinality(option_order) = 4
      AND option_order <@ ARRAY[0,1,2,3]::smallint[]
      AND ARRAY[0,1,2,3]::smallint[] <@ option_order));
DROP FUNCTION IF EXISTS public._is_index_permutation(smallint[]);

ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_options_check;
ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_correct_index_check;
ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_options_check CHECK (options IS NULL OR cardinality(options) = 4),
  ADD CONSTRAINT quiz_questions_correct_index_check
    CHECK (correct_index IS NULL OR correct_index BETWEEN 0 AND 3);

DROP INDEX IF EXISTS public.quiz_difficulty_one_default;
ALTER TABLE public.quiz_difficulty_levels
  DROP COLUMN IF EXISTS option_count,
  DROP COLUMN IF EXISTS allowed_flaws,
  DROP COLUMN IF EXISTS is_default;
ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_near_fits_options;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_levels_near_required_check CHECK (near_required BETWEEN 0 AND 3);
ALTER TABLE public.quiz_difficulty_levels
  DROP CONSTRAINT IF EXISTS quiz_difficulty_levels_level_check;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_levels_level_check CHECK (level BETWEEN 1 AND 9);

DROP FUNCTION IF EXISTS public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean);

-- The 197 forms of the three functions 198 replaced. Reproduced rather than referenced so
-- this file stands alone.
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('level', level, 'near_required', near_required)
                            ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

COMMIT;

-- create_quiz_set, start_quiz_run and submit_quiz_answer are left at their 198 bodies on
-- purpose: each reads the band's columns defensively (COALESCE / cardinality), so with the
-- extra columns gone they behave exactly as 197 did. Re-pasting three long functions to
-- change nothing is how a rollback introduces the bug it was run to avoid.
