-- 248: 진단 값 $1.00 → $0.30.
--
-- 246 이 붙인 $1.00 은 잘못 잡은 값입니다. 근거가 "목표 전체를 보니까 카드 한 장 설명($0.50)의
-- 두 배"였는데, 그건 **일의 크기**로 정한 값이지 **학습자가 보는 사다리** 위의 자리로 정한
-- 값이 아닙니다. 사다리를 그대로 놓고 보면 그 실수가 보입니다:
--
--       객관식 해설            $0.05
--       이미지 / 카드 / 문항생성 / 단답채점  $0.10
--       서술형 문항 생성        $0.15
--       서술형 채점            $0.40
--       카드 한 장 설명         $0.50
--       진단                  $1.00   ← 혼자 꼭대기의 두 배
--
-- 앱의 다른 모든 것이 $0.05~$0.50 안에 있는데 하나만 $1.00 이면, 그건 "이건 특별합니다"가
-- 아니라 "이건 여기 물건이 아닙니다"로 읽힙니다. 그것도 아직 아무도 눌러본 적 없는 기능에서.
--
-- $0.30 은 일상적인 낱개 행동($0.10)보다 위, 꼭대기($0.50)보다 아래입니다. 그리고 이 버튼은
-- **눌려야** 값어치가 있는 종류입니다 — 한 번 써보고 쓸모 있으면 계속 쓰는 쪽이, 비싸서 아무도
-- 안 누르는 쪽보다 낫습니다. 안 눌린 $1.00 은 $0 입니다.
--
-- 원가는 그대로입니다. 프로덕션 원장 90일 132콜 평균이 입력 929 / 출력 441 토큰에 $0.0013 이고,
-- 진단은 입력이 더 커서 $0.002~0.004 정도입니다. $0.30 은 그 100배쯤이고, `price-floor.test.ts`
-- 가 요구하는 10배 바닥에서 한참 위입니다.
--
-- 230 의 규율을 따라 **절대값을 옛 값으로 가드**합니다. 곱셈은 멱등이 아니고 마이그레이션은
-- 정확히 한 번 실행되지 않습니다 — 로컬에 적용하고, 프로덕션에 적용하고, CI 가 처음부터
-- 다시 재생합니다. WHERE 절 덕분에 두 번째 실행은 아무 행도 건드리지 않습니다.
BEGIN;

UPDATE public.ai_action_prices
   SET price_micro = 300000,
       note = 'One whole-goal diagnosis: 30 days of graded answers read back as counted labels, '
              'plus the model''s grouping of the failing cards. Priced INSIDE the ladder the '
              'learner sees ($0.05-$0.50), not above it — a button that has to be pressed to be '
              'worth anything earns nothing at a price nobody presses.',
       updated_at = now()
 WHERE action = 'diagnosis' AND price_micro = 1000000;

COMMIT;
