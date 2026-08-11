-- Migration 212: a paid explanation is bought once.
--
-- `reserve_ai_remediation` minted a fresh `gen_random_uuid()` per call and consulted nothing.
-- Combined with a client that held the answer only in memory, the learner-visible result was
-- that 닫기 — a button whose Korean label is "close", not "delete" — destroyed something they
-- had been charged for, and the only way back was the paid button, which generated it again
-- from byte-identical grounding and charged again.
--
-- Pinned here:
--
--   1) A second reservation for the same (attempt, action) REPLAYS. No job, no counter, no
--      charge — and it returns the stored content, so the caller has something to render.
--   2) Replay works with an EMPTY WALLET. The learner already paid; being locked out of what
--      they own because the balance later hit zero would be the same bug wearing a hat.
--   3) A different action on the same attempt is NOT a replay. `hint` and `explain` are
--      different products.
--   4) A NEW attempt on the same card IS charged. Missing it again is a new event with new
--      grounding, and pretending otherwise would give the feature away.
--   5) An in-flight job (reserved, not charged, not refunded) is refused with 55006 rather
--      than charged twice — this is the window replay cannot see, because nothing is persisted
--      until the model answers.
--   6) A RELEASED job does not block a retry. The failure mode of a naive idempotency key.
--   7) With no attempt id there is no replay at all: the references are a loose bag of card
--      ids with no identity, and a false replay would hand back an answer to another question.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES
  ('f1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT add_ai_credits('f1000000-0000-4000-8000-000000000001'::uuid, 1000000, 'admin_grant', 'replay_test');

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_uid uuid := 'f1000000-0000-4000-8000-000000000001';
  v_deck uuid; v_template uuid; v_card uuid;
  v_attempt uuid; v_attempt2 uuid;
  v_first jsonb; v_second jsonb; v_third jsonb;
  v_jobs_before integer; v_jobs_after integer;
  v_enrichment uuid;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO card_templates (id, user_id, name)
    VALUES (gen_random_uuid(), v_uid, 'Replay template') RETURNING id INTO v_template;
  INSERT INTO decks (id, user_id, name)
    VALUES (gen_random_uuid(), v_uid, 'Replay deck') RETURNING id INTO v_deck;
  INSERT INTO cards (id, deck_id, user_id, template_id, sort_position)
    VALUES (gen_random_uuid(), v_deck, v_uid, v_template, 1) RETURNING id INTO v_card;
  -- `client_attempt_id` is NOT NULL: the table's own idempotency key for the WRITE path.
  INSERT INTO answer_attempts
    (id, user_id, card_id, client_attempt_id, activity_type, response_type, evaluator_type,
     normalized_score)
    VALUES (gen_random_uuid(), v_uid, v_card, gen_random_uuid(), 'recall', 'self_rate',
            'self_rate', 0)
    RETURNING id INTO v_attempt;
  SET LOCAL session_replication_role = origin;

  -- ── The first purchase reserves a job, as it always did ──────────────────
  v_first := reserve_ai_remediation('explain', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
  ASSERT v_first ? 'job_ref', format('first call must reserve a job: %s', v_first);
  ASSERT COALESCE((v_first->>'replay')::boolean, false) = false, 'first call must not be a replay';

  -- ── (5) A second press while the first is still running ──────────────────
  -- The job is reserved and unsettled: the model has not answered, so there is nothing in
  -- `user_enrichments` for replay to find. Before 212 this reserved a SECOND job.
  BEGIN
    PERFORM reserve_ai_remediation('explain', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
    RAISE EXCEPTION 'FAIL: a second press during the model call reserved another paid job';
  EXCEPTION WHEN sqlstate '55006' THEN NULL; END;

  -- ── (6) …but a RELEASED job must not block the retry ─────────────────────
  -- This is the failure mode of the obvious fix (a unique index on a derived key): a learner
  -- whose first request failed would be permanently unable to ask again.
  UPDATE ai_generation_jobs SET refunded = true WHERE id = v_first->>'job_ref';
  v_second := reserve_ai_remediation('explain', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
  ASSERT v_second ? 'job_ref', format('a released job must not block a retry: %s', v_second);

  -- The model answers and the result is persisted, as the edge function does.
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  v_enrichment := persist_ai_remediation(
    v_uid, 'explain', '{"summary":"bought","blocks":[{"type":"text","content":"body"}]}'::jsonb,
    '{}'::uuid[], NULL, NULL, v_card, NULL, 'fp', 'model', 'provider', 'v3', v_attempt);
  ASSERT v_enrichment IS NOT NULL, 'persist must return an id';
  UPDATE ai_generation_jobs SET charged = true WHERE id = v_second->>'job_ref';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  -- ── (1) The press after 닫기 ──────────────────────────────────────────────
  SELECT count(*) INTO v_jobs_before FROM ai_generation_jobs WHERE user_id = v_uid;
  v_third := reserve_ai_remediation('explain', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
  SELECT count(*) INTO v_jobs_after FROM ai_generation_jobs WHERE user_id = v_uid;

  ASSERT (v_third->>'replay')::boolean = true, format('second purchase was not a replay: %s', v_third);
  ASSERT v_jobs_after = v_jobs_before,
    format('FAIL: a replay reserved a billable job (%s -> %s)', v_jobs_before, v_jobs_after);
  ASSERT NOT (v_third ? 'job_ref'), 'a replay must not hand back a job to charge';
  -- Content travels with it, or the caller has nothing to show and presses again.
  ASSERT v_third->'content'->>'summary' = 'bought',
    format('replay must return the stored answer: %s', v_third);
  ASSERT (v_third->>'enrichment_id')::uuid = v_enrichment, 'replay must name the stored row';

  -- ── (3) A different product is a different purchase ──────────────────────
  DECLARE v_hint jsonb;
  BEGIN
    v_hint := reserve_ai_remediation('hint', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
    ASSERT v_hint ? 'job_ref', format('hint must not replay an explain: %s', v_hint);
    UPDATE ai_generation_jobs SET refunded = true WHERE id = v_hint->>'job_ref';
  END;

  -- ── (4) Missing the card again is a new event, and is charged ────────────
  SET LOCAL session_replication_role = replica;
  INSERT INTO answer_attempts
    (id, user_id, card_id, client_attempt_id, activity_type, response_type, evaluator_type,
     normalized_score)
    VALUES (gen_random_uuid(), v_uid, v_card, gen_random_uuid(), 'recall', 'self_rate',
            'self_rate', 0)
    RETURNING id INTO v_attempt2;
  SET LOCAL session_replication_role = origin;

  DECLARE v_new jsonb;
  BEGIN
    v_new := reserve_ai_remediation('explain', NULL, NULL, v_attempt2, ARRAY[v_card], '{}'::uuid[]);
    ASSERT v_new ? 'job_ref', format('a new attempt must be a new purchase: %s', v_new);
    ASSERT COALESCE((v_new->>'replay')::boolean, false) = false, 'a new attempt must not replay';
    UPDATE ai_generation_jobs SET refunded = true WHERE id = v_new->>'job_ref';
  END;

  -- ── (7) No attempt, no replay ────────────────────────────────────────────
  DECLARE v_loose jsonb;
  BEGIN
    v_loose := reserve_ai_remediation('explain', NULL, NULL, NULL, ARRAY[v_card], '{}'::uuid[]);
    ASSERT COALESCE((v_loose->>'replay')::boolean, false) = false,
      format('a request with no attempt must never replay: %s', v_loose);
    UPDATE ai_generation_jobs SET refunded = true WHERE id = v_loose->>'job_ref';
  END;

  -- ── (2) An empty wallet still returns what was already bought ────────────
  UPDATE ai_credit_balance SET balance = 0 WHERE user_id = v_uid;

  DECLARE v_broke jsonb;
  BEGIN
    v_broke := reserve_ai_remediation('explain', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
    ASSERT (v_broke->>'replay')::boolean = true,
      format('an empty wallet must not withhold what was already paid for: %s', v_broke);
  END;

  -- …while a NEW purchase on an empty wallet is still refused.
  BEGIN
    PERFORM reserve_ai_remediation('compare', NULL, NULL, v_attempt, ARRAY[v_card], '{}'::uuid[]);
    RAISE EXCEPTION 'FAIL: an empty wallet bought a new explanation';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  RAISE NOTICE 'remediation_replay_test: all assertions passed';
END $$;

ROLLBACK;
