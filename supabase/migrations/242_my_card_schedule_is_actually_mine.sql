-- 242: `my_card_schedule` 이 남의 카드 일정을 돌려줬습니다.
--
-- 배포 직전 감사에서 나왔고, **재현했습니다**:
--
--     학습자 A 로 로그인 → my_card_schedule(ARRAY['<B의 덱 id>'])  →  B 의 카드 1장
--
-- 232 가 만든 함수입니다. 그 마이그레이션의 헤더는 이렇게 적혀 있습니다 —
-- "인자로 `p_user_id` 를 받는 함수를 authenticated 에게 열면 모든 학습자가 모든 학습자에 대해
--  물어볼 수 있다. 그래서 인자가 없는 DEFINER 래퍼를 둔다. 넘길 게 없으니 위조할 것도 없다."
--
-- 그 문장은 **user_id 에 대해서만** 참이었습니다. 함수는 `p_deck_ids` 를 그대로 받아
-- `learner_card_schedule` 로 넘기고, 거기서 명시적 덱 목록은 소유권 검사 없이 그대로 쓰입니다
-- (236 이 그 동작을 "이 목록을 넘기는 호출자는 전부 이미 판단을 끝낸 DEFINER 래퍼"라는 이유로
--  유지했는데, 바로 그 가정이 이 함수에서 거짓이었습니다 — 여기서 목록은 **호출자가 준 것**입니다).
--
-- 새는 것: 남의 카드 id, 덱 id, srs_status, interval_days, ease_factor, 마지막/다음 복습 시각.
-- 카드 내용은 아닙니다. 덱 id 를 알아야 하지만 공유·마켓플레이스 덱의 id 는 공개됩니다.
--
-- 지금 이 함수를 부르는 곳은 **아무 데도 없습니다** — 235 가 분석 차트를 `my_retention_curve` /
-- `my_review_progress` 로 옮기면서 마지막 호출자가 사라졌습니다. 그래도 지우지 않고 고칩니다:
-- 이미 authenticated 에게 열려 있는 함수라 제가 못 찾은 호출자가 있을 수 있고, 필터를 씌우는
-- 쪽이 더 작은 변경입니다.
--
-- 고치는 방법은 함수 이름이 이미 약속하는 것입니다 — **내 것만**. 덱 목록을 호출자가 볼 수
-- 있는 덱으로 교집합 처리합니다. 그 규칙은 새로 만드는 게 아니라
-- `learner_card_schedule` 의 목록 없는 분기가 쓰는 것과 같습니다: 내 덱 + 내가 카드를 만진 덱.
BEGIN;

CREATE OR REPLACE FUNCTION public.my_card_schedule(p_deck_ids uuid[] DEFAULT NULL)
  -- Column-for-column with `learner_card_schedule`, `ease_factor` included. Dropping a column
  -- from the middle of a SELECT * makes a return-type mismatch, not a narrower row.
  RETURNS TABLE (card_id uuid, deck_id uuid, srs_status text, interval_days integer,
                 ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.learner_card_schedule(
    auth.uid(),
    -- NULL stays NULL: that is "my whole library", which the inner function resolves from
    -- auth.uid() itself and is already safe.
    --
    -- A list is INTERSECTED with what this caller may see, rather than trusted. Same membership
    -- rule as the inner function's no-list branch — decks you own, plus decks you have touched a
    -- card in — so a learner asking about their own decks gets exactly what they asked for, and
    -- a learner asking about somebody else's gets an empty array rather than an answer.
    CASE WHEN p_deck_ids IS NULL THEN NULL ELSE (
      SELECT COALESCE(array_agg(d.id), '{}'::uuid[])
        FROM unnest(p_deck_ids) AS d(id)
       WHERE EXISTS (SELECT 1 FROM decks k WHERE k.id = d.id AND k.user_id = auth.uid())
          OR EXISTS (SELECT 1 FROM user_card_progress p
                      WHERE p.deck_id = d.id AND p.user_id = auth.uid())
    ) END
  )
   WHERE auth.uid() IS NOT NULL;
$$;

COMMENT ON FUNCTION public.my_card_schedule(uuid[]) IS
  'The caller''s own card schedule. Both arguments are derived or filtered: the user id from '
  'auth.uid(), and any deck list intersected with the decks this caller may see — mig 232 '
  'forwarded the list unfiltered, which returned another learner''s SRS state for any deck id.';

REVOKE EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) TO authenticated;

-- ── 내부 헬퍼는 내부에만 ────────────────────────────────────────────────────
--
-- `_quiz_run_tally(run_id)` 는 225 가 만든 밑줄 헬퍼인데 **anon 에게까지** 열려 있었습니다.
-- 직접 부르면 회차 id 하나로 그 회차의 채점 집계(총/답함/맞음/틀림/미채점)가 나옵니다.
-- 부르는 곳 넷(get_quiz_set, list_quiz_sets, get_quiz_set_history, get_ai_activity)은 전부
-- SECURITY DEFINER 이고 자기 소유권 검사를 하므로, 권한을 거둬도 그대로 동작합니다.
REVOKE EXECUTE ON FUNCTION public._quiz_run_tally(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
