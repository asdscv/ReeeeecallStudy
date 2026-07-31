-- ============================================================================
-- 174: Give study_recommendations a writer, and make an accepted one mean something.
--
-- THE GAP. mig 165 created study_recommendations with owner-SELECT RLS, two indexes and
-- an updated_at trigger — and nothing, anywhere in the repo, ever wrote a row. No RPC, no
-- edge function, no client. A "recommended for you" surface built on it would have been
-- permanently empty, which is why Phase 4 shipped diagnostics and deliberately deferred
-- this instead of rendering a hollow list.
--
-- WHAT MAKES A RECOMMENDATION WORTH PERSISTING AT ALL. Showing "this card is weak" needs no
-- table — Phase 4 already derives that on the fly. A row is only worth writing if the
-- learner's DECISION on it survives and changes something later. So this migration ships
-- the two halves together:
--   1) set_study_recommendations  — replace the PENDING set for a goal (history is kept)
--   2) set_study_recommendation_status — accept / dismiss, terminal like the enrichment one
-- and the client feeds accepted recommendations back into the planner as a candidate
-- importance boost. Accepting therefore changes tomorrow's plan; dismissing stops the
-- suggestion coming back. Without that loop this table would still be decoration.
--
-- REPLACE-ONLY-PENDING, not replace-all. A regenerated suggestion set must not erase what
-- the learner already accepted or dismissed: those are decisions, and re-proposing a
-- dismissed card would be the product arguing with the user. The producer is expected to
-- re-send its full current set; anything the user has ruled on simply stays ruled on.
--
-- PROVIDER IS RECORDED, NOT ASSUMED. `provider` + `algorithm_version` distinguish "an
-- algorithm suggested this" from "the AI suggested this" (design §11.5 wants recommendation
-- quality measurable per source). The first producer is the deterministic weak-card
-- algorithm; an AI producer can write the same table without a schema change.
--
-- Idempotent: CREATE OR REPLACE only. No schema change, no data change.
-- ============================================================================

-- ── 1) set_study_recommendations ────────────────────────────────────────────
-- p_items: [{"card_id": uuid, "action_type": "review_card", "reason": text?,
--            "payload": {}?, "concept_id": uuid?, "activity_id": uuid?}, ...]
--
-- Every item needs a card OR a concept OR an activity — a recommendation that points at
-- nothing cannot be acted on, and storing it would make the accept path meaningless.
CREATE OR REPLACE FUNCTION public.set_study_recommendations(
  p_goal_id           uuid,
  p_items             jsonb,
  p_provider          text DEFAULT 'algorithm',
  p_algorithm_version text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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

  -- Ownership + not-archived, locked so two producers cannot interleave.
  PERFORM 1 FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  -- Only the PENDING set is replaced. Accepted and dismissed rows are the learner's
  -- decisions and survive every regeneration.
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

    IF v_card IS NULL AND v_concept IS NULL AND v_activity IS NULL THEN
      RAISE EXCEPTION 'A recommendation must reference a card, concept or activity'
        USING ERRCODE = 'P0002';
    END IF;

    -- One suggestion per target per regeneration. A duplicate means the producer is
    -- confused about its own output, and collapsing it silently would keep it that way.
    v_key := COALESCE(v_card::text, '') || '|' || COALESCE(v_concept::text, '')
             || '|' || COALESCE(v_activity::text, '') || '|' || v_action;
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate recommendation target %', v_key USING ERRCODE = 'P0002';
    END IF;
    v_seen := v_seen || v_key;

    -- Same entitlement rules the plan writer uses: never let a recommendation reference
    -- something the caller cannot see.
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

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id, 'count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_study_recommendations(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_study_recommendations(uuid, jsonb, text, text) TO authenticated;

-- ── 2) set_study_recommendation_status ──────────────────────────────────────
-- Accept or dismiss, and like set_user_enrichment_status the closed states are TERMINAL:
-- only a 'pending' row can transition. A learner's decision is not something a later click
-- (or a stale tab) gets to overwrite.
CREATE OR REPLACE FUNCTION public.set_study_recommendation_status(
  p_recommendation_id uuid,
  p_status            text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_current record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('accepted', 'dismissed') THEN
    RAISE EXCEPTION 'Status must be accepted or dismissed' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_current
    FROM study_recommendations
   WHERE id = p_recommendation_id AND user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recommendation not found or not owned' USING ERRCODE = 'P0003';
  END IF;
  IF v_current.status <> 'pending' THEN
    RAISE EXCEPTION 'Recommendation is already %', v_current.status USING ERRCODE = 'P0007';
  END IF;

  UPDATE study_recommendations
     SET status = p_status
   WHERE id = p_recommendation_id;

  RETURN jsonb_build_object('ok', true, 'id', p_recommendation_id, 'status', p_status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_study_recommendation_status(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_study_recommendation_status(uuid, text) TO authenticated;
