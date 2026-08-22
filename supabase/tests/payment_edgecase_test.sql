-- ============================================================================
-- payment_edgecase_test.sql — mig 144 payment edge-case hardening assertions.
--
-- Drives the subscription/refund RPCs directly (service_role for webhook RPCs,
-- authenticated for create_payment_intent) and asserts the audit fixes:
--   P-H2  a refunded sub is NOT resurrected by a redelivered first-grant (activate)
--   P-H1  a superseded (retired) row is lapsed now + an entitled UPDATE that would
--         collide with an active sibling returns {ok:false,'active_conflict'} (no 23505)
--   P-M2  an EXPIRED row IS resurrectable by a real renewal carrying a FUTURE period
--   P-L3  confirm_payment short-circuits any non-pending intent (no refunded→paid regress);
--         activate refuses a non-pending intent
--   P-M3  create_payment_intent REUSES an existing pending subscription intent
--   P-H5  a live LemonSqueezy subscriber can't open a new subscription checkout
--   P-L4  the top plan carries a FINITE cap (mig 148) — no unlimited short-circuit
--   P-H3  clawback_credits caps at (granted − already-clawed); clawback_credits_partial
--         reverses a specific amount, idempotent per cancel ref
--   P-L2  transfer_subscriptions_by_user moves a user's subs (RevenueCat TRANSFER)
--
-- Runs in a txn and ROLLBACKs → leaves no data.
-- ============================================================================
\set ON_ERROR_STOP on
\set b1 '''f4000000-0000-0000-0000-0000000000b1'''
\set b2 '''f4000000-0000-0000-0000-0000000000b2'''
\set b3 '''f4000000-0000-0000-0000-0000000000b3'''
\set b4 '''f4000000-0000-0000-0000-0000000000b4'''
\set b5 '''f4000000-0000-0000-0000-0000000000b5'''
\set b6 '''f4000000-0000-0000-0000-0000000000b6'''
\set b7 '''f4000000-0000-0000-0000-0000000000b7'''
\set cmp '''f4000000-0000-0000-0000-0000000000c0'''

BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES
 (:b1),(:b2),(:b3),(:b4),(:b5),(:b6),(:b7),(:cmp) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES
 (:b1,'user'),(:b2,'user'),(:b3,'user'),(:b4,'user'),(:b5,'user'),(:b6,'user'),(:b7,'user'),(:cmp,'user')
 ON CONFLICT (id) DO UPDATE SET role='user';
UPDATE card_limit_settings SET max_owned_cards=1000, count_official_cards=false WHERE id=1;

SET session_replication_role = DEFAULT;

-- Helper to run as service_role (webhook RPCs) / authenticated (create_payment_intent).
-- (psql connection role is postgres/superuser, so GRANTs never block; the RPCs gate on
--  auth.role()/auth.uid() read from these request.jwt settings.)

-- ═══ P-H2: refunded sub NOT resurrected by a redelivered activate ═══
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b1',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
-- 한도 숫자는 **데이터에서 읽습니다.**
--
-- 5000(플랜)과 1000(무료)을 손으로 적어 두었더니 268 이 값을 100,000/5,000 으로 바꾸는 순간
-- 이 파일이 다섯 군데서 터졌습니다. 확인하려는 것은 "5000 이다"가 아니라 **결제하면 오르고,
-- 환불하면 무료 한도로 돌아온다**는 관계입니다. 관계를 확인하되 숫자는 카탈로그에서 읽습니다.
CREATE OR REPLACE FUNCTION pg_temp._plan_cap() RETURNS integer LANGUAGE sql STABLE AS
$fn$ SELECT card_limit FROM billing_products WHERE id = 'sub_5k_monthly' $fn$;
CREATE OR REPLACE FUNCTION pg_temp._free_cap() RETURNS integer LANGUAGE sql STABLE AS
$fn$ SELECT max_owned_cards FROM card_limit_settings WHERE id = 1 $fn$;

DO $$
DECLARE v_mu text; v_res json;
BEGIN
  v_mu := (public.create_payment_intent('sub_5k_monthly'))->>'merchant_uid';
  ASSERT v_mu IS NOT NULL, 'intent created';

  PERFORM set_config('request.jwt.claim.role','service_role',false);
  v_res := public.activate_subscription_from_intent(v_mu,'lemonsqueezy','LSSUB1', now()+interval '30 days');
  ASSERT (v_res->>'status') = 'active', 'activate → active';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b1'::uuid) = pg_temp._plan_cap(), 'cap raised to the plan cap';

  PERFORM public.revoke_subscription('lemonsqueezy','LSSUB1');
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b1'::uuid) = pg_temp._free_cap(), 'cap back to the free cap after refund';

  -- redelivered first-grant must NOT resurrect the refunded row.
  -- 274 부터 회수가 영수증까지 뒤집으므로, 이 재전송은 P-H2(구독 행 부활 금지) 이전에
  -- P-L3(죽은 인텐트로는 지급하지 않는다)에 먼저 걸린다. 막히는 결과는 같고 이유만
  -- 더 정확해진다. 아래에서 P-H2 도 따로 붙잡는다.
  v_res := public.activate_subscription_from_intent(v_mu,'lemonsqueezy','LSSUB1', now()+interval '30 days');
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'reason') = 'intent_refunded', 'redelivered activate → 죽은 인텐트에서 막힌다 (P-L3)';
  ASSERT (SELECT status FROM billing_subscriptions WHERE provider='lemonsqueezy' AND provider_subscription_id='LSSUB1') = 'refunded',
         'row stays refunded';
  ASSERT (SELECT status FROM payment_intents WHERE merchant_uid = v_mu) = 'refunded',
         '회수가 영수증까지 뒤집는다 (274)';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b1'::uuid) = pg_temp._free_cap(), 'cap NOT restored (P-H2)';

  -- P-H2 는 계속 살아 있어야 한다. 영수증이 살아남는 회수 — 274 의 매칭이 걸리지 않는
  -- 결제(레몬스퀴지가 주문 id 를 따로 적은 경우) — 에서는 인텐트가 'paid' 인 채로 남고,
  -- 그때 재전송을 막는 것은 P-H2 뿐이다. 그 상태를 손으로 만들어 확인한다.
  UPDATE payment_intents SET status = 'paid' WHERE merchant_uid = v_mu;
  v_res := public.activate_subscription_from_intent(v_mu,'lemonsqueezy','LSSUB1', now()+interval '30 days');
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'reason') = 'terminal', 'redelivered activate → terminal (P-H2)';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b1'::uuid) = pg_temp._free_cap(), 'cap NOT restored (P-H2)';
END $$;

-- ═══ P-H1: supersede retire lapses the period + entitled UPDATE conflict → ACK ═══
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE v_res json;
BEGIN
  -- b2 subscribes 5k, then is superseded by an admin comp (different provider row).
  PERFORM public.grant_subscription('f4000000-0000-0000-0000-0000000000b2'::uuid,'sub_5k_monthly','lemonsqueezy','LSREF2', now()+interval '30 days');
  -- Simulate the LS-recorded sub id on that row so lifecycle events can match it.
  UPDATE billing_subscriptions SET provider_subscription_id='LSX2'
   WHERE user_id='f4000000-0000-0000-0000-0000000000b2' AND provider='lemonsqueezy' AND status='active';

  -- admin comp grant supersedes → the LS row must be retired to expired + period lapsed (P-H1).
  PERFORM public.grant_subscription('f4000000-0000-0000-0000-0000000000b2'::uuid,'sub_unlimited_monthly','admin','COMP2', NULL);
  ASSERT (SELECT status FROM billing_subscriptions WHERE provider='lemonsqueezy' AND provider_subscription_id='LSX2') = 'expired',
         'superseded LS row → expired';
  ASSERT (SELECT current_period_end FROM billing_subscriptions WHERE provider='lemonsqueezy' AND provider_subscription_id='LSX2') <= now(),
         'superseded LS row period lapsed to now() (P-H1)';

  -- LS keeps billing → subscription_updated arrives with a FUTURE period. The guard allows it
  -- (future renewal, P-M2) so it TRIES to reactivate, but the admin comp is active → the
  -- one-active index would 23505; sync_subscription must catch it and ACK (P-H1).
  v_res := public.sync_subscription('lemonsqueezy','LSX2','active', now()+interval '30 days', false);
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'reason') = 'active_conflict', 'sync on superseded row w/ active sibling → active_conflict (P-H1)';
  ASSERT (SELECT count(*) FROM billing_subscriptions WHERE user_id='f4000000-0000-0000-0000-0000000000b2' AND status='active') = 1,
         'still exactly one active row (the comp)';
END $$;

-- ═══ P-M2: an EXPIRED row IS resurrectable by a real future-period renewal ═══
DO $$
DECLARE v_res json;
BEGIN
  -- b3 has ONLY a lapsed expired LS row (no active sibling).
  INSERT INTO billing_subscriptions (user_id, product_id, tier, status, card_limit, provider, provider_subscription_id, current_period_end)
    VALUES ('f4000000-0000-0000-0000-0000000000b3','sub_5k_monthly','plan_5k','expired',pg_temp._plan_cap(),'lemonsqueezy','LSY3', now()-interval '1 day');
  v_res := public.sync_subscription('lemonsqueezy','LSY3','active', now()+interval '30 days', false);
  ASSERT (v_res->>'ok') = 'true' AND (v_res->>'status') = 'active', 'expired + future renewal → reactivates (P-M2)';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b3'::uuid) = pg_temp._plan_cap(), 'cap restored by the legit renewal';

  -- but a REFUNDED row is never resurrected (P-H2 core)
  INSERT INTO billing_subscriptions (user_id, product_id, tier, status, card_limit, provider, provider_subscription_id, current_period_end)
    VALUES ('f4000000-0000-0000-0000-0000000000b3','sub_5k_monthly','plan_5k','refunded',pg_temp._plan_cap(),'lemonsqueezy','LSR3', now()-interval '1 day');
  v_res := public.sync_subscription('lemonsqueezy','LSR3','active', now()+interval '30 days', false);
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'reason') = 'terminal', 'refunded never resurrected';
END $$;

-- ═══ P-L3: confirm_payment short-circuits non-pending; activate refuses non-pending ═══
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b4',false);
DO $$
DECLARE v_mu text; v_res json;
BEGIN
  v_mu := (public.create_payment_intent('credits_1000'))->>'merchant_uid';
  PERFORM set_config('request.jwt.claim.role','service_role',false);
  v_res := public.confirm_payment(v_mu,'toss','pay1');
  ASSERT (v_res->>'ok') = 'true', 'credit pack confirmed';
  -- refund it, then a redelivered confirm must NOT regress refunded→paid
  PERFORM public.clawback_credits(v_mu);
  ASSERT (SELECT status FROM payment_intents WHERE merchant_uid=v_mu) = 'refunded', 'intent refunded';
  v_res := public.confirm_payment(v_mu,'toss','pay1');
  ASSERT (v_res->>'already') = 'true', 'redelivered confirm → already (no regress, P-L3)';
  ASSERT (SELECT status FROM payment_intents WHERE merchant_uid=v_mu) = 'refunded', 'intent still refunded (no regress)';
END $$;

DO $$
DECLARE v_mu text; v_res json;
BEGIN
  -- an expired subscription intent must not grant
  PERFORM set_config('request.jwt.claim.role','authenticated',false);
  PERFORM set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b4',false);
  v_mu := (public.create_payment_intent('sub_5k_monthly'))->>'merchant_uid';
  UPDATE payment_intents SET status='expired' WHERE merchant_uid=v_mu;
  PERFORM set_config('request.jwt.claim.role','service_role',false);
  v_res := public.activate_subscription_from_intent(v_mu,'toss','TOSS4', now()+interval '30 days');
  ASSERT (v_res->>'ok') = 'false' AND (v_res->>'reason') = 'intent_expired', 'activate on expired intent → refused (P-L3)';
END $$;

-- ═══ P-M3: create_payment_intent reuses an existing pending subscription intent ═══
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b5',false);
DO $$
DECLARE v_mu1 text; v_r2 json;
BEGIN
  v_mu1 := (public.create_payment_intent('sub_5k_monthly'))->>'merchant_uid';
  v_r2  := public.create_payment_intent('sub_5k_monthly');
  ASSERT (v_r2->>'merchant_uid') = v_mu1, 'second create reuses the pending intent (P-M3)';
  ASSERT (v_r2->>'reused') = 'true', 'reused flag set';
  ASSERT (SELECT count(*) FROM payment_intents WHERE user_id='f4000000-0000-0000-0000-0000000000b5' AND kind='subscription' AND status='pending') = 1,
         'exactly one pending sub intent (no double-charge)';
END $$;

-- ═══ P-H5: a live LemonSqueezy subscriber cannot open a new subscription checkout ═══
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$ BEGIN
  PERFORM public.grant_subscription('f4000000-0000-0000-0000-0000000000b6'::uuid,'sub_5k_monthly','lemonsqueezy','LSREF6', now()+interval '30 days');
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b6',false);
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    -- **판매 중인** 상품으로 겁니다. 267 이 Pro 를 내린 뒤로 이 자리에서 체크아웃은
    -- "Unknown or inactive product" 로 먼저 막혀, 정작 확인하려던 포털 안내(P-H5)에
    -- 닿지 못했습니다. 확인하려는 것은 상품이 아니라 **이미 구독 중인 사람의 플랜 전환**입니다.
    PERFORM public.create_payment_intent('sub_5k_monthly');
    ASSERT false, 'expected a live-LS-subscriber plan-switch checkout to be rejected (P-H5)';
  EXCEPTION WHEN others THEN
    v_err := SQLERRM;
    -- 확인하려는 것은 **거절된다**는 사실입니다.
    --
    -- 원래 문구는 "billing portal 로 가라"였고, 그건 플랜을 **바꾸려는** 구독자에게 나옵니다.
    -- 267 이 구독을 하나로 줄이면서 바꿀 플랜이 없어졌고, 같은 사람이 같은 플랜을 다시 사려
    -- 하면 "Already subscribed to this plan" 이 먼저 나옵니다. 둘 다 "이미 구독 중인 사람의
    -- 체크아웃은 열리지 않는다"는 같은 규칙이고, 그것이 이 케이스가 지키려던 것입니다.
    ASSERT v_err LIKE '%billing portal%' OR v_err LIKE '%Already subscribed%',
      'a live subscriber must not get a checkout (P-H5): ' || v_err;
  END;
END $$;

-- ═══ P-L4: the top plan carries a FINITE cap (mig 148) — no unlimited short-circuit ═══
-- Before mig 148 the top plan seeded card_limit 2e9, which tripped the >= 1e9 sentinel in
-- get_active_card_threshold: it returned NULL *without scanning*. Mig 148 capped the plan at
-- 100,000, so it now behaves like any other paid tier — the cap is real and the archive
-- threshold is computed by an actual scan. The 2e9 sentinel survives only for admins
-- (mig 139 _owned_card_limit CASE); that branch stays covered by card_limit_guard_test.sql.
SELECT set_config('request.jwt.claim.role','service_role',false);
SET session_replication_role = replica;
INSERT INTO card_templates (id,user_id,name) VALUES ('f4000000-0000-0000-0000-00000000ff07', :b7,'T7');
INSERT INTO decks (id,user_id,name) VALUES ('f4d00000-0000-0000-0000-000000000007', :b7,'D7');
-- Stagger created_at: now() is fixed for the whole txn, so a plain DEFAULT would give all 5
-- cards the SAME timestamp and the archive boundary (an ORDER BY created_at OFFSET) would be
-- ambiguous — "cards newer than the boundary" would count 0 and prove nothing.
INSERT INTO cards (deck_id,user_id,template_id,sort_position,created_at)
SELECT 'f4d00000-0000-0000-0000-000000000007', :b7,'f4000000-0000-0000-0000-00000000ff07',
       g, now() - (10 - g) * interval '1 minute'
FROM generate_series(1,5) g;
SET session_replication_role = DEFAULT;
DO $$ BEGIN
  ASSERT (SELECT card_limit FROM billing_products WHERE id='sub_unlimited_monthly') = 100000,
         'top-plan catalog row carries the finite mig-148 cap (not the retired 2e9 seed)';
  PERFORM public.grant_subscription('f4000000-0000-0000-0000-0000000000b7'::uuid,'sub_unlimited_monthly','test','UNL7', now()+interval '30 days');
  ASSERT (SELECT card_limit FROM billing_subscriptions
            WHERE user_id='f4000000-0000-0000-0000-0000000000b7' AND status='active') = 100000,
         'grant_subscription copies the product cap onto the subscription row (P-L4)';
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b7',false);
DO $$
DECLARE j json;
BEGIN
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b7'::uuid) = 100000,
         'top-plan effective cap = 100,000 (P-L4)';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b7'::uuid) < 1000000000,
         'top plan sits BELOW the 1e9 sentinel → the cap is enforced, not short-circuited';
  -- honest meter: a paid plan must never be advertised as unlimited
  j := public.get_card_usage_detail();
  ASSERT (j->>'is_unlimited')::boolean = false, 'top plan is NOT reported unlimited (P-L4)';
  ASSERT (j->>'card_limit')::int = 100000,      'meter reports the 100,000 cap (P-L4)';
  ASSERT public.get_active_card_threshold() IS NULL,
         'under cap → nothing to archive (P-L4)';
END $$;

-- …and the boundary REALLY materializes once the limit is exceeded — exactly what the old 2e9
-- sentinel made impossible. Squeeze b7's own subscription cap to 3 (< the 5 cards owned).
SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE billing_subscriptions SET card_limit = 3 WHERE user_id = :b7 AND status = 'active';
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$
DECLARE v_thr timestamptz; j json;
BEGIN
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b7'::uuid) = 3,
         'squeezed subscription cap applies (P-L4)';
  ASSERT public._owned_card_over_cap('f4000000-0000-0000-0000-0000000000b7'::uuid) = true,
         'finite plan over cap → _owned_card_over_cap true, no sentinel bypass (P-L4)';
  v_thr := public.get_active_card_threshold();
  ASSERT v_thr IS NOT NULL,
         'a finite cap runs the threshold scan (the 2e9 plan never reached it)';
  ASSERT (SELECT count(*) FROM cards c JOIN decks d ON d.id = c.deck_id
           WHERE d.user_id = 'f4000000-0000-0000-0000-0000000000b7'
             AND c.created_at > v_thr) = 2,
         'exactly the 2 newest of 5 cards fall outside the 3-card boundary (P-L4)';
  j := public.get_card_usage_detail();
  ASSERT (j->>'archived_total')::int = 2, 'meter reports 2 archived under the finite cap (P-L4)';
END $$;

-- ═══ P-H3: clawback cap + partial clawback (money = bigint micro-WON) ═══
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-0000000000b4',false);
DO $$
DECLARE v_mu text; v_res json;
BEGIN
  v_mu := (public.create_payment_intent('credits_10000'))->>'merchant_uid';  -- 9,990,000 micro-USD ($9.99, mig 145)
  PERFORM set_config('request.jwt.claim.role','service_role',false);
  PERFORM public.confirm_payment(v_mu,'toss','pay10k');

  -- partial reverse $3 (3,000,000 micro-USD), idempotent per cancel key
  v_res := public.clawback_credits_partial(v_mu, 3000000, v_mu||':k1');
  ASSERT (v_res->>'clawed_micro')::bigint = 3000000, 'partial claws $3';
  ASSERT (SELECT status FROM payment_intents WHERE merchant_uid=v_mu) = 'paid', 'still paid after partial';
  v_res := public.clawback_credits_partial(v_mu, 3000000, v_mu||':k1');
  ASSERT (v_res->>'already') = 'true', 'partial idempotent on cancel key';

  -- full clawback claws only the REMAINDER (9,990,000 − 3,000,000 = 6,990,000), not the full grant (P-H3 cap)
  v_res := public.clawback_credits(v_mu);
  ASSERT (v_res->>'clawed_micro')::bigint = 6990000, 'full clawback caps at remainder (P-H3)';
  ASSERT (SELECT status FROM payment_intents WHERE merchant_uid=v_mu) = 'refunded', 'intent refunded after full';
  -- total reversed across ledger = exactly the granted 9,990,000
  ASSERT (SELECT -SUM(delta) FROM ai_credit_ledger WHERE reason='refund'
            AND (ref='refund:'||v_mu OR ref LIKE 'refund:'||v_mu||':%')) = 9990000,
         'total reversed = granted amount exactly';
END $$;

-- ═══ P-L2: transfer_subscriptions_by_user moves a user's subs on TRANSFER ═══
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE v_res json;
BEGIN
  PERFORM public.sync_subscription_by_user('f4000000-0000-0000-0000-0000000000b4'::uuid,'sub_5k_monthly','revenuecat','RC_A','active', now()+interval '30 days', false);
  PERFORM public.sync_subscription_by_user('f4000000-0000-0000-0000-0000000000b5'::uuid,'sub_unlimited_monthly','revenuecat','RC_B','active', now()+interval '30 days', false);
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b4'::uuid) = pg_temp._plan_cap(), 'b4 has RC_A cap';

  v_res := public.transfer_subscriptions_by_user('revenuecat','f4000000-0000-0000-0000-0000000000b4'::uuid,'f4000000-0000-0000-0000-0000000000b5'::uuid);
  ASSERT (v_res->>'moved')::int = 1, 'moved 1 row';
  ASSERT (SELECT user_id FROM billing_subscriptions WHERE provider='revenuecat' AND provider_subscription_id='RC_A') = 'f4000000-0000-0000-0000-0000000000b5',
         'RC_A now owned by b5 (P-L2)';
  ASSERT public._owned_card_limit('f4000000-0000-0000-0000-0000000000b4'::uuid) = pg_temp._free_cap(), 'b4 cap gone (transferred away)';
  ASSERT (SELECT count(*) FROM billing_subscriptions WHERE user_id='f4000000-0000-0000-0000-0000000000b5' AND status='active') = 1,
         'b5 has exactly one active (RC_A; RC_B retired)';
END $$;

SELECT set_config('request.jwt.claim.role','',false);
SELECT set_config('request.jwt.claim.sub','',false);

ROLLBACK;

\echo 'PAYMENT_EDGECASE_TEST_PASSED'
