-- ============================================================================
-- 270 — get_public_stats(): 랜딩이 셀 수 있는 진짜 숫자
--
-- 랜딩의 사회적 증거는 지어낸 값이었습니다. 활성 사용자 2,500명(실제 36명),
-- 생성된 덱 5,000개(실제 703개), 그리고 30초마다 Math.random() 으로 흔들리던
-- "지금 N명이 공부 중". 앞선 PR 이 그것들을 지웠고, 이 마이그레이션은 그 자리에
-- 놓을 **셀 수 있는** 숫자를 공개 읽기 경로로 만듭니다.
--
-- 마케팅을 포기하는 게 아닙니다. 실제 카드가 377,077장이라 지어냈던 2,500 보다
-- 두 자릿수 큽니다. 문제는 세기가 어려웠던 게 아니라 아무도 세지 않았던 것입니다.
--
-- ## 왜 스냅샷 테이블인가
--
-- cards 는 37만 행이고 랜딩은 로그인 없이 누구나 엽니다. 방문마다 count(*) 를
-- 돌리면 마케팅 페이지가 DB 부하가 됩니다. 그렇다고 숫자를 코드에 박으면 정확히
-- 지금 지운 그 문제로 돌아갑니다 — 처음엔 참이었다가 조용히 거짓이 되는 값.
--
-- 그래서 한 시간에 한 번만 실제로 셉니다. UPDATE 의 WHERE 절이 경합을 이기므로
-- 동시에 백 명이 들어와도 한 번만 셉니다. pg_cron 은 이 프로젝트에 없어서
-- (pg_extension 확인함) 게으른 갱신을 함수 안에 둡니다.
--
-- ## 무엇을 세지 않는가
--
-- 사용자 수는 일부러 뺐습니다. 지금 36명이고, 그 숫자를 부풀리고 싶은 유혹이
-- 애초에 이 사달의 원인이었습니다. 스케일을 말하고 싶으면 만들어진 카드 수처럼
-- 실제로 큰 값을 쓰면 됩니다. 집계뿐이라 개인을 식별할 수 없습니다.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.public_stats_snapshot (
  id              smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cards_total     bigint      NOT NULL DEFAULT 0,
  decks_total     bigint      NOT NULL DEFAULT 0,
  listings_total  bigint      NOT NULL DEFAULT 0,
  -- '-infinity' 로 시작해서 첫 호출이 반드시 한 번은 세도록 합니다.
  refreshed_at    timestamptz NOT NULL DEFAULT '-infinity'
);

INSERT INTO public.public_stats_snapshot (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 클라이언트는 이 테이블을 직접 읽지 않습니다. 정책을 하나도 두지 않은 채 RLS 를
-- 켜서, 아래 SECURITY DEFINER 함수만 통과하게 합니다.
ALTER TABLE public.public_stats_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_stats_snapshot FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_stats()
  RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.public_stats_snapshot;
BEGIN
  -- 한 시간 지난 경우에만 실제로 셉니다. 조건이 UPDATE 안에 있어서 동시 호출 중
  -- 하나만 이깁니다(나머지는 0행 갱신하고 지나갑니다).
  UPDATE public.public_stats_snapshot s
     SET cards_total    = (SELECT count(*) FROM public.cards),
         decks_total    = (SELECT count(*) FROM public.decks),
         -- 방문자가 실제로 둘러볼 수 있는 것만 셉니다(내려간 리스팅 제외).
         listings_total = (SELECT count(*) FROM public.marketplace_listings WHERE is_active),
         refreshed_at   = now()
   WHERE s.id = 1
     AND s.refreshed_at < now() - interval '1 hour';

  SELECT * INTO r FROM public.public_stats_snapshot WHERE id = 1;

  -- 행이 없으면 아무 말도 하지 않습니다. 지어낸 기본값을 돌려주는 순간 이 함수는
  -- 자기가 대체하러 온 그 물건이 됩니다.
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN json_build_object(
    'cards_total',    r.cards_total,
    'decks_total',    r.decks_total,
    'listings_total', r.listings_total,
    'refreshed_at',   r.refreshed_at
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_stats() IS
  '랜딩용 집계 수치(카드/덱/공개 리스팅). get_public_plans() 처럼 공개 읽기 전용이며 '
  '개인 식별 정보가 없습니다. 한 시간에 한 번만 실제로 셉니다. 사용자 수는 일부러 빼둡니다.';

REVOKE EXECUTE ON FUNCTION public.get_public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;

COMMIT;
