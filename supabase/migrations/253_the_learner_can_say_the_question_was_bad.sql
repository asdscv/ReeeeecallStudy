-- 253: 학습자가 문항을 평가할 수 있게 합니다.
--
-- 퀴즈 문항은 전부 모델이 씁니다. 그런데 그 문항이 좋았는지 나쁘았는지를 아는 경로가 하나도
-- 없었습니다 — 학습자가 이상한 문제를 만나면 그냥 넘어가고, 우리는 다음에도 같은 프롬프트로
-- 같은 이상한 문제를 씁니다. 이 표가 그 되돌림입니다.
--
-- ── 왜 자유 입력이 아닌가 ───────────────────────────────────────────────────
--
-- 이유는 **닫힌 집합**입니다. 자유 텍스트는 여덟 언어로 쌓이고, 그러면 읽는 사람이 있어야
-- 쓸모가 생기고, 읽는 사람이 없으면 아무것도 아닙니다. 닫힌 라벨은 SQL 한 줄로 집계됩니다:
-- "밴드 3의 객관식에서 `options_confusing` 이 몰린다"는 프롬프트를 고칠 수 있는 문장이고,
-- "보기가 좀 이상해요" 300건은 그렇지 않습니다.
--
-- 그리고 이유는 **선택**입니다. 👎 만으로 이미 기록됩니다 — 이유를 필수로 만들면 두 번째 탭이
-- 생기고, 두 번째 탭이 생기면 아무도 첫 번째 탭을 누르지 않습니다.
--
-- ── 왜 몇 개를 복사해 두는가 ───────────────────────────────────────────────
--
-- `question_type` 과 `content_locale` 은 문항을 지우면 사라집니다. 나중에 보고 싶은 것은
-- "어떤 종류·어떤 언어의 문항이 나쁜 평을 받는가"이므로, 그때 join 할 대상이 없어져 있으면
-- 평가가 남아도 읽을 수 없습니다. `was_correct` 도 같은 이유입니다 — 틀린 문항에 👎가 몰리는지
-- 맞힌 문항에도 몰리는지는 전혀 다른 신호이고, `answer_attempts` 는 삭제될 수 있습니다.
BEGIN;

CREATE TABLE IF NOT EXISTS public.quiz_item_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 무엇을 평가했는지. 문항이 지워지면 평가도 갑니다 — 지워진 문항에 대한 평은 읽을 수 없고,
  -- 집계에 필요한 것은 아래에 복사해 두었습니다.
  run_item_id   uuid NOT NULL REFERENCES public.quiz_run_items(id) ON DELETE CASCADE,
  -- 같은 문항이 여러 회차에 나오므로, 프롬프트를 고칠 때 보는 단위는 이쪽입니다.
  question_id   uuid REFERENCES public.quiz_questions(id) ON DELETE SET NULL,
  verdict       text NOT NULL CHECK (verdict IN ('good','bad')),
  -- NULL 이 정상입니다. 👎 만 누르고 이유를 안 고른 학습자가 다수일 것이고, 그것도 신호입니다.
  reason        text CHECK (reason IS NULL OR reason IN (
                  'question_unclear',      -- 문제가 무슨 말인지 모르겠다
                  'answer_wrong',          -- 정답이 틀린 것 같다
                  'options_confusing',     -- 보기가 헷갈린다
                  'not_from_card',         -- 내 카드와 상관없는 내용이다
                  'too_easy',
                  'too_hard',
                  'explanation_unhelpful'  -- 해설이 도움이 안 된다
                )),
  -- 지워질 수 있는 것들의 사본. 위 헤더 참고.
  question_type text,
  content_locale text,
  was_correct   boolean,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- 한 학습자, 한 문항, 한 평가. 마음이 바뀌면 덮어씁니다 — 같은 사람의 👍 와 👎 가 둘 다
  -- 남아 있으면 집계가 어느 쪽도 믿을 수 없게 됩니다.
  UNIQUE (user_id, run_item_id)
);

-- 프롬프트를 고칠 때 실제로 던지는 질문의 모양대로. "어떤 종류가 나쁜 평을 받는가"입니다.
CREATE INDEX IF NOT EXISTS idx_quiz_item_feedback_shape
  ON public.quiz_item_feedback (verdict, question_type, reason);
CREATE INDEX IF NOT EXISTS idx_quiz_item_feedback_question
  ON public.quiz_item_feedback (question_id);

ALTER TABLE public.quiz_item_feedback ENABLE ROW LEVEL SECURITY;

-- 읽기는 자기 것만. 쓰기는 RPC 로만 — 클라이언트가 직접 INSERT 하면 남의 문항 id 로도 쓸 수
-- 있고, 답하지 않은 문항을 평가할 수도 있습니다.
DROP POLICY IF EXISTS "Owner can read own quiz feedback" ON public.quiz_item_feedback;
CREATE POLICY "Owner can read own quiz feedback" ON public.quiz_item_feedback
  FOR SELECT USING (auth.uid() = user_id);

-- 정책이 **없다**는 것에 기대지 않습니다.
--
-- RLS 는 이미 직접 INSERT 를 막습니다(정책이 없으면 기본 거부이고, 로컬에서 42501 로 확인했습니다).
-- 그런데 그 보호는 "아무도 INSERT 정책을 추가하지 않는다"에 달려 있습니다 — 다른 이유로 정책
-- 하나가 붙는 날, 답하지 않은 문항이나 남의 문항에 평가를 쓰는 문이 조용히 열립니다.
-- 쓰기는 `rate_quiz_item` 만 한다는 것을 권한으로도 적어 둡니다.
REVOKE INSERT, UPDATE, DELETE ON public.quiz_item_feedback FROM authenticated, anon;

/**
 * 문항 하나를 평가한다.
 *
 * 답한 문항만 평가할 수 있습니다. 답하지 않은 문항에 대한 판단은 문항에 대한 판단이 아니고,
 * 무엇보다 답하기 전에 "정답이 틀렸다"를 고를 수 있으면 그것이 정답에 대한 탐색이 됩니다.
 */
CREATE OR REPLACE FUNCTION public.rate_quiz_item(
  p_run_item_id uuid,
  p_verdict     text,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_type text;
  v_loc  text;
  v_qid  uuid;
  v_score numeric;
  v_answered boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_verdict NOT IN ('good','bad') THEN
    RAISE EXCEPTION 'verdict must be good or bad' USING errcode = 'invalid_parameter_value';
  END IF;

  -- 소유 확인과 사본 수집을 한 번에. 회차가 학습자의 것이어야 합니다.
  SELECT q.question_type, s.content_locale, q.id,
         a.normalized_score, a.id IS NOT NULL
    INTO v_type, v_loc, v_qid, v_score, v_answered
    FROM quiz_run_items i
    JOIN quiz_runs r      ON r.id = i.run_id AND r.user_id = v_uid
    LEFT JOIN quiz_questions q ON q.id = i.question_id
    LEFT JOIN quiz_sets s      ON s.id = q.set_id
    LEFT JOIN answer_attempts a ON a.quiz_run_item_id = i.id
   WHERE i.id = p_run_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz item not accessible' USING errcode = '42501';
  END IF;
  IF NOT COALESCE(v_answered, false) THEN
    RAISE EXCEPTION 'Answer this question first' USING errcode = 'invalid_parameter_value';
  END IF;

  INSERT INTO quiz_item_feedback (
    user_id, run_item_id, question_id, verdict, reason,
    question_type, content_locale, was_correct)
  VALUES (
    v_uid, p_run_item_id, v_qid, p_verdict, p_reason,
    v_type, v_loc, CASE WHEN v_score IS NULL THEN NULL ELSE v_score >= 0.75 END)
  ON CONFLICT (user_id, run_item_id) DO UPDATE
    SET verdict = EXCLUDED.verdict,
        -- 이유는 **덮어씁니다**, 병합하지 않습니다. 👎 이유를 골랐다가 👍 로 바꾼 학습자의
        -- 옛 이유가 남아 있으면 "좋다고 했는데 보기가 헷갈린다"는 행이 생깁니다.
        reason  = EXCLUDED.reason,
        was_correct = EXCLUDED.was_correct,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'verdict', p_verdict, 'reason', p_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_quiz_item(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rate_quiz_item(uuid, text, text) TO authenticated;

COMMENT ON TABLE public.quiz_item_feedback IS
  'What the learner thought of one generated question. Reasons are a closed set so they aggregate across eight languages; question_type / content_locale / was_correct are copied because the rows they come from can be deleted, and without them a surviving rating cannot be read.';

COMMIT;
