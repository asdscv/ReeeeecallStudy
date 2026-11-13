-- 282: Jev 단가 — 채점 원가가 추정치가 아니라 실제 값으로 남게 합니다.
--
-- #616 부터 주관식·서술형 채점을 Jev(TypeSafe)가 합니다. 원가 원장(`ai_cost_ledger`)은
-- `settle_ai_quiz` 가 `_ai_resolve_rate(provider, model)` 로 단가를 찾아 계산하는데, `typesafe`
-- 행이 없으면 `ai_pricing_settings` 의 비관적 대체 단가로 계산하고 `rate_missing` 을 켭니다.
-- 그 대체 단가는 LLM 기준이라 Jev 원가를 수십 배 부풀려 보고합니다.
--
-- 공시 단가 (docs.typesafe.ai/models, 2026-09-29): jev-1.13.0 — $0.042 / Mtok, **입력 토큰만**
-- 과금, 출력 토큰은 무료. 그래서 out 은 0 입니다.
--
-- model 은 요청에 쓴 별칭(`jev-latest`)이 아니라 응답이 알려 준 버전 ID 로 기록됩니다
-- (`ai-quiz-jev.ts`). 새 버전이 나오면 그 ID 로 행을 하나 더 넣어야 합니다 — 안 넣으면
-- `rate_missing` 이 켜지는 것으로 드러납니다.

BEGIN;

INSERT INTO ai_pricing_config (provider, model, in_micro_usd_per_mtok, out_micro_usd_per_mtok, note)
VALUES
  ('typesafe', 'jev-1.13.0', 42000, 0,
   'Published rate (docs.typesafe.ai/models): $0.042 per Mtok input; output tokens are free.');

COMMIT;
