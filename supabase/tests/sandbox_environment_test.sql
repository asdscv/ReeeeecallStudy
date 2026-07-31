-- ============================================================================
-- sandbox_environment_test.sql — sandbox vs production isolation (mig 159).
--
-- The point of mig 159 is that turning on the RevenueCat SANDBOX webhook — which
-- you must do to test IAP at all — can never (a) mint spendable credits by itself
-- or (b) move a business metric. These assertions pin both, plus the switch that
-- deliberately opens (a) for a test run.
--
-- What it covers:
--   system_flags.sandbox_grants_enabled   default FALSE; admin-toggleable; exposed
--                                         by get_system_flags(); non-admin 42501
--   sandbox_grants_enabled()              the webhook's predicate tracks the flag
--   admin_billing_overview                a sandbox subscription is absent from
--                                         active_subscriptions / MRR / canceling /
--                                         past_due / refunds_30d, and reported
--                                         separately instead of hidden
--   admin_list_subscriptions / _payments  expose `environment` so a human can tell
--                                         a test purchase from a real one
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role()/is_admin() from request.jwt.
-- ============================================================================
\set ON_ERROR_STOP on
\set adm  '''d9000000-0000-0000-0000-0000000000a1'''
\set sbx  '''d9000000-0000-0000-0000-0000000000a2'''
\set prod '''d9000000-0000-0000-0000-0000000000a3'''

BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:adm),(:sbx),(:prod) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:adm,'admin'),(:sbx,'user'),(:prod,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- One sandbox subscription + one production subscription, same plan, both active.
-- If the overview counted environment-blind, every metric below would double.
INSERT INTO billing_subscriptions
  (id, user_id, product_id, tier, status, card_limit, provider,
   provider_subscription_id, platform, environment, current_period_end, created_at, updated_at)
VALUES
  ('d9000000-0000-0000-0000-00000000b001', :sbx,  'sub_5k_monthly','standard','active',5000,
   'revenuecat','otx_sbx_1','ios','sandbox',    now() + interval '20 days', now(), now()),
  ('d9000000-0000-0000-0000-00000000b002', :prod, 'sub_5k_monthly','standard','active',5000,
   'revenuecat','otx_prod_1','ios','production', now() + interval '20 days', now(), now());

-- A sandbox credit grant (what a tester purchase produces once the switch is open).
INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, platform, environment, created_at)
VALUES (:sbx, 990000, 'purchase', 'rc:SBXTEST1', 990000, 'ios', 'sandbox', now());

SET session_replication_role = DEFAULT;

-- ═══ 1) the kill switch ═════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  -- DEFAULT FALSE is the whole safety property: enabling the sandbox webhook must
  -- not, by itself, let a free purchase mint credits.
  ASSERT public.sandbox_grants_enabled() = false,
    'sandbox grants are OFF by default';
END $$;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE f json;
BEGIN
  f := public.admin_set_system_flags(p_sandbox_grants_enabled := true);
  ASSERT (f->>'sandbox_grants_enabled')::boolean = true, 'admin can open the switch';
  ASSERT (public.get_system_flags()->>'sandbox_grants_enabled')::boolean = true,
    'get_system_flags surfaces the flag for the admin UI';

  -- The other flags must survive a partial update (COALESCE semantics, mig 153).
  ASSERT (public.get_system_flags()->>'payments_enabled')::boolean = true,
    'setting one flag does not clobber the others';

  f := public.admin_set_system_flags(p_sandbox_grants_enabled := false);
  ASSERT (f->>'sandbox_grants_enabled')::boolean = false, 'admin can close the switch';
END $$;

-- a plain user must not be able to open the door to free credits
SELECT set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-0000000000a2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_set_system_flags(p_sandbox_grants_enabled := true);
    ASSERT false, 'non-admin must not toggle sandbox grants';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ═══ 2) sandbox never counts as money ═══════════════════════════════════════
SELECT set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE
  ov          json;
  v_active    int;
  v_mrr       bigint;
  v_sbx_subs  int;
  v_sbx_micro bigint;
  v_price     bigint;
BEGIN
  ov := public.admin_billing_overview();
  v_active    := (ov->>'active_subscriptions')::int;
  v_mrr       := (ov->>'mrr_micro_won')::bigint;
  v_sbx_subs  := (ov->>'sandbox_subscriptions')::int;
  v_sbx_micro := (ov->>'sandbox_granted_micro')::bigint;

  SELECT price_usd_cents::bigint * 10000 INTO v_price
    FROM billing_products WHERE id = 'sub_5k_monthly';

  -- Exactly ONE of the two identical subscriptions may be counted.
  ASSERT v_active >= 1, 'the production subscription is counted';
  ASSERT v_mrr >= v_price, 'MRR includes the production subscription';

  -- And the sandbox one is reported, not silently dropped.
  ASSERT v_sbx_subs >= 1, 'sandbox subscriptions are reported separately';
  ASSERT v_sbx_micro >= 990000, 'sandbox credit grants are reported separately';
  ASSERT (ov->>'sandbox_grants_enabled')::boolean = false,
    'the overview shows whether the switch is currently open';
END $$;

-- Prove the exclusion is real by flipping the sandbox row to production and
-- watching the counts move. A blind overview would not change.
DO $$
DECLARE
  before_active int; after_active int;
  before_mrr bigint;  after_mrr bigint;
BEGIN
  before_active := (public.admin_billing_overview()->>'active_subscriptions')::int;
  before_mrr    := (public.admin_billing_overview()->>'mrr_micro_won')::bigint;

  UPDATE billing_subscriptions SET environment = 'production'
   WHERE id = 'd9000000-0000-0000-0000-00000000b001';

  after_active := (public.admin_billing_overview()->>'active_subscriptions')::int;
  after_mrr    := (public.admin_billing_overview()->>'mrr_micro_won')::bigint;

  ASSERT after_active = before_active + 1,
    'the previously-excluded sandbox subscription now counts';
  ASSERT after_mrr > before_mrr,
    'MRR moves once the row is no longer sandbox';

  UPDATE billing_subscriptions SET environment = 'sandbox'
   WHERE id = 'd9000000-0000-0000-0000-00000000b001';
END $$;

-- ═══ 3) an admin can SEE which is which ═════════════════════════════════════
DO $$
DECLARE rows json;
BEGIN
  rows := public.admin_list_subscriptions(NULL, 200, 0);
  ASSERT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e
     WHERE e->>'id' = 'd9000000-0000-0000-0000-00000000b001'
       AND e->>'environment' = 'sandbox'),
    'the subscription list marks the sandbox row';
  ASSERT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e
     WHERE e->>'id' = 'd9000000-0000-0000-0000-00000000b002'
       AND e->>'environment' = 'production'),
    'the subscription list marks the production row';

  rows := public.admin_list_payments(200, 0, NULL);
  ASSERT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e
     WHERE e->>'merchant_uid' = 'rc:SBXTEST1'
       AND e->>'environment' = 'sandbox'),
    'the payment list marks the sandbox credit grant';
END $$;

ROLLBACK;
