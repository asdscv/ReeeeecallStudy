-- Rollback for 199 (difficulty as a range).
--
-- REFUSES rather than truncating: reverting collapses the range back to an exact count, and a
-- band whose min and max differ has no exact value to collapse TO. Retune those bands first —
-- or accept that reverting this is reverting the fix that made bands work at all, since an
-- exact count dropped every item a real model produced.

BEGIN;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM quiz_difficulty_levels WHERE near_max <> near_required;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back 199: % band(s) have near_max <> near_required and no single exact value. Retune them first.', v_n;
  END IF;
END;
$$;

ALTER TABLE public.quiz_difficulty_levels DROP CONSTRAINT IF EXISTS quiz_difficulty_near_range;
ALTER TABLE public.quiz_difficulty_levels
  ADD CONSTRAINT quiz_difficulty_near_fits_options
    CHECK (near_required >= 0 AND near_required <= option_count - 1);
ALTER TABLE public.quiz_difficulty_levels DROP COLUMN IF EXISTS near_max;

DROP FUNCTION IF EXISTS public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint);

-- 198's forms of the two functions that gained the range.
CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'level', level, 'near_required', near_required,
           'option_count', option_count, 'allowed_flaws', allowed_flaws,
           'is_default', is_default) ORDER BY sort_order), '[]'::jsonb)
    FROM quiz_difficulty_levels WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_difficulty_levels() TO authenticated;

COMMIT;

-- `create_quiz_set` is left at its 201 body: it reads `near_max` through the row type, and with
-- the column gone it simply stops reporting it. Re-pasting a long function to change nothing is
-- how a rollback introduces the bug it was run to avoid.
