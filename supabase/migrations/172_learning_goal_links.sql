-- ============================================================================
-- 172: Give the goal→deck and goal→concept joins a writer.
--
-- THE GAP. mig 165 created learning_goal_decks(goal_id, deck_id, importance) and
-- learning_goal_concepts(goal_id, concept_id, importance) with owner-SELECT RLS and
-- `REVOKE ALL ... FROM anon, authenticated` — correct, because every write in this
-- engine goes through a SECURITY DEFINER RPC. But mig 167 shipped no such RPC for
-- either table, and nothing else writes them:
--
--     $ grep -rn "learning_goal_decks" supabase/migrations/*.sql
--     165: CREATE TABLE / RLS / SELECT policy / REVOKE / GRANT SELECT / GRANT ALL service_role
--     168: (read-only access checks inside reserve_ai_remediation)
--
-- So a user could create a goal and never attach anything to it. That makes the
-- planner unusable in product: `goalRelevance` is 0.20 of daily-plan-v1's priority
-- and has no input, `importance` (design §7.5) is unreachable, and there is no way
-- to scope candidates to the decks a goal is actually about.
--
-- THIS MIGRATION
--   1) _check_deck_access(uid, deck_id) — the deck-level twin of mig 167's
--      _check_card_access: owns the deck, or holds an ACTIVE subscribe share on a
--      still-active subscribed deck. Internal, never granted to a client role.
--   2) set_learning_goal_decks(goal_id, jsonb)     replace-all
--   3) set_learning_goal_concepts(goal_id, jsonb)  replace-all
--
-- WHY REPLACE-ALL rather than add/remove: the client already holds the full desired
-- set (a multi-select), and a diffing API invites the two sides to disagree about
-- what is attached. DELETE + INSERT inside the function's transaction means a
-- partial failure leaves the previous set intact — the old rows come back on
-- rollback. Passing '[]' detaches everything, which is legal and meaningful: a goal
-- with no decks plans nothing, and the UI says so instead of silently planning over
-- every card the user owns.
--
-- WHY out-of-range importance is REJECTED, not clamped: the column already has
-- CHECK (importance >= 0 AND importance <= 1). Clamping would hide a client that is
-- computing importance wrongly; the loud P0002 is the useful outcome. Same reasoning
-- for duplicate deck ids — a duplicate means the caller has lost track of its own
-- selection, and PK-collapsing it silently would keep it wrong.
--
-- DECK ENTITLEMENT IS RE-CHECKED ON EVERY CALL, so a share that was revoked after
-- the deck was attached cannot be re-asserted by a stale client. Existing rows are
-- NOT retroactively purged here (that is a background concern, and the planner reads
-- cards through their own RLS, so a lost deck contributes no candidates anyway).
--
-- Idempotent: CREATE OR REPLACE only. No schema change, no data change.
-- ============================================================================

-- ── 1) _check_deck_access — deck-level twin of _check_card_access ────────────
-- Mirrors the deck arm of mig 167's _check_card_access, minus the per-card
-- card-limit threshold (that is a property of a CARD's created_at, not of a deck).
-- Keeps the same `p_uid = auth.uid()` guard so a definer caller cannot be tricked
-- into evaluating access for somebody else.
CREATE OR REPLACE FUNCTION public._check_deck_access(p_uid uuid, p_deck_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND p_uid = auth.uid() AND EXISTS (
    SELECT 1
      FROM decks d
     WHERE d.id = p_deck_id
       AND (
         d.user_id = p_uid
         OR (
           EXISTS (
             SELECT 1 FROM deck_shares ds
              WHERE ds.deck_id = d.id AND ds.recipient_id = p_uid
                AND ds.share_mode = 'subscribe' AND ds.status = 'active'
           )
           AND public.is_subscribed_deck_active(d.id)
         )
       )
  );
$$;
REVOKE EXECUTE ON FUNCTION public._check_deck_access(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) set_learning_goal_decks ──────────────────────────────────────────────
-- p_decks: [{"deck_id": uuid, "importance": 0..1 (optional, default 0.5)}, ...]
CREATE OR REPLACE FUNCTION public.set_learning_goal_decks(
  p_goal_id uuid,
  p_decks   jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_item       jsonb;
  v_deck_id    uuid;
  v_importance numeric;
  v_count      integer;
  v_seen       uuid[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_decks IS NULL OR jsonb_typeof(p_decks) <> 'array' THEN
    RAISE EXCEPTION 'decks must be a JSON array' USING ERRCODE = 'P0002';
  END IF;

  v_count := jsonb_array_length(p_decks);
  IF v_count > 50 THEN
    RAISE EXCEPTION 'Maximum 50 decks per goal' USING ERRCODE = 'P0006';
  END IF;
  IF octet_length(p_decks::text) > 16384 THEN
    RAISE EXCEPTION 'decks payload exceeds 16KiB limit' USING ERRCODE = 'P0006';
  END IF;

  -- Lock the goal row: ownership + not-archived, and serialize concurrent edits so
  -- two tabs cannot interleave a DELETE with the other's INSERT.
  PERFORM 1 FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  DELETE FROM learning_goal_decks WHERE goal_id = p_goal_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_decks)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' OR COALESCE(v_item->>'deck_id', '') = '' THEN
      RAISE EXCEPTION 'Each deck entry needs a deck_id' USING ERRCODE = 'P0002';
    END IF;
    BEGIN
      v_deck_id := (v_item->>'deck_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'deck_id must be a uuid' USING ERRCODE = 'P0002';
    END;

    IF v_deck_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate deck_id %', v_deck_id USING ERRCODE = 'P0002';
    END IF;
    v_seen := v_seen || v_deck_id;

    IF v_item ? 'importance' AND v_item->>'importance' IS NOT NULL THEN
      IF jsonb_typeof(v_item->'importance') <> 'number' THEN
        RAISE EXCEPTION 'importance must be a number' USING ERRCODE = 'P0002';
      END IF;
      v_importance := (v_item->>'importance')::numeric;
      IF v_importance < 0 OR v_importance > 1 THEN
        RAISE EXCEPTION 'importance must be between 0 and 1' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      v_importance := 0.5;
    END IF;

    -- Entitlement, re-checked every call (a revoked share must not stay attached).
    IF NOT public._check_deck_access(v_uid, v_deck_id) THEN
      RAISE EXCEPTION 'Deck % not found or inaccessible', v_deck_id USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO learning_goal_decks (goal_id, deck_id, importance)
    VALUES (p_goal_id, v_deck_id, v_importance);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id, 'deck_count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_learning_goal_decks(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_learning_goal_decks(uuid, jsonb) TO authenticated;

-- ── 3) set_learning_goal_concepts ───────────────────────────────────────────
-- Ships together with the deck writer even though Phase 1's UI only calls that one:
-- the two tables are symmetric, mig 168's remediation access check already READS
-- learning_goal_concepts, and leaving one half writer-less is exactly how this gap
-- happened. Concept access reuses the concept visibility rule from mig 165/167:
-- own private concepts, or curated ones (owner_user_id IS NULL).
CREATE OR REPLACE FUNCTION public.set_learning_goal_concepts(
  p_goal_id  uuid,
  p_concepts jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_item       jsonb;
  v_concept_id uuid;
  v_importance numeric;
  v_count      integer;
  v_seen       uuid[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_concepts IS NULL OR jsonb_typeof(p_concepts) <> 'array' THEN
    RAISE EXCEPTION 'concepts must be a JSON array' USING ERRCODE = 'P0002';
  END IF;

  v_count := jsonb_array_length(p_concepts);
  IF v_count > 200 THEN
    RAISE EXCEPTION 'Maximum 200 concepts per goal' USING ERRCODE = 'P0006';
  END IF;
  IF octet_length(p_concepts::text) > 16384 THEN
    RAISE EXCEPTION 'concepts payload exceeds 16KiB limit' USING ERRCODE = 'P0006';
  END IF;

  PERFORM 1 FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal not found, not owned, or archived' USING ERRCODE = 'P0003';
  END IF;

  DELETE FROM learning_goal_concepts WHERE goal_id = p_goal_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_concepts)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' OR COALESCE(v_item->>'concept_id', '') = '' THEN
      RAISE EXCEPTION 'Each concept entry needs a concept_id' USING ERRCODE = 'P0002';
    END IF;
    BEGIN
      v_concept_id := (v_item->>'concept_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'concept_id must be a uuid' USING ERRCODE = 'P0002';
    END;

    IF v_concept_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate concept_id %', v_concept_id USING ERRCODE = 'P0002';
    END IF;
    v_seen := v_seen || v_concept_id;

    IF v_item ? 'importance' AND v_item->>'importance' IS NOT NULL THEN
      IF jsonb_typeof(v_item->'importance') <> 'number' THEN
        RAISE EXCEPTION 'importance must be a number' USING ERRCODE = 'P0002';
      END IF;
      v_importance := (v_item->>'importance')::numeric;
      IF v_importance < 0 OR v_importance > 1 THEN
        RAISE EXCEPTION 'importance must be between 0 and 1' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      v_importance := 0.5;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM learning_concepts
       WHERE id = v_concept_id
         AND (owner_user_id = v_uid OR owner_user_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'Concept % not found or inaccessible', v_concept_id USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO learning_goal_concepts (goal_id, concept_id, importance)
    VALUES (p_goal_id, v_concept_id, v_importance);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id, 'concept_count', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_learning_goal_concepts(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_learning_goal_concepts(uuid, jsonb) TO authenticated;
