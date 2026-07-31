-- ============================================================================
-- study_recommendation_test.sql — the recommendation writers (mig 174).
--
-- WHY THIS EXISTS. mig 165 created study_recommendations and nothing ever wrote it: no RPC,
-- no edge function, no client. Phase 4 refused to render a permanently empty feed, and mig
-- 174 finally gives the table a writer. These assertions pin the two properties that make it
-- worth writing at all:
--
--   * REGENERATION MUST NOT ERASE A DECISION. Only 'pending' rows are replaced. An accepted
--     or dismissed recommendation is the learner's answer, and re-proposing something they
--     dismissed would be the product arguing with them.
--   * A DECISION IS TERMINAL. Only 'pending' can transition, so a stale tab cannot flip an
--     accept into a dismiss later.
--
-- Plus the usual money-adjacent hygiene: ownership, reference entitlement, duplicate
-- rejection, size caps, and the rule that a recommendation must point at SOMETHING.
--
-- Runs in a txn and ROLLBACKs. psql does not substitute :vars inside dollar-quoted blocks,
-- so ids are written out:
--   owner  d1000000-0000-4000-8000-000000000001
--   other  d2000000-0000-4000-8000-000000000002
--   goal   d1500000-0000-4000-8000-000000000001
--   goalAr d1500000-0000-4000-8000-000000000002  (archived)
--   cardA  d1300000-0000-4000-8000-0000000000a1
--   cardB  d1300000-0000-4000-8000-0000000000b2
--   cardX  d2300000-0000-4000-8000-0000000000c3  (other user's)
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES
  ('d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO card_templates (id, user_id, name) VALUES
  ('d1100000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'T1'),
  ('d2100000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'T2');
INSERT INTO decks (id, user_id, name) VALUES
  ('d1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Owner deck'),
  ('d2200000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'Other deck');
INSERT INTO cards (id, deck_id, user_id, template_id, sort_position, created_at,
                   srs_status, interval_days, ease_factor, repetitions) VALUES
  ('d1300000-0000-4000-8000-0000000000a1', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001',
   1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0),
  ('d1300000-0000-4000-8000-0000000000b2', 'd1200000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 'd1100000-0000-4000-8000-000000000001',
   2, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0),
  ('d2300000-0000-4000-8000-0000000000c3', 'd2200000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000002', 'd2100000-0000-4000-8000-000000000002',
   1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0);

INSERT INTO learning_goals (id, user_id, domain_id, title, daily_minutes, status) VALUES
  ('d1500000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'language', 'Goal', 20, 'active'),
  ('d1500000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'language', 'Archived', 20, 'archived');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

-- ═══ 1) write, then replace ═════════════════════════════════════════════════
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.set_study_recommendations(
    'd1500000-0000-4000-8000-000000000001'::uuid,
    '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card","reason":"mean 20% over 3 attempts"},
      {"card_id":"d1300000-0000-4000-8000-0000000000b2","action_type":"review_card"}]'::jsonb,
    'algorithm', 'weak-card-v1');
  ASSERT (v_res->>'count')::int = 2, 'two recommendations written';
  ASSERT (SELECT count(*) FROM study_recommendations
           WHERE goal_id = 'd1500000-0000-4000-8000-000000000001') = 2, 'both rows exist';
  ASSERT (SELECT provider FROM study_recommendations
           WHERE card_id = 'd1300000-0000-4000-8000-0000000000a1') = 'algorithm',
    'the producer is recorded, not assumed';
  ASSERT (SELECT algorithm_version FROM study_recommendations
           WHERE card_id = 'd1300000-0000-4000-8000-0000000000a1') = 'weak-card-v1',
    'the algorithm version is recorded so quality is measurable per source';
  ASSERT (SELECT reason FROM study_recommendations
           WHERE card_id = 'd1300000-0000-4000-8000-0000000000a1') = 'mean 20% over 3 attempts',
    'the evidence is stored with the suggestion';
  ASSERT (SELECT status FROM study_recommendations
           WHERE card_id = 'd1300000-0000-4000-8000-0000000000b2') = 'pending',
    'new rows start pending';

  -- Regeneration with only one card replaces the pending set.
  PERFORM public.set_study_recommendations(
    'd1500000-0000-4000-8000-000000000001'::uuid,
    '[{"card_id":"d1300000-0000-4000-8000-0000000000b2","action_type":"review_card"}]'::jsonb,
    'algorithm', 'weak-card-v1');
  ASSERT (SELECT count(*) FROM study_recommendations
           WHERE goal_id = 'd1500000-0000-4000-8000-000000000001') = 1,
    'the pending set was replaced, not appended to';
END $$;

-- ═══ 2) THE POINT OF THE TABLE: decisions survive regeneration ══════════════
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM study_recommendations
   WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' AND status = 'pending';
  PERFORM public.set_study_recommendation_status(v_id, 'dismissed');
  ASSERT (SELECT status FROM study_recommendations WHERE id = v_id) = 'dismissed',
    'the dismissal was recorded';

  -- The producer re-proposes the same card, as a stateless producer would.
  PERFORM public.set_study_recommendations(
    'd1500000-0000-4000-8000-000000000001'::uuid,
    '[{"card_id":"d1300000-0000-4000-8000-0000000000b2","action_type":"review_card"}]'::jsonb,
    'algorithm', 'weak-card-v1');

  ASSERT (SELECT status FROM study_recommendations WHERE id = v_id) = 'dismissed',
    'a regeneration must NOT erase the learner''s dismissal';
  ASSERT (SELECT count(*) FROM study_recommendations
           WHERE goal_id = 'd1500000-0000-4000-8000-000000000001') = 2,
    'the dismissed row is kept alongside the fresh pending one';
END $$;

-- ═══ 3) a decision is terminal ══════════════════════════════════════════════
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM study_recommendations
   WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' AND status = 'pending';
  PERFORM public.set_study_recommendation_status(v_id, 'accepted');

  BEGIN
    -- A stale tab must not be able to flip an accept into a dismiss.
    PERFORM public.set_study_recommendation_status(v_id, 'dismissed');
    ASSERT false, 'a finalized recommendation must not transition again';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN NULL;
  END;
  ASSERT (SELECT status FROM study_recommendations WHERE id = v_id) = 'accepted',
    'the original decision stands';

  BEGIN
    PERFORM public.set_study_recommendation_status(v_id, 'expired');
    ASSERT false, 'only accepted/dismissed are caller-settable';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
END $$;

-- ═══ 4) payload validation ══════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN  -- a suggestion that points at nothing cannot be acted on
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"action_type":"review_card"}]'::jsonb);
    ASSERT false, 'a recommendation with no target must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d1300000-0000-4000-8000-0000000000a1"}]'::jsonb);
    ASSERT false, 'a recommendation with no action_type must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"},
        {"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'a duplicate target must be rejected, not collapsed';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"nope","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'a malformed uuid must surface as P0002, not 22P02';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      (SELECT jsonb_agg(jsonb_build_object('card_id', gen_random_uuid(), 'action_type', 'review_card'))
         FROM generate_series(1, 51)));
    ASSERT false, 'more than 50 recommendations must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0006' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"}]'::jsonb, '');
    ASSERT false, 'an empty provider must be rejected — the source has to be recorded';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
END $$;

-- ═══ 5) entitlement and goal state ══════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d2300000-0000-4000-8000-0000000000c3","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'another user''s card must not be recommendable';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000002'::uuid,
      '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'an archived goal must not accept recommendations';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  BEGIN
    PERFORM public.set_study_recommendations(gen_random_uuid(),
      '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'an unknown goal must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END $$;

-- ═══ 6) a partially-bad batch leaves the previous pending set intact ════════
-- The function DELETEs the pending rows before inserting, so this is the assertion that
-- matters: a failure halfway through must not empty the feed.
DO $$
DECLARE v_before integer;
BEGIN
  PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
    '[{"card_id":"d1300000-0000-4000-8000-0000000000a1","action_type":"review_card"}]'::jsonb);
  SELECT count(*) INTO v_before FROM study_recommendations
   WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' AND status = 'pending';
  ASSERT v_before = 1, 'one pending row before the bad batch';

  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d1300000-0000-4000-8000-0000000000b2","action_type":"review_card"},
        {"card_id":"d2300000-0000-4000-8000-0000000000c3","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'the batch should have failed on the inaccessible card';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  ASSERT (SELECT count(*) FROM study_recommendations
           WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' AND status = 'pending') = 1,
    'the failed batch left the previous pending set intact';
  ASSERT (SELECT card_id FROM study_recommendations
           WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' AND status = 'pending')
         = 'd1300000-0000-4000-8000-0000000000a1'::uuid,
    'and it is still the row that was there before';
END $$;

-- ═══ 7) authorization ═══════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000002', true);
DO $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    PERFORM public.set_study_recommendations('d1500000-0000-4000-8000-000000000001'::uuid,
      '[{"card_id":"d2300000-0000-4000-8000-0000000000c3","action_type":"review_card"}]'::jsonb);
    ASSERT false, 'another signed-in user must not write this goal''s recommendations';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  SELECT id INTO v_id FROM study_recommendations
   WHERE goal_id = 'd1500000-0000-4000-8000-000000000001' LIMIT 1;
  BEGIN
    PERFORM public.set_study_recommendation_status(v_id, 'dismissed');
    ASSERT false, 'another user must not resolve someone else''s recommendation';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

DO $$
BEGIN
  -- The table stays write-closed to clients: the RPCs are the only door.
  ASSERT has_table_privilege('authenticated','public.study_recommendations','INSERT') = false,
    'study_recommendations must stay RPC-only for writes';
  ASSERT has_table_privilege('authenticated','public.study_recommendations','SELECT') = true,
    'owners still read their own recommendations through RLS';
  ASSERT has_function_privilege('anon','public.set_study_recommendations(uuid,jsonb,text,text)','EXECUTE') = false,
    'anon must not execute the writer';
  ASSERT has_function_privilege('authenticated','public.set_study_recommendation_status(uuid,text)','EXECUTE') = true,
    'authenticated must execute the status setter';
END $$;

ROLLBACK;
