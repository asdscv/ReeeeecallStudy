-- ============================================================================
-- 206: 주간 플랜 코치 — the plan finally suggests changing itself
--
-- ── The knob nobody turns ───────────────────────────────────────────────────
--
-- Every setting on a learning goal is write-once in practice. `daily_minutes`, the deck
-- list, the cadence and the intake are chosen in the create form and never revisited —
-- and on mobile they cannot be revisited at all, because there is no goal editor. So a
-- plan that was too ambitious on day one stays too ambitious for its whole life, and the
-- learner's only lever is to stop opening the app.
--
-- ── The seam that was built for this and never filled ───────────────────────
--
-- `study_recommendations` (mig 165) and `set_study_recommendations` (mig 174) already carry
-- `provider` and `algorithm_version` for exactly this purpose. The store's own comment says
-- it: "Nothing here calls the model — an AI producer can write the same table under a
-- different provider without a schema change." In production that column has only ever held
-- `'algorithm'`, and the only producer picks the ten lowest-scoring cards.
--
-- ── Why the first coach is deterministic ────────────────────────────────────
--
-- Not because a model would be worse at it, but because the shape is worth proving first.
-- The lever set is closed and the numbers are derived server-side either way, so the model's
-- entire job is CHOOSING one member of a six-item enum from a digest. Shipping the chooser as
-- code means the table, the suggestion UI, the apply path and the tests all exist and are
-- exercised before a provider call is added — and when it is added, it writes the same rows
-- under `provider = 'ai'` and nothing else changes. That is what the seam was for.
--
-- It also means this feature costs nothing to run, which matters: a learner should not be
-- charged to be told why they are behind.
--
-- ── The one structural change ───────────────────────────────────────────────
--
-- `set_study_recommendations` requires every row to name a card, a concept or an activity.
-- That is right for "review this card" and impossible for "your daily intake is too high" —
-- a plan-level suggestion is about the GOAL. So goal-level rows are now allowed, but only
-- for action types drawn from the lever table, which keeps the old rule everywhere else:
-- a producer still cannot write an untargeted card recommendation.
-- ============================================================================

BEGIN;

-- ── 1) The levers, as rows ──────────────────────────────────────────────────
--
-- Same pattern as `quiz_difficulty_levels` (migs 197→202): the thing a future model will be
-- asked to choose from is DATA, so retuning the coach — adding a lever, rewording one,
-- retiring one — is an UPDATE rather than a deploy.
CREATE TABLE IF NOT EXISTS public.learning_plan_levers (
  id           text PRIMARY KEY,
  -- What the lever changes, mechanically. The server derives the new value; this only says
  -- which dial it turns, so a client cannot be handed a number to write.
  dial         text NOT NULL CHECK (dial IN ('new_cards_per_day', 'daily_minutes', 'none')),
  direction    smallint NOT NULL CHECK (direction IN (-1, 0, 1)),
  -- Free-form material for a future model, keyed the way the quiz's `guidance` is: inserted
  -- into the prompt verbatim, never shown to a learner.
  guidance     text NOT NULL DEFAULT '',
  sort_order   smallint NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.learning_plan_levers (id, dial, direction, sort_order, guidance) VALUES
  ('lower_intake',    'new_cards_per_day', -1, 1,
   'The learner is finishing less than half of most days. Fewer new cards per day is the only change that shrinks tomorrow without abandoning anything already started.'),
  ('raise_intake',    'new_cards_per_day',  1, 2,
   'The learner finishes every day with room to spare. More new cards per day brings the finish date closer.'),
  ('shorten_session', 'daily_minutes',     -1, 3,
   'The learner starts most days but stops partway. A smaller daily budget makes the day completable, which is what keeps a habit.'),
  ('catch_up_week',   'none',               0, 4,
   'A backlog built up during an absence. Nothing needs changing permanently — the plan will drain it if the learner simply returns.'),
  ('add_study_day',   'none',               0, 5,
   'The learner studies in bursts with long gaps. Consistency matters more than volume here.'),
  ('hold',            'none',               0, 6,
   'Nothing is wrong. Say so and change nothing — a coach that always finds a problem is noise.')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.learning_plan_levers ENABLE ROW LEVEL SECURITY;
-- Readable by any signed-in learner (the client needs the lever list to render a suggestion);
-- writable by nobody through the API.
DROP POLICY IF EXISTS learning_plan_levers_read ON public.learning_plan_levers;
CREATE POLICY learning_plan_levers_read ON public.learning_plan_levers
  FOR SELECT TO authenticated USING (is_active);

CREATE OR REPLACE FUNCTION public.get_learning_plan_levers()
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'dial', dial, 'direction', direction) ORDER BY sort_order), '[]'::jsonb)
    FROM learning_plan_levers WHERE is_active;
$$;
REVOKE EXECUTE ON FUNCTION public.get_learning_plan_levers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learning_plan_levers() TO authenticated;

-- ── 2) A recommendation may be about the plan, not a card ───────────────────
CREATE OR REPLACE FUNCTION public.set_study_recommendations(
  p_goal_id           uuid,
  p_items             jsonb,
  p_provider          text DEFAULT 'algorithm',
  p_algorithm_version text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_item      jsonb;
  v_card      uuid;
  v_concept   uuid;
  v_activity  uuid;
  v_action    text;
  v_count     integer;
  v_seen      text[] := '{}';
  v_key       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(p_provider, '') = '' THEN
    RAISE EXCEPTION 'provider must be non-empty' USING ERRCODE = 'P0002';
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count > 50 THEN
    RAISE EXCEPTION 'Maximum 50 recommendations per goal' USING ERRCODE = 'P0006';
  END IF;
  IF octet_length(p_items::text) > 32768 THEN
    RAISE EXCEPTION 'items payload exceeds 32KiB limit' USING ERRCODE = 'P0006';
  END IF;

  PERFORM 1 FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  DELETE FROM study_recommendations
   WHERE user_id = v_uid AND goal_id = p_goal_id AND status = 'pending';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Each recommendation must be an object' USING ERRCODE = 'P0002';
    END IF;

    v_action := COALESCE(v_item->>'action_type', '');
    IF v_action = '' THEN
      RAISE EXCEPTION 'Each recommendation needs an action_type' USING ERRCODE = 'P0002';
    END IF;

    BEGIN
      v_card     := NULLIF(v_item->>'card_id', '')::uuid;
      v_concept  := NULLIF(v_item->>'concept_id', '')::uuid;
      v_activity := NULLIF(v_item->>'activity_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'card_id / concept_id / activity_id must be uuids' USING ERRCODE = 'P0002';
    END;

    -- 206: a PLAN-LEVEL suggestion targets the goal, so it names nothing smaller. The old
    -- rule still holds for everything else — this is not a general escape hatch, it is a
    -- second, closed vocabulary. An unknown untargeted action is still refused.
    IF v_card IS NULL AND v_concept IS NULL AND v_activity IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM learning_plan_levers
                      WHERE id = v_action AND is_active) THEN
        RAISE EXCEPTION 'A recommendation must reference a card, concept or activity'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    v_key := COALESCE(v_card::text, '') || '|' || COALESCE(v_concept::text, '')
             || '|' || COALESCE(v_activity::text, '') || '|' || v_action;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate recommendation target %', v_key USING ERRCODE = 'P0002';
    END IF;
    v_seen := v_seen || v_key;

    -- Entitlement, unchanged from 174: never let a recommendation reference something the
    -- caller cannot see.
    IF v_card IS NOT NULL AND NOT public._check_card_access(v_uid, v_card) THEN
      RAISE EXCEPTION 'Card % not accessible', v_card USING ERRCODE = 'P0003';
    END IF;
    IF v_concept IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM learning_concepts
       WHERE id = v_concept AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Concept % not accessible', v_concept USING ERRCODE = 'P0003';
    END IF;
    IF v_activity IS NOT NULL AND NOT public._check_activity_access(v_uid, v_activity) THEN
      RAISE EXCEPTION 'Activity % not accessible', v_activity USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO study_recommendations (
      user_id, goal_id, card_id, concept_id, activity_id,
      action_type, provider, reason, payload, algorithm_version
    ) VALUES (
      v_uid, p_goal_id, v_card, v_concept, v_activity,
      v_action, p_provider,
      NULLIF(v_item->>'reason', ''),
      COALESCE(v_item->'payload', '{}'::jsonb),
      p_algorithm_version
    );
  END LOOP;

  -- The 174 return shape, unchanged: `study_recommendation_test` reads `count`, and renaming
  -- it here would break a caller for no reason.
  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id, 'count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_study_recommendations(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_study_recommendations(uuid, jsonb, text, text) TO authenticated;

-- ── 3) The digest the coach reasons over ────────────────────────────────────
--
-- One read, server-side, so the client cannot disagree with itself about what "behind"
-- means — and so a future model is handed the same numbers the deterministic chooser saw.
CREATE OR REPLACE FUNCTION public.get_plan_digest(
  p_goal_id  uuid,
  p_timezone text DEFAULT 'UTC',
  p_days     integer DEFAULT 7
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_today date;
  v_row   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 60 THEN
    RAISE EXCEPTION 'days out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  v_today := public._local_date(now(), p_timezone);

  SELECT
    count(*)                                                        AS plans,
    count(*) FILTER (WHERE p.completed_items >= p.total_items
                       AND p.total_items > 0)                       AS days_finished,
    count(*) FILTER (WHERE p.completed_items = 0
                       AND p.total_items > 0)                       AS days_untouched,
    count(*) FILTER (WHERE p.completed_items > 0
                       AND p.completed_items < p.total_items)       AS days_partial,
    COALESCE(sum(p.total_items), 0)                                 AS items_planned,
    COALESCE(sum(p.completed_items), 0)                             AS items_done
  INTO v_row
  FROM daily_plans p
  WHERE p.user_id = v_uid AND p.goal_id = p_goal_id
    AND p.plan_date > v_today - p_days AND p.plan_date <= v_today;

  RETURN jsonb_build_object(
    'goal_id', p_goal_id,
    'days', p_days,
    'plans', COALESCE(v_row.plans, 0),
    'days_finished', COALESCE(v_row.days_finished, 0),
    'days_untouched', COALESCE(v_row.days_untouched, 0),
    'days_partial', COALESCE(v_row.days_partial, 0),
    'items_planned', COALESCE(v_row.items_planned, 0),
    'items_done', COALESCE(v_row.items_done, 0),
    -- The learner's own settings, so the chooser can refuse a lever that is already at its
    -- floor rather than suggesting a change that does nothing.
    'daily_minutes', (SELECT daily_minutes FROM learning_goals WHERE id = p_goal_id),
    'new_cards_per_day', (SELECT (settings->>'new_cards_per_day')::int
                            FROM learning_goals WHERE id = p_goal_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_plan_digest(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.get_plan_digest(uuid, text, integer) IS
  'The last N days of a goal''s plans, as the few numbers a coach can act on. Server-side so the deterministic chooser and a future model reason over identical input.';

COMMIT;
