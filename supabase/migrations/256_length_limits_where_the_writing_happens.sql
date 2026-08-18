-- 256: 길이 상한이 채점할 때만 있었습니다.
--
-- 어뷰징 질문 하나로 드러났습니다: "수천만 자를 넣으면 어떡해?"
--
-- 넣어 봤습니다. 로컬에서 퀴즈 답안에 1,000만 자를 제출하니 **통과했고 28.6MB 가 그대로
-- 저장됐습니다.** 반복에 제한도 없습니다.
--
-- 상한이 없었던 게 아니라 **엉뚱한 곳에** 있었습니다. `MAX_LEARNER_CHARS`(서술형 2000,
-- 주관식 300)는 `gradeGate` 안에 있고, 그것은 **채점할 때** 돕니다. 채점은 학습자가 누르는
-- 것이고, 안 누르면 그만입니다. 그 게이트는 우리 AI 요금을 지키지 데이터베이스를 지키지
-- 않습니다.
--
-- 같은 표에 쓰는 다른 경로는 이미 막고 있었습니다 — `record_answer_attempt` 는 64KiB 를
-- 넘기면 P0006 입니다(167 §21.2). `submit_quiz_answer` 만 그 검사를 지나쳤습니다. 한 표에
-- 두 경로가 다른 규칙을 갖고 있으면, 느슨한 쪽이 그 표의 실제 규칙입니다.
--
-- ── 무엇을 거는가 ──────────────────────────────────────────────────────────
--
--   1. `submit_quiz_answer` 가 채점기와 **같은 숫자**로 막습니다. 갈라지면 "낼 수는 있는데
--      채점은 못 하는 답"이 생기고, 그건 학습자가 고칠 수 없는 상태입니다.
--   2. 응답 전체에 64KiB 백스톱 — `record_answer_attempt` 와 같은 값.
--   3. 표 자체에도 CHECK. 앞으로 이 표에 쓰는 세 번째 경로가 생겨도 검사를 지나칠 수 없습니다.
--   4. 덱 이름·설명, 템플릿 이름. 100만 자짜리 덱 이름도 통과했습니다.
--
-- ── 숫자 ───────────────────────────────────────────────────────────────────
--
-- 프로덕션 실제 최대값입니다. 전부 한도의 몇십 분의 일입니다:
--
--       answer_attempts.response   140행    최대  3,012 B   → 한도 65,536
--       decks.name                 704행    최대     66 자   → 한도  200
--       decks.description          704행    최대     97 자   → 한도  2,000
--       card_templates.name        106행    최대     33 자   → 한도  200
BEGIN;

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
    IF (v_q.question_type = 'essay'  AND char_length(p_response->>'text') > 2000)
       OR (v_q.question_type <> 'essay' AND char_length(p_response->>'text') > 300) THEN
      RAISE EXCEPTION 'answer is too long to grade' USING errcode = 'invalid_parameter_value';
    END IF;
    v_rtype := 'text';
    -- 205: a short answer that IS the answer is settled here, free, by string comparison.
    -- `_normalize_answer` folds width, case and punctuation exactly as the TypeScript grader
    -- does, so "빙하." and "빙하" are one string. Charging a learner to be told they typed the
    -- right word is the same mistake as charging for multiple-choice grading, which
    -- `ai_quiz_price_units` omits on purpose.
    --
    -- Essays are never settled this way: their reference is a model answer, not a key, and an
    -- exact match against it would mean nothing.
    IF v_q.question_type = 'short'
       AND coalesce(v_q.reference_answer, '') <> ''
       AND public._normalize_answer(p_response->>'text') = public._normalize_answer(v_q.reference_answer)
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

-- ── 표 자체의 백스톱 ────────────────────────────────────────────────────────
--
-- 프로덕션 최대가 3,012 바이트라 검증은 즉시 통과합니다. 그래도 NOT VALID + VALIDATE 로
-- 나눈 것은, 이 표가 앞으로 커질 표이고 같은 패턴을 남겨 두는 편이 낫기 때문입니다.
ALTER TABLE public.answer_attempts
  DROP CONSTRAINT IF EXISTS answer_attempts_response_size_check;
ALTER TABLE public.answer_attempts
  ADD CONSTRAINT answer_attempts_response_size_check
  CHECK (response IS NULL OR octet_length(response::text) <= 65536) NOT VALID;

-- ── 이름과 설명 ─────────────────────────────────────────────────────────────
--
-- 화면에 그려지는 문자열입니다. 100만 자짜리 덱 이름은 그 자체로 목록을 못 쓰게 만듭니다.
ALTER TABLE public.decks DROP CONSTRAINT IF EXISTS decks_name_length_check;
ALTER TABLE public.decks ADD CONSTRAINT decks_name_length_check
  CHECK (char_length(name) <= 200) NOT VALID;

ALTER TABLE public.decks DROP CONSTRAINT IF EXISTS decks_description_length_check;
ALTER TABLE public.decks ADD CONSTRAINT decks_description_length_check
  CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID;

ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_name_length_check;
ALTER TABLE public.card_templates ADD CONSTRAINT card_templates_name_length_check
  CHECK (char_length(name) <= 200) NOT VALID;

COMMIT;

-- 검증은 별도 트랜잭션. SHARE UPDATE EXCLUSIVE 라 읽기·쓰기를 막지 않습니다.
ALTER TABLE public.answer_attempts VALIDATE CONSTRAINT answer_attempts_response_size_check;
ALTER TABLE public.decks           VALIDATE CONSTRAINT decks_name_length_check;
ALTER TABLE public.decks           VALIDATE CONSTRAINT decks_description_length_check;
ALTER TABLE public.card_templates  VALIDATE CONSTRAINT card_templates_name_length_check;
