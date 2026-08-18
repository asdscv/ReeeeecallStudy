-- 258: 서술형 답안 4,000자, 템플릿 필드 개수와 커스텀 HTML 한도.
--
-- ── 1) 서술형 답안 2,000 → 4,000 ───────────────────────────────────────────
--
-- 카드 한 장이 4,000자까지인데(257) 그 카드에 대한 답이 2,000자에서 막히면 앞뒤가 안 맞습니다.
-- 학습자가 납득할 수 있는 규칙이 아닙니다.
--
-- 원가로도 막을 이유가 없습니다. 실측(같은 프롬프트·모델, 한국어 — 글자당 토큰이 가장 비싼
-- 경우): 4,000자 답안이 입력 2,543 / 출력 162 토큰, **$0.000879**. 값이 $0.10 이니 114배이고
-- `price-floor.test.ts` 가 요구하는 바닥은 10배입니다. 답안 길이는 원가를 거의 안 움직입니다 —
-- 루브릭·문항·시스템 프롬프트가 입력의 대부분입니다.
--
-- 주관식은 300 그대로입니다. 짧은 답이라는 것이 그 유형의 정의입니다.
--
-- ── 2) 템플릿 필드 개수 ────────────────────────────────────────────────────
--
-- 상한이 없었습니다. 필드는 카드마다 곱해지고 카드는 프롬프트에 통째로 들어갑니다.
-- 프로덕션 106개 템플릿: 평균 3.8개 · p99 6개 · **최대 6개**. 20 은 그 3배가 넘고, 그쯤이면
-- 이미 못 쓰는 양식입니다.
--
-- 카드 글자수(4,000)가 이미 비용을 묶고 있으므로 이 한도는 비용이 아니라 형태에 대한
-- 것입니다 — 필드 200개짜리 템플릿은 편집기도 학습 화면도 감당하지 못합니다.
--
-- ── 3) 커스텀 HTML ─────────────────────────────────────────────────────────
--
-- `front_html` / `back_html` 은 무제한이었습니다. 프로덕션 최대는 **0자** — 아직 아무도 쓰지
-- 않습니다. 그래서 여유롭게 20,000자씩 둡니다. 진짜 템플릿 하나가 들어갈 만한 크기이고,
-- 무제한은 아닙니다.
--
-- 레이아웃(jsonb)도 같이 겁니다. 최대 353자인데 8,000 이면 넉넉합니다.
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
    IF (v_q.question_type = 'essay'  AND char_length(p_response->>'text') > 4000)
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

-- ── 2) 필드 개수 ────────────────────────────────────────────────────────────
ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_field_count_check;
ALTER TABLE public.card_templates
  ADD CONSTRAINT card_templates_field_count_check
  CHECK (fields IS NULL OR jsonb_array_length(fields) <= 20) NOT VALID;

-- ── 3) 커스텀 HTML 과 레이아웃 ──────────────────────────────────────────────
ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_html_length_check;
ALTER TABLE public.card_templates
  ADD CONSTRAINT card_templates_html_length_check
  CHECK (char_length(coalesce(front_html, '')) <= 20000
     AND char_length(coalesce(back_html, ''))  <= 20000) NOT VALID;

ALTER TABLE public.card_templates DROP CONSTRAINT IF EXISTS card_templates_layout_size_check;
ALTER TABLE public.card_templates
  ADD CONSTRAINT card_templates_layout_size_check
  CHECK (octet_length(coalesce(front_layout::text, '')) <= 8000
     AND octet_length(coalesce(back_layout::text, ''))  <= 8000
     AND octet_length(coalesce(fields::text, ''))       <= 8000) NOT VALID;

COMMIT;

-- 검증은 별도 트랜잭션. 106행이라 즉시 끝나지만 같은 패턴을 남겨 둡니다.
ALTER TABLE public.card_templates VALIDATE CONSTRAINT card_templates_field_count_check;
ALTER TABLE public.card_templates VALIDATE CONSTRAINT card_templates_html_length_check;
ALTER TABLE public.card_templates VALIDATE CONSTRAINT card_templates_layout_size_check;
