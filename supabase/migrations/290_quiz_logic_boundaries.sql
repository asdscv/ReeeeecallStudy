-- 290: preserve answer meaning and serialize quiz lifecycle transitions.
-- Reproduced locally: -1/1, C++/C, 2.0/20, 1/2 and !!!/??? all received 100%;
-- completed runs accepted new answers; simultaneous starts collided on attempt_no.
BEGIN;

CREATE OR REPLACE FUNCTION public._quiz_exact_answer_matches(p_answer text, p_reference text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT lower(regexp_replace(normalize(coalesce(p_answer, ''), NFKC), '[[:space:]]+', '', 'g')) AS a,
           lower(regexp_replace(normalize(coalesce(p_reference, ''), NFKC), '[[:space:]]+', '', 'g')) AS r
  )
  SELECT r <> '' AND (
    a = r OR
    regexp_replace(a, '([[:alpha:]])[.。]+$', '\1') =
    regexp_replace(r, '([[:alpha:]])[.。]+$', '\1')
  ) FROM normalized;
$$;
REVOKE ALL ON FUNCTION public._quiz_exact_answer_matches(text,text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public._quiz_exact_answer_matches(text,text) IS
  'Conservative free short-answer comparison. Unlike grounding normalization, operators and numeric punctuation carry meaning.';

CREATE OR REPLACE FUNCTION public.start_quiz_run(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_set     quiz_sets%ROWTYPE;
  v_run     uuid;
  v_attempt smallint;
  v_n       integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id AND owner_user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501'; END IF;

  -- Serialize starts for this set before allocating its next sitting number.
  SELECT COALESCE(max(attempt_no), 0) + 1 INTO v_attempt
    FROM quiz_runs WHERE set_id = p_set_id AND user_id = v_uid;
  SELECT count(*) INTO v_n FROM quiz_questions WHERE set_id = p_set_id;

  INSERT INTO quiz_runs (set_id, user_id, attempt_no, item_count, score_max)
    VALUES (p_set_id, v_uid, v_attempt, v_n, v_n) RETURNING id INTO v_run;

  -- Permutation length read off the question, not a constant: a four-option and a
  -- six-option question can sit in the same set if the band was retuned between them.
  INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
  SELECT v_run, q.id, q.position,
         CASE WHEN q.question_type = 'mcq' AND q.options IS NOT NULL
              THEN ARRAY(SELECT i FROM generate_series(0, cardinality(q.options) - 1) i
                          ORDER BY random())::smallint[]
         END
  FROM quiz_questions q WHERE q.set_id = p_set_id ORDER BY q.position;

  RETURN jsonb_build_object('run_id', v_run, 'attempt_no', v_attempt, 'item_count', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_quiz_answer(p_run_item_id uuid, p_response jsonb, p_duration_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_item    quiz_run_items%ROWTYPE;
  v_q       quiz_questions%ROWTYPE;
  v_run     quiz_runs%ROWTYPE;
  v_choice  smallint;
  v_canon   smallint;
  v_correct boolean;
  v_score   numeric;
  v_attempt uuid;
  v_goal    uuid;
  v_rtype   text;
  v_etype   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT i.* INTO v_item FROM quiz_run_items i
    JOIN quiz_runs r ON r.id = i.run_id
   WHERE i.id = p_run_item_id AND r.user_id = v_uid
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not accessible' USING errcode = '42501'; END IF;
  IF v_item.status = 'void' OR v_item.question_id IS NULL THEN
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  IF v_item.status <> 'pending' THEN
    RAISE EXCEPTION 'Item already answered' USING errcode = 'P0011';
  END IF;

  SELECT * INTO v_q FROM quiz_questions WHERE id = v_item.question_id;
  IF NOT FOUND THEN
    UPDATE quiz_run_items SET status = 'void' WHERE id = p_run_item_id;
    RAISE EXCEPTION 'This question no longer exists' USING errcode = 'P0012';
  END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = v_item.run_id FOR UPDATE;
  IF v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Quiz run is closed' USING errcode = 'P0011';
  END IF;

  -- 그리고 응답 전체에 대한 백스톱. `record_answer_attempt` 가 이미 64KiB 로 막고 있고
  -- (167 §21.2), 이 함수만 그 검사를 지나치고 있었습니다. 같은 표에 쓰는 두 경로가 다른 규칙을
  -- 갖고 있으면 느슨한 쪽이 곧 그 표의 규칙입니다.
  IF p_response IS NOT NULL AND octet_length(p_response::text) > 65536 THEN
    RAISE EXCEPTION 'Response payload exceeds 64KiB limit' USING errcode = 'P0006';
  END IF;

  IF v_q.question_type = 'mcq' THEN
    v_choice := (p_response->>'choice')::smallint;
    -- Bounded by what was actually shown, not by a hardcoded 3.
    IF v_choice IS NULL OR v_choice < 0 OR v_choice >= cardinality(v_item.option_order) THEN
      RAISE EXCEPTION 'choice is outside the options shown' USING errcode = 'invalid_parameter_value';
    END IF;
    v_canon  := v_item.option_order[v_choice + 1];
    v_correct := v_canon = v_q.correct_index;
    v_score  := CASE WHEN v_correct THEN 1 ELSE 0 END;
    v_rtype  := 'choice'; v_etype := 'choice';
  ELSE
    IF coalesce(btrim(p_response->>'text'), '') = '' THEN
      RAISE EXCEPTION 'answer text is required' USING errcode = 'invalid_parameter_value';
    END IF;
    -- 길이는 **쓰는 자리**에서 막습니다.
    --
    -- 지금까지 상한은 `gradeGate` 하나뿐이었고 그것은 채점할 때만 돕니다. 채점을 안 누르면
    -- 그만이라, 1,000만 자를 제출하면 그대로 저장됐습니다 — 로컬에서 재현했더니 한 건에
    -- 28.6MB 였고, 반복에 제한이 없습니다. 채점 게이트는 AI 요금을 지키지 데이터베이스를
    -- 지키지 않습니다.
    --
    -- 숫자는 채점기와 **같은 숫자**입니다(`MAX_LEARNER_CHARS`: 서술형 2000, 주관식 300).
    -- 둘이 갈라지면 "낼 수는 있는데 채점은 못 하는 답"이 생기고, 그건 학습자가 고칠 수 없는
    -- 상태입니다.
    --
    -- CASE 를 쓰지 않는 이유: PL/pgSQL 은 `IF` 의 조건식을 **첫 THEN 에서 끊습니다.**
    -- `CASE ... THEN ... END` 안의 THEN 이 거기 걸려 조건이 반토막 나고 "syntax error at end
    -- of input" 이 됩니다. 로컬에서 그렇게 한 번 터뜨렸습니다.
    IF (v_q.question_type = 'essay'  AND char_length(p_response->>'text') > 4000)
       OR (v_q.question_type <> 'essay' AND char_length(p_response->>'text') > 300) THEN
      RAISE EXCEPTION 'answer is too long to grade' USING errcode = 'invalid_parameter_value';
    END IF;
    v_rtype := 'text';
    -- 205: a short answer that IS the answer is settled here, free, by string comparison.
    -- Only a genuine exact answer is graded for free. Width, case, spacing and
    -- a word's trailing sentence punctuation are tolerated; signs, decimal points,
    -- fractions and language names such as C++ retain their meaning.
    -- Essays remain rubric-graded; uncertain short answers remain ungraded.
    IF v_q.question_type = 'short'
       AND coalesce(v_q.reference_answer, '') <> ''
       AND public._quiz_exact_answer_matches(p_response->>'text', v_q.reference_answer)
    THEN
      v_score := 1;
      v_etype := 'exact';
    ELSE
      v_score := NULL;
      v_etype := CASE WHEN v_q.question_type = 'essay' THEN 'rubric' ELSE 'ai' END;
    END IF;
  END IF;

  -- Which goal this answer is evidence for.
  --
  -- Every insight the learning engine draws — accuracy, weak cards, what to study next — reads
  -- `answer_attempts` FILTERED BY goal_id. Quiz answers were written with none, so 56 attempts
  -- carrying a card, a response and a score sat in the table invisible to the one thing they
  -- were worth reading for. The set's own goal first (the daily check sets it); otherwise the
  -- deck's, and only when the deck belongs to exactly ONE goal.
  --
  -- Two goals means no answer, not a guess: attributing a wrong answer to the wrong goal moves
  -- the wrong plan, and a null here costs only the insight it was already missing.
  SELECT COALESCE(
    (SELECT s.goal_id FROM quiz_sets s WHERE s.id = v_run.set_id),
    (SELECT (array_agg(gd.goal_id))[1]
       FROM learning_goal_decks gd
       JOIN learning_goals g ON g.id = gd.goal_id AND g.user_id = v_uid
      WHERE gd.deck_id = (SELECT deck_id FROM quiz_sets WHERE id = v_run.set_id)
      HAVING count(*) = 1))
    INTO v_goal;

  INSERT INTO answer_attempts (
    user_id, goal_id, card_id, quiz_run_item_id, client_attempt_id,
    activity_type, response_type, evaluator_type,
    response, normalized_score, duration_ms)
  VALUES (
    v_uid, v_goal, v_q.card_id, p_run_item_id, gen_random_uuid(),
    CASE WHEN v_q.question_type = 'essay' THEN 'produce' ELSE 'recall' END,
    v_rtype, v_etype,
    p_response, v_score, COALESCE(p_duration_ms, 0))
  RETURNING id INTO v_attempt;

  UPDATE quiz_run_items
     SET status = CASE WHEN v_score IS NULL THEN 'answered' ELSE 'graded' END
   WHERE id = p_run_item_id;
  UPDATE quiz_runs
     SET answered_count = answered_count + 1,
         score_raw = score_raw + COALESCE(v_score, 0)
   WHERE id = v_item.run_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt,
    'graded', v_score IS NOT NULL,
    'score', v_score,
    'correct_display_index', CASE WHEN v_q.question_type = 'mcq'
      THEN (SELECT k - 1 FROM generate_subscripts(v_item.option_order, 1) k
             WHERE v_item.option_order[k] = v_q.correct_index) END,
    -- Revealed once the item is settled: multiple choice always, and a short answer the
    -- learner got exactly right — they typed it, so it discloses nothing.
    'reference_answer', CASE WHEN v_q.question_type = 'mcq' OR v_etype = 'exact'
                             THEN v_q.reference_answer END);
END;
$function$;

COMMIT;
