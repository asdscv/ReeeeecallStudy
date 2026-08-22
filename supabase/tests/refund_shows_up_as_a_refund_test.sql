-- ============================================================================
-- 돌려준 돈은 결제 내역에서도 돌려준 돈이어야 한다 (mig 274).
--
-- 왜 있는가. 2026-08-22, 첫 안드로이드 실결제(₩5,900)를 Play API 로 전액 환불했다.
-- 구글은 REFUNDED, 구독은 EXPIRED, 우리 billing_subscriptions 도 내려갔다. 그런데
-- **결제 내역은 "결제 완료"로 남아 있었다.** 구독 결제를 환불로 뒤집는 경로가 처음부터
-- 없었기 때문이다 — 127 의 clawback_credits 는 kind='credit_pack' 전용이다.
--
-- 175 가 크레딧팩에서 고쳤던 것과 같은 문제다: 돌려준 돈이 화면에서는 받은 돈으로 남는 것.
--
-- 여기서 고정하는 것:
--   1) 회수하면 그 구독의 영수증도 함께 뒤집힌다 (같은 트랜잭션)
--   2) 남의 영수증은 건드리지 않는다 — 주문번호가 같아도 사용자가 다르면 그대로
--   3) 크레딧팩 영수증은 건드리지 않는다 — 그건 clawback_credits 의 몫이다
--   4) 재전송된 웹훅은 아무것도 두 번 뒤집지 않는다 (receipts_refunded = 0)
--   5) 매칭되는 영수증이 없어도 회수 자체는 성공한다 — 273 이전 결제에는 영수증이 없다
--
-- 트랜잭션 안에서 돌고 ROLLBACK 한다 → 데이터를 남기지 않는다. 접속 롤은 superuser 라
-- GRANT 는 막지 않고, RPC 는 request.jwt 에서 읽은 auth.role() 로 가드한다.
-- ============================================================================
\set ON_ERROR_STOP on
\set alice '''d7000000-0000-4000-8000-0000000000a1'''
\set bob   '''d7000000-0000-4000-8000-0000000000a2'''

BEGIN;
SET session_replication_role = replica;
SELECT set_config('request.jwt.claim.role', 'service_role', false);

INSERT INTO auth.users (id) VALUES (:alice), (:bob) ON CONFLICT DO NOTHING;

-- 같은 스토어 주문번호를 두 사람에게 붙인다. 현실에서는 안 겹치지만, 겹쳤을 때
-- 남의 영수증이 뒤집히면 그건 환불 사고다. 그래서 일부러 겹쳐 둔다.
INSERT INTO billing_subscriptions
  (user_id, product_id, tier, status, card_limit, provider, provider_subscription_id, current_period_end)
VALUES
  (:alice, 'sub_5k_monthly', 'plan_5k', 'active', 100000, 'revenuecat', 'GPA.REFUND-PROBE', now() + interval '30 days'),
  (:bob,   'sub_5k_monthly', 'plan_5k', 'active', 100000, 'revenuecat', 'GPA.OTHER-PROBE',  now() + interval '30 days');

INSERT INTO payment_intents
  (merchant_uid, user_id, product_id, kind, amount_krw, amount_micro_usd,
   status, provider, provider_payment_id, platform, paid_at)
VALUES
  -- 앨리스의 구독 영수증 — 이것만 뒤집혀야 한다
  ('pi_refund_probe_alice', :alice, 'sub_5k_monthly', 'subscription', 5900, 3990000,
   'paid', 'revenuecat', 'GPA.REFUND-PROBE', 'android', now()),
  -- 밥의 영수증. 주문번호가 같지만 주인이 다르다
  ('pi_refund_probe_bob',   :bob,   'sub_5k_monthly', 'subscription', 5900, 3990000,
   'paid', 'revenuecat', 'GPA.REFUND-PROBE', 'android', now()),
  -- 앨리스의 크레딧팩. 주문번호까지 같지만 kind 가 다르다
  ('pi_refund_probe_pack',  :alice, 'credits_1000', 'credit_pack', 1000, 990000,
   'paid', 'revenuecat', 'GPA.REFUND-PROBE', 'android', now());

DO $$
DECLARE
  v_alice uuid := 'd7000000-0000-4000-8000-0000000000a1';
  v_bob   uuid := 'd7000000-0000-4000-8000-0000000000a2';
  v_res   json;
  v_st    text;
BEGIN
  -- ── 1) 회수하면 영수증도 뒤집힌다 ───────────────────────────────────────
  v_res := public.revoke_subscription('revenuecat', 'GPA.REFUND-PROBE');

  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 회수가 실패했다 — %', v_res::text;
  END IF;
  IF (v_res->>'receipts_refunded')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: 뒤집힌 영수증이 %건이다 — 1건이어야 한다 (%)',
      v_res->>'receipts_refunded', v_res::text;
  END IF;

  SELECT status INTO v_st FROM billing_subscriptions
   WHERE user_id = v_alice AND provider_subscription_id = 'GPA.REFUND-PROBE';
  IF v_st <> 'refunded' THEN
    RAISE EXCEPTION 'FAIL: 구독이 회수되지 않았다 (%)', v_st;
  END IF;

  SELECT status INTO v_st FROM payment_intents WHERE merchant_uid = 'pi_refund_probe_alice';
  IF v_st <> 'refunded' THEN
    RAISE EXCEPTION 'FAIL: 환불했는데 결제 내역이 아직 % 다', v_st;
  END IF;

  -- ── 2) 남의 영수증은 그대로 ─────────────────────────────────────────────
  SELECT status INTO v_st FROM payment_intents WHERE merchant_uid = 'pi_refund_probe_bob';
  IF v_st <> 'paid' THEN
    RAISE EXCEPTION 'FAIL: 남의 영수증을 % 로 바꿨다 — 환불 사고다', v_st;
  END IF;
  SELECT status INTO v_st FROM billing_subscriptions
   WHERE user_id = v_bob AND provider_subscription_id = 'GPA.OTHER-PROBE';
  IF v_st <> 'active' THEN
    RAISE EXCEPTION 'FAIL: 남의 구독이 % 가 됐다', v_st;
  END IF;

  -- ── 3) 크레딧팩은 clawback_credits 의 몫이다 ────────────────────────────
  SELECT status INTO v_st FROM payment_intents WHERE merchant_uid = 'pi_refund_probe_pack';
  IF v_st <> 'paid' THEN
    RAISE EXCEPTION 'FAIL: 크레딧팩 영수증을 구독 회수가 % 로 바꿨다 — 크레딧은 회수되지 않았는데', v_st;
  END IF;

  -- ── 4) 재전송은 아무것도 두 번 뒤집지 않는다 ────────────────────────────
  v_res := public.revoke_subscription('revenuecat', 'GPA.REFUND-PROBE');
  IF (v_res->>'receipts_refunded')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: 재전송이 영수증을 %건 더 뒤집었다', v_res->>'receipts_refunded';
  END IF;
  SELECT status INTO v_st FROM payment_intents WHERE merchant_uid = 'pi_refund_probe_alice';
  IF v_st <> 'refunded' THEN
    RAISE EXCEPTION 'FAIL: 재전송 후 영수증이 % 가 됐다', v_st;
  END IF;

  -- ── 5) 영수증이 없어도 회수는 성공한다 ──────────────────────────────────
  -- 273 이전에 결제한 사람에게는 영수증 행이 없다. 그때 회수가 실패하면
  -- 환불받은 사람이 계속 쓰게 된다 — 영수증보다 회수가 먼저다.
  v_res := public.revoke_subscription('revenuecat', 'GPA.OTHER-PROBE');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 영수증 없는 구독의 회수가 실패했다 — %', v_res::text;
  END IF;
  IF (v_res->>'receipts_refunded')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: 매칭되지 않아야 할 영수증이 %건 뒤집혔다', v_res->>'receipts_refunded';
  END IF;

  RAISE NOTICE 'OK: 환불이 결제 내역까지 도달한다';
END $$;

ROLLBACK;
