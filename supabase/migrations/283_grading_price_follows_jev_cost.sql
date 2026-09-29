-- 283: 채점 가격을 Jev 원가에 맞춰 내립니다. 문제 생성 가격은 손대지 않습니다.
--
-- #616/#617 로 주관식·서술형 채점이 Jev 로 넘어가면서 채점 원가가 10~20배 더 떨어졌습니다
-- (LLM 채점기 시절 마진 94~97% → 지금 99%대). 그 절감분을 채점 가격에만 반영합니다 — 문제
-- 생성은 여전히 LLM 이 하고 원가가 그대로라, 같이 내리면 원가 근거 없이 마진만 깎입니다.
--
-- `ai_quiz_price_units` 의 units 를 반으로 줄입니다. 단가(`quiz_unit_price_micro`)는 모든
-- 액션이 공유하므로, 여기서 건드리지 않고 그리딩 두 행의 units 만 반으로 줄이는 것이
-- 문제 생성에 영향 없이 채점만 반값으로 만드는 제일 작은 변경입니다.
--
--   grade_short : 2 units → 1 unit   ($0.01 → $0.005)
--   grade_essay : 4 units → 2 units  ($0.02 → $0.01)
--
-- price-floor.test.ts 로 확인한 안전선: Jev 가 아니라 **LLM 폴백 그레이더의 원가**를 기준으로
-- 잡습니다(폴백이 항상 걸릴 수 있는 경로라서). gemini-2.5-flash(체인에서 제일 비싼 모델) 기준
-- 실측 토큰으로:
--   grade_short : 원가 ~350 micro → 반값(5,000)도 원가의 14.3배 (플로어 10배 여유 있게 통과)
--   grade_essay : 원가 ~889 micro → 반값(10,000)은 원가의 11.25배 — 그 테스트 파일 자신이
--     적어 둔 안전 배수(2×3×1.25×1.5=11.25, 10으로 내림)와 정확히 같은 값입니다. 그 이상은
--     못 내립니다 — 더 내리면 Jev 가 아니라 LLM 폴백이 걸렸을 때 밑지고 파는 값이 됩니다.

BEGIN;

UPDATE ai_quiz_price_units SET units = 1 WHERE action = 'grade_short';
UPDATE ai_quiz_price_units SET units = 2 WHERE action = 'grade_essay';

COMMIT;
