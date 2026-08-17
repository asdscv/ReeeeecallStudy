-- 245: 객관식에도 AI를 붙입니다 — 채점이 아니라 해설로.
--
-- 요청은 "객관식도 그냥 다 ai 채점하자" 였습니다. 그대로 옮기면 제품이 나빠지는 부분이 하나
-- 있어서 거기만 다르게 했고, 나머지는 요청대로입니다.
--
-- ── 왜 점수는 그대로 두는가 ─────────────────────────────────────────────────
--
-- 객관식의 정답은 `option_order[choice] = correct_index`, 즉 우리가 쓴 정답표와의 정수 비교
-- 입니다. 모델이 여기에 보탤 수 있는 것은 없습니다 — 동의하거나(무의미), 반대하거나(결함),
-- 동의하는 데 돈이 들거나 셋뿐입니다. 모델이 `normalized_score` 를 쓰게 하면, 맞은 답이
-- 틀렸다고 조용히 뒤집히는 날이 반드시 옵니다. 그때 학습자에게 남는 것은 이의제기 버튼뿐이고,
-- 그 문제에는 객관적인 정답표가 있습니다.
--
-- 그리고 즉시 채점은 기능입니다. 점수를 AI 쪽으로 옮기면 정답 배너·진행 점수·오답 노트·플랜이
-- 전부 결제 전까지 비어 있게 됩니다. 프로바이더가 한 번 실패하면 확실히 알 수 있었던 답이
-- 채점되지 않은 채 남습니다.
--
-- 그래서 SQL 이 계속 정답을 판정하고(무료·즉시·확정), AI 는 그 위에 **해설**을 올립니다:
-- 무엇과 헷갈렸는지(닫힌 집합 라벨), 그리고 그것을 정리해주는 **학습자 자기 카드의 그 줄**
-- (span). 모델이 쓴 문장은 화면에 한 글자도 가지 않습니다 — 이 저장소의 규칙 그대로입니다.
--
-- 이건 실제로 크레딧을 씁니다. `grade_mcq` 1유닛 = $0.05 입니다.
--
-- ── 이 파일이 하는 것 ───────────────────────────────────────────────────────
--
-- 1) `grade_mcq` 를 가격표가 받아들이도록 CHECK 를 다시 씁니다. 지금까지 이 CHECK 가 곧
--    시행이었습니다 — 행이 없으면 `reserve_ai_quiz` 가 'Unknown quiz action' 으로 거절합니다.
-- 2) 가격 1유닛. 짧은 답 채점(2유닛)보다 쌉니다: 정답 판정은 이미 끝나 있고 모델은 설명만
--    씁니다.
-- 3) `apply_quiz_explanation` — 점수를 건드리지 않고 해설만 붙이는 서비스 롤 RPC.
--    `apply_quiz_grade` 를 재사용하지 않는 이유가 바로 그것입니다: 그 함수는
--    `normalized_score` 와 `quiz_runs.score_raw` 를 다시 씁니다.
BEGIN;

-- ── 1) 가격표가 grade_mcq 를 받아들인다 ─────────────────────────────────────
ALTER TABLE public.ai_quiz_price_units
  DROP CONSTRAINT IF EXISTS ai_quiz_price_units_action_check;
ALTER TABLE public.ai_quiz_price_units
  ADD CONSTRAINT ai_quiz_price_units_action_check
  CHECK (action IN ('generate_mcq','generate_short','generate_essay',
                    'grade_mcq','grade_short','grade_essay'));

-- ── 2) 값 ───────────────────────────────────────────────────────────────────
--
-- 1유닛. 채점이 아니라 해설이고, 입력도 짧습니다(문제·정답·고른 보기·카드 한두 줄).
INSERT INTO public.ai_quiz_price_units (action, units, job_kind)
VALUES ('grade_mcq', 1, 'quiz_grade')
ON CONFLICT (action) DO UPDATE SET units = EXCLUDED.units,
                                   job_kind = EXCLUDED.job_kind,
                                   updated_at = now();

COMMENT ON TABLE public.ai_quiz_price_units IS
  'Quiz actions and what each costs, in units of ai_pricing_settings.quiz_unit_price_micro. Generation is per item; grading is per submitted answer. grade_mcq buys an EXPLANATION only — multiple-choice correctness is decided by submit_quiz_answer in SQL, free and instantly, and no model result is ever allowed to overwrite it.';

-- ── 3) 점수는 그대로 두고 해설만 붙인다 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_quiz_explanation(
  p_run_item_id uuid,
  p_evaluator_result jsonb,
  p_feedback    jsonb,
  p_evaluator_version text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item quiz_run_items%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  SELECT * INTO v_item FROM quiz_run_items WHERE id = p_run_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz item not found' USING errcode = 'P0003'; END IF;

  -- `normalized_score`, `evaluator_type`, `quiz_run_items.status` 와 `quiz_runs.score_raw` 는
  -- 손대지 않습니다. 정답 판정은 제출 시점에 이미 끝났고 그게 확정입니다. 여기서 붙는 것은
  -- 해설뿐이라 두 번 사도 점수가 흔들리지 않습니다.
  UPDATE answer_attempts
     SET evaluator_result = COALESCE(evaluator_result, '{}'::jsonb) || COALESCE(p_evaluator_result, '{}'::jsonb),
         feedback = p_feedback,
         evaluator_version = COALESCE(p_evaluator_version, evaluator_version)
   WHERE quiz_run_item_id = p_run_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No answer to explain' USING errcode = 'P0003'; END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_quiz_explanation(uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apply_quiz_explanation(uuid, jsonb, jsonb, text) IS
  'Attach an AI explanation to an already-scored quiz answer. Writes feedback and merges evaluator_result; never touches normalized_score, evaluator_type, item status or the run tally — multiple-choice correctness belongs to submit_quiz_answer and is not the model''s to revise.';

COMMIT;
