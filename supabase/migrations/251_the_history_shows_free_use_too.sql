-- 251: 사용 내역이 **무료로 쓴 것**을 보여주지 않았습니다.
--
-- 소유자가 카드를 만들고 사용 내역을 열었는데 아무것도 없었습니다. 차감이 빠진 게 아니라
-- 그 생성이 무료 10장 안이라 **잔액이 안 움직였고**, 사용 내역은 `ai_credit_ledger` — 잔액
-- 변동 기록 — 만 읽기 때문입니다.
--
-- 차감 쪽은 실제로 빠짐이 없습니다. 프로덕션에서 `ai_credit_balance` 를 갱신하는 함수는
-- `charge_ai_generation` 과 `settle_ai_quiz` 둘뿐이고, 둘 다 같은 트랜잭션에서 원장에
-- 씁니다. 그러니 "돈이 빠졌는데 내역에 없다"는 일은 구조적으로 생길 수 없습니다.
--
-- 없던 것은 **0원짜리 사용**입니다. 학습자에게는 그것도 사용입니다 — 오늘 무료 10장을 언제
-- 무엇에 썼는지가 화면 어디에도 없었고, 남은 개수를 보여주는 막대 하나가 전부였습니다.
--
-- 그래서 이 RPC 는 두 곳을 합쳐 하나의 시간순 목록으로 냅니다:
--
--   1. `ai_credit_ledger`  — 잔액이 움직인 모든 것(충전·환불·차감·조정)
--   2. `ai_generation_jobs` — 배달됐지만 0원이었던 것(무료 카드, 무료·체험 퀴즈)
--
-- 겹치지 않습니다. 2번은 값이 0인 작업만 고르고, 값이 0이면 1번에 행이 없습니다.
--
-- 페이지는 id 가 아니라 시각으로 넘깁니다. 두 표를 섞으면 id 가 한 줄로 서지 않습니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_ai_usage_history(
  p_limit  int         DEFAULT 30,
  p_before timestamptz DEFAULT NULL
) RETURNS TABLE (
  created_at    timestamptz,
  kind          text,
  delta         bigint,
  balance_after bigint,
  is_free       boolean,
  free_cards    int,
  paid_cards    int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH uid AS (SELECT auth.uid() AS id),
  paid AS (
    -- 잔액이 움직인 모든 행. 차감뿐 아니라 충전·환불·조정도 여기 있습니다.
    SELECT l.created_at,
           l.reason AS kind,
           l.delta,
           l.balance_after,
           false AS is_free,
           -- 카드 몇 장짜리였는지. 원장은 금액만 알고 개수는 작업이 압니다.
           COALESCE(j.free_cards, 0) AS free_cards,
           COALESCE(j.paid_cards, 0) AS paid_cards
      FROM ai_credit_ledger l
      LEFT JOIN ai_generation_jobs j ON j.id = l.ref
     WHERE l.user_id = (SELECT id FROM uid)
  ),
  free AS (
    -- 배달됐는데 0원이었던 작업. `charged` 는 `charge_ai_generation` 이 돌았다는 뜻이고
    -- (값이 0이어도 켜집니다), 퀴즈는 `settle_ai_quiz` 가 `quiz_units_done` 을 채웁니다 —
    -- 그쪽은 값이 0이면 `charged` 를 켜지 않으므로 두 조건이 겹치지 않습니다.
    SELECT j.created_at,
           CASE
             WHEN j.job_kind IN ('quiz_generate','quiz_grade') THEN 'spend_quiz'
             WHEN j.image_jobs > 0 THEN 'spend_image'
             WHEN j.job_kind = 'remediation' AND j.remediation_goal_id IS NOT NULL
               THEN 'spend_diagnosis'
             WHEN j.job_kind = 'remediation' THEN 'spend_remediation'
             ELSE 'spend_cards'
           END AS kind,
           0::bigint AS delta,
           NULL::bigint AS balance_after,
           true AS is_free,
           COALESCE(j.free_cards, 0) AS free_cards,
           COALESCE(j.paid_cards, 0) AS paid_cards
      FROM ai_generation_jobs j
     WHERE j.user_id = (SELECT id FROM uid)
       AND COALESCE(j.price_micro_usd, 0) = 0
       AND (j.charged = true OR COALESCE(j.quiz_units_done, 0) > 0)
  )
  SELECT * FROM (SELECT * FROM paid UNION ALL SELECT * FROM free) h
   WHERE (p_before IS NULL OR h.created_at < p_before)
   ORDER BY h.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
$$;

REVOKE EXECUTE ON FUNCTION public.get_ai_usage_history(int, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_usage_history(int, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_ai_usage_history(int, timestamptz) IS
  'One time-ordered list of everything the learner did with AI: every balance movement from ai_credit_ledger, plus the jobs that were delivered for nothing (free cards, free/trial quiz items). The two cannot overlap — a job priced at zero writes no ledger row. Paged by timestamp because two tables have no shared id order.';

COMMIT;
