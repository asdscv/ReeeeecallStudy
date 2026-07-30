-- ============================================================================
-- learning_goal_links_test.sql — the goal→deck / goal→concept writers (mig 172).
--
-- WHY THIS EXISTS. mig 165 created both join tables with owner-SELECT RLS and no
-- client write path, and mig 167 never shipped the RPC that writes them. A goal
-- could be created and nothing could ever be attached to it, which silently made
-- the daily planner unusable: goalRelevance is 0.20 of daily-plan-v1's priority and
-- had no input at all. These assertions pin the writer's contract so the tables
-- cannot drift back to being unreachable, and so the entitlement check cannot be
-- loosened without a red test.
--
-- Covered:
--   set_learning_goal_decks     attach / replace-all / detach-all, importance
--                               default + range, duplicate rejection, deck
--                               entitlement (own vs another user's), goal
--                               ownership + archived, size cap, atomicity of a
--                               partially-bad batch, anon refusal
--   set_learning_goal_concepts  curated (owner NULL) allowed, another user's
--                               private concept refused
--   _check_deck_access          stays internal (no client role may execute it)
--
-- Runs in a txn and ROLLBACKs → leaves no data. psql does not substitute :vars
-- inside dollar-quoted blocks, so ids are written out:
--   owner  b1000000-0000-4000-8000-000000000001
--   other  b2000000-0000-4000-8000-000000000002
--   deckA  b1200000-0000-4000-8000-0000000000a1
--   deckB  b1200000-0000-4000-8000-0000000000b2
--   deckX  b2200000-0000-4000-8000-0000000000c3   (owned by `other`)
--   goal   b1500000-0000-4000-8000-000000000001
--   goalAr b1500000-0000-4000-8000-000000000002   (archived)
--   conCur b1600000-0000-4000-8000-0000000000a1   (curated, owner NULL)
--   conOth b1600000-0000-4000-8000-0000000000b2   (private to `other`)
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO decks (id, user_id, name) VALUES
  ('b1200000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-000000000001', 'Owner deck A'),
  ('b1200000-0000-4000-8000-0000000000b2', 'b1000000-0000-4000-8000-000000000001', 'Owner deck B'),
  ('b2200000-0000-4000-8000-0000000000c3', 'b2000000-0000-4000-8000-000000000002', 'Other user deck');

INSERT INTO learning_goals (id, user_id, domain_id, title, daily_minutes, status) VALUES
  ('b1500000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'language', 'Goal under test', 20, 'active'),
  ('b1500000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'language', 'Archived goal', 20, 'archived');

INSERT INTO learning_concepts (id, owner_user_id, domain_id, concept_key, title) VALUES
  ('b1600000-0000-4000-8000-0000000000a1', NULL, 'language', 'curated-key-1', 'Curated concept'),
  ('b1600000-0000-4000-8000-0000000000b2', 'b2000000-0000-4000-8000-000000000002', 'language', 'private-key-1', 'Other user concept');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

-- ═══ 1) attach, replace-all, detach-all ═════════════════════════════════════
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.set_learning_goal_decks(
    'b1500000-0000-4000-8000-000000000001'::uuid,
    '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1","importance":0.9},
      {"deck_id":"b1200000-0000-4000-8000-0000000000b2"}]'::jsonb);
  ASSERT (v_res->>'ok')::boolean AND (v_res->>'deck_count')::int = 2, 'two decks attached';
  ASSERT (SELECT count(*) FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 2, 'both rows exist';
  ASSERT (SELECT importance FROM learning_goal_decks
           WHERE deck_id = 'b1200000-0000-4000-8000-0000000000a1') = 0.9,
    'explicit importance is stored';
  ASSERT (SELECT importance FROM learning_goal_decks
           WHERE deck_id = 'b1200000-0000-4000-8000-0000000000b2') = 0.5,
    'omitted importance defaults to 0.5, not 0 (missing evidence is neutral)';

  -- REPLACE-ALL, not merge: the client sends the full desired set.
  v_res := public.set_learning_goal_decks(
    'b1500000-0000-4000-8000-000000000001'::uuid,
    '[{"deck_id":"b1200000-0000-4000-8000-0000000000b2","importance":0.1}]'::jsonb);
  ASSERT (SELECT count(*) FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 1, 'the set was replaced';
  ASSERT (SELECT deck_id FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001')
         = 'b1200000-0000-4000-8000-0000000000b2'::uuid, 'the surviving row is the sent one';
  ASSERT (SELECT importance FROM learning_goal_decks
           WHERE deck_id = 'b1200000-0000-4000-8000-0000000000b2') = 0.1,
    'importance is updated by the replace';

  -- Detach everything: legal and meaningful (a goal with no decks plans nothing).
  v_res := public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid, '[]'::jsonb);
  ASSERT (v_res->>'deck_count')::int = 0 AND (SELECT count(*) FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 0,
    'an empty array detaches every deck';
END $$;

-- ═══ 2) payload validation ══════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN  -- duplicates are a caller bug, not something to collapse silently
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1"},
        {"deck_id":"b1200000-0000-4000-8000-0000000000a1"}]'::jsonb);
    ASSERT false, 'a duplicate deck_id must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1","importance":1.5}]'::jsonb);
    ASSERT false, 'importance above 1 must be rejected, not clamped';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1","importance":"high"}]'::jsonb);
    ASSERT false, 'a non-numeric importance must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"importance":0.5}]'::jsonb);
    ASSERT false, 'an entry without deck_id must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"not-a-uuid"}]'::jsonb);
    ASSERT false, 'a malformed deck_id must be rejected as P0002, not leak 22P02';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '{"deck_id":"b1200000-0000-4000-8000-0000000000a1"}'::jsonb);
    ASSERT false, 'a non-array payload must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN  -- 51 entries → over the cap
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      (SELECT jsonb_agg(jsonb_build_object('deck_id', gen_random_uuid())) FROM generate_series(1, 51)));
    ASSERT false, 'more than 50 decks must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN NULL;
  END;
END $$;

-- ═══ 3) entitlement and goal state ══════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b2200000-0000-4000-8000-0000000000c3"}]'::jsonb);
    ASSERT false, 'another user''s deck must not be attachable';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  BEGIN  -- an archived goal is inert; save_daily_plan refuses it too (P0003)
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000002'::uuid,
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1"}]'::jsonb);
    ASSERT false, 'an archived goal must not accept deck links';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_learning_goal_decks(gen_random_uuid(),
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1"}]'::jsonb);
    ASSERT false, 'an unknown goal must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END $$;

-- ═══ 4) atomicity — a partially-bad batch changes nothing ═══════════════════
-- The function DELETEs before it INSERTs, so this is the assertion that matters:
-- a failure halfway through must leave the previous set intact, not an empty goal.
DO $$
BEGIN
  PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
    '[{"deck_id":"b1200000-0000-4000-8000-0000000000a1","importance":0.7}]'::jsonb);

  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b1200000-0000-4000-8000-0000000000b2"},
        {"deck_id":"b2200000-0000-4000-8000-0000000000c3"}]'::jsonb);
    ASSERT false, 'the batch should have failed on the inaccessible deck';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  ASSERT (SELECT count(*) FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 1,
    'the failed batch left the previous set intact';
  ASSERT (SELECT deck_id FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001')
         = 'b1200000-0000-4000-8000-0000000000a1'::uuid,
    'and it is still the deck attached before the failure';
  ASSERT (SELECT importance FROM learning_goal_decks
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 0.7,
    'with its importance unchanged';
END $$;

-- ═══ 5) concepts: curated allowed, another user's private refused ════════════
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.set_learning_goal_concepts('b1500000-0000-4000-8000-000000000001'::uuid,
    '[{"deck_id":"ignored","concept_id":"b1600000-0000-4000-8000-0000000000a1","importance":0.25}]'::jsonb);
  ASSERT (v_res->>'concept_count')::int = 1, 'a curated concept can be attached';
  ASSERT (SELECT importance FROM learning_goal_concepts
           WHERE concept_id = 'b1600000-0000-4000-8000-0000000000a1') = 0.25,
    'concept importance is stored';

  BEGIN
    PERFORM public.set_learning_goal_concepts('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"concept_id":"b1600000-0000-4000-8000-0000000000b2"}]'::jsonb);
    ASSERT false, 'another user''s private concept must not be attachable';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  ASSERT (SELECT count(*) FROM learning_goal_concepts
           WHERE goal_id = 'b1500000-0000-4000-8000-000000000001') = 1,
    'the refused concept batch left the previous set intact';
END $$;

-- ═══ 6) authorization ═══════════════════════════════════════════════════════
-- Ownership is enforced by auth.uid() inside the function, so a different signed-in
-- user must not be able to touch this goal even though the goal id is guessable.
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.set_learning_goal_decks('b1500000-0000-4000-8000-000000000001'::uuid,
      '[{"deck_id":"b2200000-0000-4000-8000-0000000000c3"}]'::jsonb);
    ASSERT false, 'another signed-in user must not write this goal''s links';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);

DO $$
BEGIN
  -- The join tables stay write-closed to clients: the RPC is the only door.
  ASSERT has_table_privilege('authenticated','public.learning_goal_decks','INSERT') = false,
    'learning_goal_decks must stay RPC-only for writes';
  ASSERT has_table_privilege('authenticated','public.learning_goal_concepts','INSERT') = false,
    'learning_goal_concepts must stay RPC-only for writes';
  ASSERT has_table_privilege('authenticated','public.learning_goal_decks','SELECT') = true,
    'owners still read their own links through RLS';
  -- The access helper is internal; exposing it would let a client enumerate deck ids.
  ASSERT has_function_privilege('authenticated','public._check_deck_access(uuid,uuid)','EXECUTE') = false,
    '_check_deck_access must not be executable by a client role';
  ASSERT has_function_privilege('anon','public.set_learning_goal_decks(uuid,jsonb)','EXECUTE') = false,
    'anon must not execute set_learning_goal_decks';
  ASSERT has_function_privilege('authenticated','public.set_learning_goal_decks(uuid,jsonb)','EXECUTE') = true,
    'authenticated must execute set_learning_goal_decks';
END $$;

ROLLBACK;
