-- 263: 원장 합이 잔액과 맞지 않았습니다. 이력을 고치지 않고 조정 항목으로 맞춥니다.
--
-- ── 무엇이 어긋났나 ─────────────────────────────────────────────────────────
--
-- 프로덕션 세 계정 중 둘에서 `sum(ai_credit_ledger.delta) <> ai_credit_balance.balance` 였습니다:
--
--       asdscv@…        잔액 999,997,401,915   원장 999,997,401,916   원장이 +1
--       simquiz@…       잔액       488,750,000   원장     -13,132,765   원장이 -501,882,765
--
-- 성격이 다릅니다.
--
-- `simquiz` 는 시뮬레이션 계정입니다. 확인한 것:
--
--       payment_intents          0건
--       원장의 양수(충전) 행     0건   — 78행 전부 차감(spend 26 + spend_quiz 52)
--       첫 원장 행               이미 spend 이고 balance_after 90,000
--       덱 2 · 카드 28 · 퀴즈 세트 29   (이름 그대로 퀴즈만 반복해 돌린 계정)
--
-- 즉 잔액 100,000 이 원장 없이 먼저 들어가 있었고, 이후 충전도 같은 식이었습니다. 돈이 샌
-- 것이 아니라 **하네스가 잔액을 직접 써 넣고 지급을 기록하지 않은 것**입니다. 실제로 쓴
-- $13.13 은 정상 경로로 나갔고 전부 기록돼 있습니다.
--
-- `asdscv` 의 1 micro($0.000001)는 2026-07-06 결제 한 건에서 시작해 그대로 이어졌습니다.
-- 커지지 않고, 지금 크레딧을 넣는 경로(`add_ai_credits`)는 잔액과 원장을 같은 값으로 함께
-- 쓰므로 재발 경로는 보이지 않습니다.
--
-- ── 왜 잔액이 아니라 원장을 고치나 ─────────────────────────────────────────
--
-- **잔액이 사실입니다.** 학습자가 실제로 쓸 수 있었던 돈이고, 모든 게이트가 그 숫자를 봤습니다.
-- 원장은 그 사실의 기록이고, 기록이 사실과 어긋나면 고칠 것은 기록입니다.
--
-- 그리고 지난 행을 **고쳐 쓰지 않습니다.** 원장은 append-only 로 다뤄야 하는 표입니다 —
-- 2026-07-06 의 결제 금액을 지금 와서 1 줄이면, 그날 실제로 청구된 금액과 우리 기록이
-- 달라집니다. 차액만큼의 조정 항목을 **새로** 답니다. 회계에서 하는 방식 그대로입니다.
--
-- ── 다시 벌어지면 CI 가 잡습니다 ───────────────────────────────────────────
--
-- `ledger_reconciles_test.sql` 이 충전·차감·환불을 한 바퀴 돌린 뒤 합과 잔액이 같은지 봅니다.
-- 이 마이그레이션은 남은 자국을 지우는 것이고, 그 테스트가 코드 경로를 지킵니다.
BEGIN;

WITH drift AS (
  SELECT b.user_id,
         b.balance,
         b.balance - COALESCE((SELECT sum(l.delta) FROM ai_credit_ledger l
                                WHERE l.user_id = b.user_id), 0) AS adjustment
    FROM ai_credit_balance b
)
INSERT INTO public.ai_credit_ledger (user_id, delta, reason, ref, balance_after)
SELECT d.user_id, d.adjustment, 'admin_adjustment',
       -- ref 는 멱등키입니다. 양수 조정은 `ai_credit_ledger_grant_ref` 유니크 인덱스가
       -- 두 번 들어가는 것을 막고, 음수 조정은 두 번째 실행 때 drift 가 0 이라 뽑히지 않습니다.
       'reconcile:263:' || d.user_id::text,
       d.balance
  FROM drift d
 WHERE d.adjustment <> 0
ON CONFLICT DO NOTHING;

COMMIT;
