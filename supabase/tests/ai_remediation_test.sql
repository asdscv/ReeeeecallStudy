-- AI remediation metering/persistence regression test (migration 163).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits('e1000000-0000-4000-8000-000000000001'::uuid, 1000000, 'admin_grant', 'remediation_test');

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE goal_id uuid; other_goal uuid; goal_result jsonb; reservation jsonb; job public.ai_generation_jobs%ROWTYPE;
BEGIN
  goal_result := create_learning_goal('labor-law', 'Labor exam', 20, NULL, '{}'::jsonb, '{}'::jsonb);
  goal_id := (goal_result->>'goal_id')::uuid;
  INSERT INTO learning_goals (user_id, domain_id, title, daily_minutes)
    VALUES ('e2000000-0000-4000-8000-000000000002', 'labor-law', 'Other', 20)
    RETURNING id INTO other_goal;

  reservation := reserve_ai_remediation('explain', goal_id, NULL, NULL, '{}'::uuid[], '{}'::uuid[]);
  SELECT * INTO job FROM ai_generation_jobs WHERE id = reservation->>'job_ref';
  ASSERT job.job_kind = 'remediation', format('wrong job kind: %s', job.job_kind);
  ASSERT job.billable_fraction = 1 AND job.free_cards = 0 AND job.paid_cards = 1,
    format('wrong billing split: %s/%s/%s', job.billable_fraction, job.free_cards, job.paid_cards);

  BEGIN
    PERFORM reserve_ai_remediation('explain', other_goal, NULL, NULL, '{}'::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'expected inaccessible goal rejection';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  BEGIN
    PERFORM reserve_ai_remediation('chat', goal_id, NULL, NULL, '{}'::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'expected invalid action rejection';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.reserve_ai_remediation(text,uuid,uuid,uuid,uuid[],uuid[])', 'EXECUTE'), 'anon reserve grant';
  ASSERT has_function_privilege('authenticated', 'public.reserve_ai_remediation(text,uuid,uuid,uuid,uuid[],uuid[])', 'EXECUTE'), 'authenticated reserve grant';
  -- Signature is the 13-arg one since mig 176 (+ p_attempt_id). The drop-and-recreate loses
  -- mig 168's grants, so these two assertions are what catch a forgotten re-GRANT.
  -- anon as well as authenticated: default privileges grant EXECUTE to BOTH client roles
  -- directly, so revoking one and forgetting the other still leaves the function reachable.
  ASSERT NOT has_function_privilege('anon', 'public.persist_ai_remediation(uuid,text,jsonb,uuid[],uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE'), 'anon persist grant';
  ASSERT NOT has_function_privilege('authenticated', 'public.persist_ai_remediation(uuid,text,jsonb,uuid[],uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE'), 'authenticated persist grant';
  ASSERT has_function_privilege('service_role', 'public.persist_ai_remediation(uuid,text,jsonb,uuid[],uuid,uuid,uuid,uuid,text,text,text,text,uuid)', 'EXECUTE'), 'service persist grant';
  -- The PARAMETER NAME, not just the arity. The only production caller is PostgREST
  -- (`service.rpc('persist_ai_remediation', { p_attempt_id: ... })`), which binds by name — so
  -- renaming the parameter would keep every positional assertion here green while silently
  -- dropping provenance on every real call.
  ASSERT 'p_attempt_id' = ANY (SELECT unnest(proargnames) FROM pg_proc WHERE proname = 'persist_ai_remediation'),
    'persist_ai_remediation must expose the attempt id as p_attempt_id (PostgREST binds by name)';
  -- The 12-arg version must be GONE, not merely superseded: an overload left alive would let
  -- an un-updated caller write enrichments with no attempt provenance, silently.
  ASSERT (SELECT count(*) FROM pg_proc WHERE proname = 'persist_ai_remediation') = 1,
    'persist_ai_remediation must exist exactly once (stale overload left behind)';
  ASSERT (SELECT pronargs FROM pg_proc WHERE proname = 'persist_ai_remediation') = 13,
    'persist_ai_remediation must take the attempt id';
END $$;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$
DECLARE goal_id uuid; enrichment_id uuid; linked_enrichment_id uuid; shared_concept_id uuid; row_count integer; remediation_job text; paid_before integer; paid_after integer;
BEGIN
  SELECT id INTO remediation_job FROM ai_generation_jobs
    WHERE user_id = 'e1000000-0000-4000-8000-000000000001' AND job_kind = 'remediation' AND NOT refunded LIMIT 1;
  UPDATE ai_generation_usage SET paid_cards_used = 7
    WHERE user_id = 'e1000000-0000-4000-8000-000000000001'
    RETURNING paid_cards_used INTO paid_before;
  PERFORM release_ai_job('e1000000-0000-4000-8000-000000000001', remediation_job);
  SELECT paid_cards_used INTO paid_after FROM ai_generation_usage
    WHERE user_id = 'e1000000-0000-4000-8000-000000000001';
  ASSERT paid_before = 7 AND paid_after = 7, format('remediation release changed legacy paid counter: %s -> %s', paid_before, paid_after);

  SELECT id INTO goal_id FROM learning_goals
    WHERE user_id = 'e1000000-0000-4000-8000-000000000001' AND title = 'Labor exam';
  enrichment_id := persist_ai_remediation(
    'e1000000-0000-4000-8000-000000000001', 'explain',
    '{"action":"explain","summary":"Grounded","blocks":[{"type":"text","content":"x"}],"citations":[],"warnings":[]}'::jsonb,
    '{}'::uuid[], goal_id, NULL, NULL, NULL, 'fp', 'model', 'provider', 'remediation-v1'
  );
  SELECT count(*) INTO row_count FROM user_enrichments
    WHERE id = enrichment_id AND user_id = 'e1000000-0000-4000-8000-000000000001'
      AND status = 'preview' AND action = 'explain';
  ASSERT row_count = 1, 'service persistence failed';

  INSERT INTO learning_concepts (owner_user_id, domain_id, concept_key, title)
    VALUES (NULL, 'labor-law', 'shared-persist-guard', 'Shared persistence guard')
    RETURNING id INTO shared_concept_id;
  BEGIN
    PERFORM persist_ai_remediation(
      'e1000000-0000-4000-8000-000000000001', 'explain',
      '{"action":"explain","summary":"x","blocks":[],"citations":[],"warnings":[]}'::jsonb,
      '{}'::uuid[], goal_id, shared_concept_id, NULL, NULL, 'fp2', 'model', 'provider', 'remediation-v1'
    );
    RAISE EXCEPTION 'expected unlinked shared concept rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  INSERT INTO learning_goal_concepts (goal_id, concept_id) VALUES (goal_id, shared_concept_id);
  linked_enrichment_id := persist_ai_remediation(
    'e1000000-0000-4000-8000-000000000001', 'explain',
    '{"action":"explain","summary":"linked","blocks":[],"citations":[],"warnings":[]}'::jsonb,
    '{}'::uuid[], goal_id, shared_concept_id, NULL, NULL, 'fp3', 'model', 'provider', 'remediation-v1'
  );
  ASSERT EXISTS (SELECT 1 FROM user_enrichments WHERE id = linked_enrichment_id AND concept_id = shared_concept_id),
    'linked shared concept persistence failed';

  UPDATE learning_goals SET status = 'archived' WHERE id = goal_id;
  BEGIN
    PERFORM persist_ai_remediation(
      'e1000000-0000-4000-8000-000000000001', 'explain',
      '{"action":"explain","summary":"x","blocks":[],"citations":[],"warnings":[]}'::jsonb,
      '{}'::uuid[], goal_id, NULL, NULL, NULL, 'fp4', 'model', 'provider', 'remediation-v1'
    );
    RAISE EXCEPTION 'expected archived goal persistence rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ── mig 176: attempt provenance ─────────────────────────────────────────────
--
-- The whole point of grounding a paid answer in an attempt is being able to say later WHICH
-- failure it was about. A truncated request_fingerprint cannot do that, so the column is what
-- these assertions defend — plus the ownership check, which is newly reachable from the UI.
DO $$
DECLARE
  own_attempt uuid; foreign_attempt uuid; enrichment_id uuid;
  own_activity uuid; other_activity uuid;
  own_user constant uuid := 'e1000000-0000-4000-8000-000000000001';
  other_user constant uuid := 'e2000000-0000-4000-8000-000000000002';
BEGIN
  -- `attempt_activity_or_card_required` (mig 165) means an attempt must reference an activity
  -- or a card. A private activity per user is the cheapest fixture that satisfies it without
  -- dragging deck/card-limit machinery into a remediation test.
  INSERT INTO learning_activities
    (owner_user_id, activity_type, stimulus_type, response_type, evaluator_type, title)
  VALUES (own_user, 'recall', 'text', 'self_rate', 'self_rate', 'own item')
  RETURNING id INTO own_activity;
  INSERT INTO learning_activities
    (owner_user_id, activity_type, stimulus_type, response_type, evaluator_type, title)
  VALUES (other_user, 'recall', 'text', 'self_rate', 'self_rate', 'other item')
  RETURNING id INTO other_activity;

  INSERT INTO answer_attempts
    (user_id, activity_id, client_attempt_id, activity_type, response_type, evaluator_type,
     response, normalized_score, evaluator_result)
  VALUES
    (own_user, own_activity, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
     '{"self_rated":0}'::jsonb, 0, '{"evaluator":"self_rate","score":0}'::jsonb)
  RETURNING id INTO own_attempt;
  INSERT INTO answer_attempts
    (user_id, activity_id, client_attempt_id, activity_type, response_type, evaluator_type,
     response, normalized_score)
  VALUES
    (other_user, other_activity, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
     '{"self_rated":0}'::jsonb, 0)
  RETURNING id INTO foreign_attempt;

  -- Persisted and readable back: the enrichment knows the failure it answered.
  enrichment_id := persist_ai_remediation(
    own_user, 'explain',
    '{"action":"explain","summary":"grounded in an attempt","blocks":[{"type":"text","content":"x"}],"citations":[],"warnings":[]}'::jsonb,
    '{}'::uuid[], NULL, NULL, NULL, NULL, 'fp-attempt', 'model', 'provider', 'remediation-v2',
    own_attempt
  );
  ASSERT EXISTS (SELECT 1 FROM user_enrichments WHERE id = enrichment_id AND attempt_id = own_attempt),
    'attempt provenance was not stored';
  ASSERT (SELECT prompt_version FROM user_enrichments WHERE id = enrichment_id) = 'remediation-v2',
    'prompt version not recorded';

  -- Another learner's attempt must not become provenance for this learner's enrichment. The
  -- reserve step checks against auth.uid(), but persist runs as service_role with a supplied
  -- user id and therefore cannot inherit that check.
  BEGIN
    PERFORM persist_ai_remediation(
      own_user, 'explain',
      '{"action":"explain","summary":"x","blocks":[],"citations":[],"warnings":[]}'::jsonb,
      '{}'::uuid[], NULL, NULL, NULL, NULL, 'fp-foreign', 'model', 'provider', 'remediation-v2',
      foreign_attempt
    );
    RAISE EXCEPTION 'expected foreign attempt rejection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Deleting the attempt must not delete an answer the learner may have paid for and kept.
  DELETE FROM answer_attempts WHERE id = own_attempt;
  ASSERT EXISTS (SELECT 1 FROM user_enrichments WHERE id = enrichment_id AND attempt_id IS NULL),
    'enrichment must survive its attempt (ON DELETE SET NULL)';
END $$;

-- ── the attempt must be an attempt ON the card the enrichment is about ───────
--
-- Ownership alone is not enough: both cards below belong to the SAME learner, so the only
-- thing that can distinguish them is the pair check. That is what makes the negative case
-- below meaningful — a rejection here cannot be blamed on ownership, access, or auth, and
-- the positive case immediately above it proves the card really is reachable.
DO $$
DECLARE
  own_template uuid; own_deck uuid; card_a uuid; card_b uuid;
  attempt_on_a uuid; enrichment_id uuid;
  own_user constant uuid := 'e1000000-0000-4000-8000-000000000001';
  payload constant jsonb :=
    '{"action":"explain","summary":"x","blocks":[{"type":"text","content":"x"}],"citations":[],"warnings":[]}'::jsonb;
BEGIN
  INSERT INTO card_templates (user_id, name) VALUES (own_user, 'remediation tpl')
    RETURNING id INTO own_template;
  INSERT INTO decks (user_id, name) VALUES (own_user, 'remediation deck')
    RETURNING id INTO own_deck;
  -- created_at well in the past so `get_active_card_threshold()` can never make these cards
  -- inactive and turn an access failure into a false pass for the pair check.
  INSERT INTO cards (deck_id, user_id, template_id, sort_position, created_at,
                     srs_status, interval_days, ease_factor, repetitions)
  VALUES (own_deck, own_user, own_template, 1, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0)
  RETURNING id INTO card_a;
  INSERT INTO cards (deck_id, user_id, template_id, sort_position, created_at,
                     srs_status, interval_days, ease_factor, repetitions)
  VALUES (own_deck, own_user, own_template, 2, '2020-01-01T00:00:00Z', 'new', 0, 2.5, 0)
  RETURNING id INTO card_b;

  INSERT INTO answer_attempts
    (user_id, card_id, client_attempt_id, activity_type, response_type, evaluator_type,
     response, normalized_score)
  VALUES (own_user, card_a, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
          '{"self_rated":0}'::jsonb, 0)
  RETURNING id INTO attempt_on_a;

  -- POSITIVE CONTROL: the matching pair is accepted and stored.
  enrichment_id := persist_ai_remediation(
    own_user, 'explain', payload, '{}'::uuid[], NULL, NULL, card_a, NULL,
    'fp-pair-ok', 'model', 'provider', 'remediation-v2', attempt_on_a
  );
  ASSERT EXISTS (
    SELECT 1 FROM user_enrichments
    WHERE id = enrichment_id AND card_id = card_a AND attempt_id = attempt_on_a
  ), 'a matching card/attempt pair must be accepted';

  -- NEGATIVE: same learner, same deck, reachable card — only the pair is wrong.
  BEGIN
    PERFORM persist_ai_remediation(
      own_user, 'explain', payload, '{}'::uuid[], NULL, NULL, card_b, NULL,
      'fp-pair-mismatch', 'model', 'provider', 'remediation-v2', attempt_on_a
    );
    RAISE EXCEPTION 'expected rejection of an attempt on a different card';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- And the rejection wrote nothing.
  ASSERT NOT EXISTS (SELECT 1 FROM user_enrichments WHERE request_fingerprint = 'fp-pair-mismatch'),
    'a rejected pair must not leave an enrichment row behind';

  -- An ACTIVITY-only attempt (card_id IS NULL) paired with a card reference is legitimate —
  -- `attempt_activity_or_card_required` (mig 165) allows it and `reserve_ai_remediation` accepts
  -- any combination. The pair check must stay silent here; a stricter check would 42501 a valid
  -- request. This is the assertion that keeps the guard above from over-reaching.
  DECLARE
    activity_attempt uuid; own_activity uuid;
  BEGIN
    INSERT INTO learning_activities
      (owner_user_id, activity_type, stimulus_type, response_type, evaluator_type, title)
    VALUES (own_user, 'recall', 'text', 'self_rate', 'self_rate', 'activity-only item')
    RETURNING id INTO own_activity;
    INSERT INTO answer_attempts
      (user_id, activity_id, client_attempt_id, activity_type, response_type, evaluator_type,
       response, normalized_score)
    VALUES (own_user, own_activity, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
            '{"self_rated":0}'::jsonb, 0)
    RETURNING id INTO activity_attempt;

    enrichment_id := persist_ai_remediation(
      own_user, 'explain', payload, '{}'::uuid[], NULL, NULL, card_a, NULL,
      'fp-activity-attempt', 'model', 'provider', 'remediation-v2', activity_attempt
    );
    ASSERT EXISTS (SELECT 1 FROM user_enrichments WHERE id = enrichment_id AND attempt_id = activity_attempt),
      'an activity-only attempt must still be accepted alongside a card reference';
  END;

  -- Named-argument call: pins that PostgREST's `p_attempt_id` binding still resolves.
  enrichment_id := persist_ai_remediation(
    p_user_id => own_user, p_action => 'explain', p_content => payload,
    p_card_id => card_a, p_prompt_version => 'remediation-v2', p_attempt_id => attempt_on_a
  );
  ASSERT EXISTS (SELECT 1 FROM user_enrichments WHERE id = enrichment_id AND attempt_id = attempt_on_a),
    'named-argument persist must store the attempt id';
END $$;

-- The reserve step refuses a foreign attempt too — newly reachable now that a client sends one.
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', false);
DO $$
DECLARE foreign_attempt uuid; other_activity uuid; own_activity uuid; own_attempt uuid; reservation jsonb;
BEGIN
  INSERT INTO learning_activities
    (owner_user_id, activity_type, stimulus_type, response_type, evaluator_type, title)
  VALUES ('e2000000-0000-4000-8000-000000000002', 'recall', 'text', 'self_rate', 'self_rate', 'other item 2')
  RETURNING id INTO other_activity;
  INSERT INTO answer_attempts
    (user_id, activity_id, client_attempt_id, activity_type, response_type, evaluator_type, response, normalized_score)
  VALUES
    ('e2000000-0000-4000-8000-000000000002', other_activity, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
     '{"self_rated":0}'::jsonb, 0)
  RETURNING id INTO foreign_attempt;

  -- POSITIVE CONTROL FIRST. `reserve_ai_remediation` raises the SAME 42501 for "Authentication
  -- required", so asserting only the rejection below would stay green even if reserve rejected
  -- EVERY attempt — or rejected because the JWT claims had drifted. Proving the learner's own
  -- attempt is accepted is what makes the rejection mean "because it is not yours".
  INSERT INTO learning_activities
    (owner_user_id, activity_type, stimulus_type, response_type, evaluator_type, title)
  VALUES ('e1000000-0000-4000-8000-000000000001', 'recall', 'text', 'self_rate', 'self_rate', 'own item 2')
  RETURNING id INTO own_activity;
  INSERT INTO answer_attempts
    (user_id, activity_id, client_attempt_id, activity_type, response_type, evaluator_type, response, normalized_score)
  VALUES
    ('e1000000-0000-4000-8000-000000000001', own_activity, gen_random_uuid(), 'recall', 'self_rate', 'self_rate',
     '{"self_rated":0}'::jsonb, 0)
  RETURNING id INTO own_attempt;

  reservation := reserve_ai_remediation('explain', NULL, NULL, own_attempt, '{}'::uuid[], '{}'::uuid[]);
  ASSERT reservation ? 'job_ref', 'the learner''s own attempt must be reservable';

  BEGIN
    PERFORM reserve_ai_remediation('explain', NULL, NULL, foreign_attempt, '{}'::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'expected foreign attempt reservation rejection';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;

ROLLBACK;
