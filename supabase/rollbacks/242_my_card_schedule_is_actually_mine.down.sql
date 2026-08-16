-- Down for 242: 덱 목록 필터를 없애고 헬퍼 권한을 되돌립니다.
--
-- 되돌리면 **학습자 A 가 B 의 덱 id 로 B 의 카드 일정을 읽는 상태로 돌아갑니다.** 재현은
-- `supabase/tests/my_card_schedule_isolation_test.sql` 에 있습니다. 되돌릴 이유가 있다면
-- 그 사실을 알고 되돌리는 것이어야 합니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.my_card_schedule(p_deck_ids uuid[] DEFAULT NULL)
  RETURNS TABLE (card_id uuid, deck_id uuid, srs_status text, interval_days integer,
                 ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.learner_card_schedule(auth.uid(), p_deck_ids)
   WHERE auth.uid() IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) TO authenticated;

GRANT EXECUTE ON FUNCTION public._quiz_run_tally(uuid) TO anon, authenticated;

COMMIT;
