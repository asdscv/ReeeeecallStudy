-- ============================================================================
-- 랜딩이 말하는 숫자는 **실제로 센 값**이어야 한다.
--
-- 지운 것이 무엇이었는지 기억해 둘 것: 활성 사용자 2,500명(실제 36명), 덱 5,000개
-- (실제 703개), Math.random() 으로 흔들리던 "지금 N명이 공부 중". 그 자리를 대신하는
-- 함수라면 최소한 세 가지를 지켜야 합니다.
--
--   1. 지금 테이블에 있는 것과 같은 값을 돌려준다 (박아둔 상수가 아니다)
--   2. 로그인하지 않은 방문자도 부를 수 있다 (랜딩은 로그아웃 상태다)
--   3. 스냅샷 테이블 자체는 클라이언트가 직접 읽을 수 없다
--
-- 그리고 한 시간 캐시가 실제로 캐시인지도 봅니다 — 방문마다 37만 행을 세면
-- 마케팅 페이지가 DB 부하가 됩니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- 캐시가 실제로 캐시인지 보려면 도중에 덱 하나를 만들어야 합니다. 빈 CI DB 에서도
-- 돌도록 주인을 직접 만듭니다.
INSERT INTO auth.users (id) VALUES ('c0000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v json;
  v_cards    bigint;
  v_decks    bigint;
  v_listings bigint;
  v_first    timestamptz;
  v_second   timestamptz;
BEGIN
  -- 첫 호출은 반드시 센다 (기본값 '-infinity' 라서).
  v := public.get_public_stats();
  IF v IS NULL THEN
    RAISE EXCEPTION 'FAIL: get_public_stats() 가 NULL 이다 — 스냅샷 행이 없다';
  END IF;

  SELECT count(*) INTO v_cards    FROM cards;
  SELECT count(*) INTO v_decks    FROM decks;
  SELECT count(*) INTO v_listings FROM marketplace_listings WHERE is_active;

  IF (v->>'cards_total')::bigint <> v_cards THEN
    RAISE EXCEPTION 'FAIL: 카드 수가 %인데 %라고 말한다', v_cards, v->>'cards_total';
  END IF;
  IF (v->>'decks_total')::bigint <> v_decks THEN
    RAISE EXCEPTION 'FAIL: 덱 수가 %인데 %라고 말한다', v_decks, v->>'decks_total';
  END IF;
  -- 내려간 리스팅까지 세면 방문자가 볼 수 없는 것을 자랑하게 됩니다.
  IF (v->>'listings_total')::bigint <> v_listings THEN
    RAISE EXCEPTION 'FAIL: 공개 리스팅이 %인데 %라고 말한다', v_listings, v->>'listings_total';
  END IF;

  -- 캐시: 곧바로 다시 불러도 다시 세지 않아야 한다.
  v_first := (v->>'refreshed_at')::timestamptz;
  INSERT INTO decks (user_id, name)
    VALUES ('c0000000-0000-4000-8000-000000000001', 'stats-cache-probe');
  v := public.get_public_stats();
  v_second := (v->>'refreshed_at')::timestamptz;
  IF v_second <> v_first THEN
    RAISE EXCEPTION 'FAIL: 한 시간 캐시가 동작하지 않는다 — 방문마다 전부 센다';
  END IF;
  IF (v->>'decks_total')::bigint <> v_decks THEN
    RAISE EXCEPTION 'FAIL: 캐시가 있다면서 값은 바뀌었다 — 둘 중 하나는 거짓말이다';
  END IF;

  -- 시간을 되돌리면 다시 세야 한다. 캐시가 아니라 그냥 얼어붙은 것이면 안 됩니다.
  UPDATE public_stats_snapshot SET refreshed_at = now() - interval '2 hours' WHERE id = 1;
  v := public.get_public_stats();
  IF (v->>'decks_total')::bigint <> v_decks + 1 THEN
    RAISE EXCEPTION 'FAIL: 한 시간이 지났는데도 다시 세지 않았다';
  END IF;
END $$;

-- 로그아웃 방문자가 부를 수 있어야 한다. 랜딩은 로그인 화면이 아니다.
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_public_stats()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon 이 get_public_stats() 를 부를 수 없다 — 랜딩은 로그아웃 상태다';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_public_stats()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated 가 get_public_stats() 를 부를 수 없다';
  END IF;
  -- 스냅샷 테이블 자체는 함수를 거쳐야 한다.
  IF has_table_privilege('anon', 'public.public_stats_snapshot', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon 이 스냅샷 테이블을 직접 읽는다 — 함수만 통과해야 한다';
  END IF;
END $$;

ROLLBACK;
