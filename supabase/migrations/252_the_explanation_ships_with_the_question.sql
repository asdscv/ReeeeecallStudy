-- 252: 객관식 해설을 생성 시점으로 옮깁니다. `grade_mcq` 는 없앱니다.
--
-- 245 는 해설을 답한 **뒤에** 파는 것으로 만들었습니다. 축이 학습자가 고른 보기에 달려 있으니
-- 그 순서가 자연스러워 보였습니다. 실제로는 이런 값을 치릅니다:
--
--   * 답할 때마다 프로바이더 호출이 한 번 더 — 문항당 $0.05
--   * 그 호출이 실패할 수 있는데, 학습자는 **이미 답을 제출한 뒤**입니다
--   * 해설을 보려면 기다려야 하고, 누르는 제스처가 하나 더 필요합니다
--
-- 그런데 오답 보기는 넉 개뿐입니다. 생성할 때 **보기마다 축을 하나씩** 쓰면 학습자가 무엇을
-- 고르든 해설이 이미 거기 있습니다. 호출은 한 번으로 줄고, 값은 문제값에 포함되고(하루 무료
-- 5문항이면 해설까지 무료), 답한 뒤에 실패할 여지가 사라집니다.
--
-- 그래서 이 파일은 셋을 합니다.
--
-- ── 1) 답한 뒤 축도 함께 풀어준다 ───────────────────────────────────────────
--
-- `flaws` 와 똑같이 **이번 회차의 섞인 순서로 치환**해서 내보냅니다. 저장 순서는 정규 순서이고
-- 서빙 순서는 매번 다르므로, 치환하지 않으면 엉뚱한 보기의 해설이 붙습니다 — 203 이 flaws 에서
-- 이미 겪은 결함입니다. 그리고 답하기 전에는 여전히 아무것도 안 나갑니다: 축은 정답표입니다.
--
-- 252 이전에 만들어진 문항에는 `axes` 가 없습니다. 그때는 이 CASE 가 아무것도 더하지 않고,
-- 클라이언트는 없는 것을 그리지 않습니다.
--
-- ── 2) 값을 없앤다 ─────────────────────────────────────────────────────────
--
-- `grade_mcq` 행을 지우고 CHECK 를 좁힙니다. 그 행이 없으면 `reserve_ai_quiz` 가 'Unknown quiz
-- action' 으로 거절하므로, 배포된 엣지가 남아 있어도 요금이 샐 수 없습니다.
--
-- ── 3) 쓰이지 않게 된 것을 치운다 ──────────────────────────────────────────
--
-- `apply_quiz_explanation`(245) 은 부르는 곳이 없어집니다. 남겨두면 다음 사람이 "왜 이건 안
-- 쓰나"를 묻게 되고, 서비스 롤이 점수를 우회해 쓸 수 있는 문이 하나 열린 채 남습니다.
--
-- 이미 산 해설(`answer_attempts.feedback` 의 axis)은 그대로 둡니다. 값을 치른 것이고 화면은
-- 같은 `mcqAxis.*` 문구로 계속 그립니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_quiz_run_items(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_run   quiz_runs%ROWTYPE;
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = p_run_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz run not accessible' USING errcode = '42501'; END IF;

  SELECT jsonb_agg(x ORDER BY x->>'position') INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'item_id', i.id,
      'position', i.position,
      'status', i.status,
      'question_type', q.question_type,
      'stem', q.stem,
      'options', CASE WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                      THEN to_jsonb(ARRAY(SELECT q.options[i.option_order[k] + 1]
                                            FROM generate_subscripts(i.option_order, 1) k))
                 END,
      'answered', a.id IS NOT NULL,
      'score', a.normalized_score,
      'feedback', a.feedback,
      -- AFTER answering only. `meta.flaws` names why each wrong option is wrong, so it is
      -- an answer key until the learner has committed.
      --
      -- And permuted with the options. Stored order is canonical; served order is this
      -- sitting's shuffle. Returning the stored array beside the shuffled options made the
      -- payload claim two different correct answers.
      'meta', CASE WHEN a.id IS NULL THEN NULL
                   WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                        AND jsonb_typeof(q.meta -> 'flaws') = 'array'
                   THEN q.meta
                        || jsonb_build_object('flaws', (
                             SELECT COALESCE(jsonb_agg(q.meta -> 'flaws' -> i.option_order[k]
                                                       ORDER BY k), '[]'::jsonb)
                               FROM generate_subscripts(i.option_order, 1) k))
                        -- `axes` gets the SAME permutation, for the same reason: stored order is
                        -- canonical, served order is this sitting's shuffle, and an explanation
                        -- aligned to the wrong option explains the wrong mistake. Absent on
                        -- questions written before 252, and the client drops what is not there.
                        || CASE WHEN jsonb_typeof(q.meta -> 'axes') = 'array'
                                THEN jsonb_build_object('axes', (
                                       SELECT COALESCE(jsonb_agg(q.meta -> 'axes' -> i.option_order[k]
                                                                 ORDER BY k), '[]'::jsonb)
                                         FROM generate_subscripts(i.option_order, 1) k))
                                ELSE '{}'::jsonb END
                   ELSE q.meta END,
      -- The learner's OWN submission, back to them.
      --
      -- `QuizFeedback` renders character spans the grader returned — "this part of your sentence
      -- is the problem" — by slicing the text the client already holds. During the run that is
      -- the input box. On the result screen, and on every later visit to a finished run, the
      -- client had nothing, so `splitBySpan('')` produced an empty hit and every learner span
      -- was dropped. The spans were paid for and then thrown away, which is the exact defect
      -- that component was written to fix.
      'response', a.response,
      'rubric', CASE WHEN a.id IS NOT NULL THEN q.rubric END,
      'reference_answer', CASE WHEN a.id IS NOT NULL THEN q.reference_answer END
    ) AS x
    FROM quiz_run_items i
    LEFT JOIN quiz_questions q ON q.id = i.question_id
    LEFT JOIN answer_attempts a ON a.quiz_run_item_id = i.id
    WHERE i.run_id = p_run_id AND i.status <> 'void'
  ) s;

  RETURN jsonb_build_object(
    'run_id', p_run_id, 'set_id', v_run.set_id, 'status', v_run.status,
    'attempt_no', v_run.attempt_no, 'item_count', v_run.item_count,
    'answered_count', v_run.answered_count,
    'score_raw', v_run.score_raw, 'score_max', v_run.score_max,
    -- 208: what the SET is still aiming for. A long quiz opens on its first batch, so a
    -- screen needs the target to know whether more is coming — and to stop asking once it
    -- is not.
    'requested_count', (SELECT requested_count FROM quiz_sets WHERE id = v_run.set_id),
    'items', COALESCE(v_items, '[]'::jsonb));
END;
$function$;

-- ── 2) 값을 없앤다 ─────────────────────────────────────────────────────────
DELETE FROM public.ai_quiz_price_units WHERE action = 'grade_mcq';

ALTER TABLE public.ai_quiz_price_units
  DROP CONSTRAINT IF EXISTS ai_quiz_price_units_action_check;
ALTER TABLE public.ai_quiz_price_units
  ADD CONSTRAINT ai_quiz_price_units_action_check
  CHECK (action IN ('generate_mcq','generate_short','generate_essay',
                    'grade_short','grade_essay'));

COMMENT ON TABLE public.ai_quiz_price_units IS
  'Quiz actions and what each costs, in units of ai_pricing_settings.quiz_unit_price_micro. Generation is per item; grading is per submitted answer. Multiple choice has neither a grading nor an explanation row: its mark is an index comparison in SQL, and its explanation is written with the question (mig 252) — both free, both instant.';

-- ── 3) 쓰이지 않게 된 것을 치운다 ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_quiz_explanation(uuid, jsonb, jsonb, text);

COMMIT;
