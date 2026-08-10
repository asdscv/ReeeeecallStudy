-- Rollback for 202 (difficulty as a per-type instruction).
--
-- Drops the `guidance` column and returns the three functions to their 201 bodies.
--
-- What reverting costs, stated so it is a decision:
--
--   * Short answer and essay lose difficulty entirely. It was never expressible as a
--     near-miss count, which is why 202 exists.
--   * Multiple choice goes back to the mechanical near-count gate, which dropped EVERY item
--     on bands 1 and 2 across three deploys.
--   * `admin_set_quiz_difficulty` loses its guidance parameter, so retuning a band means
--     editing SQL again.
--
-- The column is dropped rather than kept, because guidance that nothing reads is guidance
-- that silently rots. The three seeded strings are in 202 if they are wanted back.

BEGIN;

DROP FUNCTION IF EXISTS public.get_quiz_set_guidance(uuid);
DROP FUNCTION IF EXISTS public.admin_set_quiz_difficulty(smallint, smallint, smallint, text[], smallint, boolean, boolean, smallint, jsonb);

ALTER TABLE public.quiz_difficulty_levels DROP CONSTRAINT IF EXISTS quiz_difficulty_guidance_shape;
ALTER TABLE public.quiz_difficulty_levels DROP COLUMN IF EXISTS guidance;
DROP FUNCTION IF EXISTS public._quiz_guidance_is_valid(jsonb);

CREATE OR REPLACE FUNCTION public.get_quiz_difficulty_levels()
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
    VALUES (p_level, COALESCE(p_near_required, 0),
            COALESCE(p_near_max, COALESCE(p_option_count, 4) - 1),
            COALESCE(p_option_count, 4), COALESCE(p_allowed_flaws, '{}'::text[]),
            COALESCE(p_sort_order, p_level), COALESCE(p_is_active, true))
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

COMMIT;

-- `create_quiz_set` is left at its 202 body: with the column gone its guidance lookup returns
-- NULL and the P0013 branch never fires, so it behaves exactly as 201 did. Re-pasting a long
-- function to change nothing is how a rollback introduces the bug it was run to avoid.
