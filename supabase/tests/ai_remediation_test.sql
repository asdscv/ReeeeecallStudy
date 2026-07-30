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
  ASSERT NOT has_function_privilege('authenticated', 'public.persist_ai_remediation(uuid,text,jsonb,uuid[],uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE'), 'authenticated persist grant';
  ASSERT has_function_privilege('service_role', 'public.persist_ai_remediation(uuid,text,jsonb,uuid[],uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE'), 'service persist grant';
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

ROLLBACK;
