-- Rollback for 186. Restores 182's inline CASE in get_goal_knowledge and 184's single-argument
-- resolver, so nothing is left pointing at a signature that no longer exists.
BEGIN;

DROP FUNCTION IF EXISTS public.learner_card_schedule(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.learner_card_schedule(p_user_id uuid)
  RETURNS TABLE (
    card_id uuid, deck_id uuid, srs_status text, interval_days integer,
    ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz
  )
  LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT c.id, c.deck_id,
    CASE WHEN d.user_id = p_user_id THEN c.srs_status       ELSE ucp.srs_status       END,
    CASE WHEN d.user_id = p_user_id THEN c.interval_days    ELSE ucp.interval_days    END,
    CASE WHEN d.user_id = p_user_id THEN c.ease_factor      ELSE ucp.ease_factor      END,
    CASE WHEN d.user_id = p_user_id THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END,
    CASE WHEN d.user_id = p_user_id THEN c.next_review_at   ELSE ucp.next_review_at   END
  FROM decks d
  JOIN cards c ON c.deck_id = d.id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE d.user_id = p_user_id OR ucp.user_id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.learner_card_schedule(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_card_schedule(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mature_card_count(p_user_id uuid)
  RETURNS bigint LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT count(*) FROM learner_card_schedule(p_user_id)
  WHERE srs_status = 'review' AND interval_days >= 21;
$$;

CREATE OR REPLACE FUNCTION public.get_goal_knowledge(
  p_goal_id uuid,
  p_at timestamptz,
  p_stability_multiplier numeric DEFAULT 1.0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_total     bigint := 0;
  v_unseen    bigint := 0;
  v_known     bigint := 0;
  v_due_now   bigint := 0;
  v_overdue   bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'p_at is required' USING ERRCODE = 'P0002';
  END IF;
  IF p_stability_multiplier IS NULL OR p_stability_multiplier <= 0 THEN
    RAISE EXCEPTION 'p_stability_multiplier must be positive' USING ERRCODE = 'P0002';
  END IF;

  SELECT user_id INTO v_owner FROM learning_goals WHERE id = p_goal_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Goal not found' USING ERRCODE = 'P0002';
  END IF;
  -- SECURITY DEFINER bypasses RLS, so ownership is checked explicitly. Reading another user's
  -- goal progress would be an IDOR of exactly the shape migrations 098/099 closed elsewhere.
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH goal_cards AS (
    SELECT
      c.id,
      -- Whose schedule is this? The deck owner's columns live on the card; everyone
      -- else's live on their own progress row. A learner studying an official deck
      -- has never written to `cards`, so reading it would report the publisher's
      -- state — which for official content is a uniform "never reviewed".
      CASE WHEN d.user_id = v_uid THEN c.interval_days    ELSE ucp.interval_days    END AS interval_days,
      CASE WHEN d.user_id = v_uid THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END AS last_reviewed_at,
      CASE WHEN d.user_id = v_uid THEN c.next_review_at   ELSE ucp.next_review_at   END AS next_review_at
    FROM learning_goal_decks lgd
    JOIN decks d ON d.id = lgd.deck_id
    JOIN cards c ON c.deck_id = lgd.deck_id
    LEFT JOIN user_card_progress ucp
      ON ucp.card_id = c.id AND ucp.user_id = v_uid
    WHERE lgd.goal_id = p_goal_id
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE last_reviewed_at IS NULL OR interval_days IS NULL OR interval_days <= 0),
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND interval_days IS NOT NULL
        AND interval_days > 0
        -- elapsed <= interval * k, expressed as a deadline so the comparison stays on dates.
        AND p_at <= last_reviewed_at + ((interval_days * p_stability_multiplier) * INTERVAL '1 day')
    ),
    -- Work already owed. A never-started card is NOT due: it is intake, counted in
    -- `unseen`, and gated by the daily new-card rate rather than by a due date.
    -- Counting it here would make "reviews I owe" include the entire unstarted deck.
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at <= p_at
    ),
    -- Late by more than a day. Separated from `due_now` so "behind" is a fact with a
    -- size, not an inference from a plan that happened to be too long.
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at < p_at - INTERVAL '1 day'
    )
  INTO v_total, v_unseen, v_known, v_due_now, v_overdue
  FROM goal_cards;

  RETURN jsonb_build_object(
    'total', v_total,
    'unseen', v_unseen,
    'known', v_known,
    'unknown', v_total - v_unseen - v_known,
    -- New keys. `unseen` already answers "how many are left to start", but it is
    -- named for the progress bar; `new_remaining` is the same number named for the
    -- scheduler, and keeping both means neither caller has to know the other's word.
    'new_remaining', v_unseen,
    'due_now', v_due_now,
    'overdue', v_overdue
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMIT;
