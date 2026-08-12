-- ============================================================================
-- refund_policy_test.sql — channel attribution (mig 156) + refund policy as a
-- machine verdict (mig 157).
--
-- What it pins:
--   _billing_channel / _channel_has_money_api
--       the whole point of mig 156: iOS must report can_refund_money = FALSE
--       (Apple exposes no developer refund API) while Android — the same
--       'revenuecat' provider — reports TRUE. A regression here makes the admin
--       UI promise a money movement it cannot perform.
--   set_subscription_platform / set_credit_grant_platform
--       service-role only; idempotent; never blanks a known platform.
--   admin_list_payments
--       mobile IAP credit packs (ledger-only, no payment_intents row) appear at
--       all, and p_platform filters to one channel.
--   admin_refund_target
--       resolves a mobile IAP consumable from the LEDGER (mig 135 returned
--       not_found for every one of them).
--   refund_eligibility
--       credit pack: eligible → already_used → outside_window → already_refunded
--       subscription: eligible → already_used (benefit consumed) → renewal_charge
--       and that consent presence is reported, not enforced.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role()/is_admin() read from the
-- request.jwt settings, which each section sets explicitly.
-- ============================================================================
\set ON_ERROR_STOP on
\set adm  '''a6000000-0000-0000-0000-0000000000a1'''
\set web  '''a6000000-0000-0000-0000-0000000000a2'''
\set ios  '''a6000000-0000-0000-0000-0000000000a3'''
\set sub  '''a6000000-0000-0000-0000-0000000000a4'''
\set ren  '''a6000000-0000-0000-0000-0000000000a5'''
\set subid '''a6000000-0000-0000-0000-00000000b001'''
\set subid2 '''a6000000-0000-0000-0000-00000000b002'''

BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:adm),(:web),(:ios),(:sub),(:ren) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES
  (:adm,'admin'),(:web,'user'),(:ios,'user'),(:sub,'user'),(:ren,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- ═══ 1) channel derivation + refundability matrix ═══════════════════════════
DO $$
BEGIN
  ASSERT public._billing_channel('web','lemonsqueezy') = 'web_lemonsqueezy', 'web+LS channel';
  ASSERT public._billing_channel('web','toss')         = 'web_toss',         'web+toss channel';
  ASSERT public._billing_channel('ios','revenuecat')   = 'ios',              'ios channel';
  ASSERT public._billing_channel('android','revenuecat') = 'android',        'android channel';
  -- legacy revenuecat row with no recorded store — must NOT masquerade as either store
  ASSERT public._billing_channel(NULL,'revenuecat')    = 'mobile_unknown',   'unknown mobile channel';

  -- THE load-bearing assertion of mig 156: same provider, opposite capability.
  ASSERT     public._channel_has_money_api('android'),          'Play refunds are API-issuable';
  ASSERT NOT public._channel_has_money_api('ios'),              'Apple exposes NO refund API';
  ASSERT     public._channel_has_money_api('web_lemonsqueezy'), 'LS refunds are API-issuable';
  ASSERT     public._channel_has_money_api('web_toss'),         'Toss cancels are API-issuable';
  ASSERT NOT public._channel_has_money_api('mobile_unknown'),   'unknown store → fail safe';
  ASSERT NOT public._channel_has_money_api('admin'),            'comp grant moved no money';
END $$;

-- ═══ 2) fixtures ════════════════════════════════════════════════════════════
-- (a) WEB credit pack: intent + its ledger grant, keyed on the merchant_uid.
INSERT INTO payment_intents
  (merchant_uid, user_id, product_id, kind, amount_krw, amount_micro_usd,
   status, provider, provider_payment_id, platform, paid_at, created_at)
VALUES
  ('pi_rp_web1', :web, 'credits_5000', 'credit_pack', 5000, 4990000,
   'paid', 'lemonsqueezy', 'ls_order_1', 'web', now(), now());

INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, platform, created_at)
VALUES (:web, 4990000, 'purchase', 'pi_rp_web1', 4990000, 'web', now());

-- (b) iOS credit pack: ledger grant ONLY — an IAP consumable opens no intent row.
INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, platform, created_at)
VALUES (:ios, 990000, 'purchase', 'rc:1000000000123', 990000, 'ios', now());

-- (c) iOS subscription, first period, no invoices (RevenueCat writes none).
INSERT INTO billing_subscriptions
  (id, user_id, product_id, tier, status, card_limit, provider,
   provider_subscription_id, platform, current_period_end, created_at, updated_at)
VALUES
  (:subid, :sub, 'sub_5k_monthly', 'standard', 'active', 5000, 'revenuecat',
   'otx_rp_1', 'ios', now() + interval '20 days', now(), now());

SET session_replication_role = DEFAULT;

-- ═══ 3) platform setters — service-role only, idempotent ════════════════════
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE r json;
BEGIN
  -- no-op when the value already matches (updated = 0, still ok)
  r := public.set_subscription_platform('revenuecat','otx_rp_1','ios');
  ASSERT (r->>'ok')::boolean AND (r->>'updated')::int = 0, 'set platform is a no-op when unchanged';

  r := public.set_subscription_platform('revenuecat','otx_rp_1','android');
  ASSERT (r->>'updated')::int = 1, 'set platform rewrites a changed value';
  ASSERT (SELECT platform FROM billing_subscriptions WHERE id = 'a6000000-0000-0000-0000-00000000b001')
         = 'android', 'platform persisted';

  -- NULL never blanks a known platform
  r := public.set_subscription_platform('revenuecat','otx_rp_1',NULL);
  ASSERT NOT (r->>'ok')::boolean, 'NULL platform is refused, not written';
  ASSERT (SELECT platform FROM billing_subscriptions WHERE id = 'a6000000-0000-0000-0000-00000000b001')
         = 'android', 'known platform survives a NULL write';

  -- put it back for the eligibility section
  PERFORM public.set_subscription_platform('revenuecat','otx_rp_1','ios');

  r := public.set_credit_grant_platform('rc:1000000000123','ios');
  ASSERT (r->>'ok')::boolean, 'credit grant platform setter ok';
END $$;

-- a plain user may not attribute a purchase to a platform
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-0000000000a2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.set_subscription_platform('revenuecat','otx_rp_1','web');
    ASSERT false, 'non-admin must not set subscription platform';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ═══ 4) admin lists + refund target see the mobile channels ═════════════════
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE
  rows json;
  tgt  json;
BEGIN
  -- mobile IAP credit packs must be VISIBLE (they have no payment_intents row)
  rows := public.admin_list_payments(200, 0, 'ios');
  ASSERT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e
     WHERE e->>'merchant_uid' = 'rc:1000000000123'
       AND e->>'channel' = 'ios'
       AND (e->>'can_refund_money')::boolean = false),
    'iOS credit pack listed with channel=ios and no money API';

  -- ...and the filter must actually exclude the other channel
  ASSERT NOT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e WHERE e->>'merchant_uid' = 'pi_rp_web1'),
    'platform filter excludes web rows';

  rows := public.admin_list_payments(200, 0, 'web');
  ASSERT EXISTS (
    SELECT 1 FROM json_array_elements(rows) e
     WHERE e->>'merchant_uid' = 'pi_rp_web1'
       AND e->>'channel' = 'web_lemonsqueezy'
       AND (e->>'can_refund_money')::boolean = true),
    'web pack listed as refundable LS row';

  -- admin_refund_target resolves a LEDGER-only mobile consumable (mig 135 could not)
  tgt := public.admin_refund_target('credit_pack','rc:1000000000123');
  ASSERT (tgt->>'ok')::boolean,                          'mobile consumable resolves';
  ASSERT tgt->>'source'  = 'credit_ledger',              'resolved from the ledger';
  ASSERT tgt->>'channel' = 'ios',                        'target carries the channel';
  ASSERT (tgt->>'can_refund_money')::boolean = false,    'iOS target is revoke-only';

  tgt := public.admin_refund_target('subscription','a6000000-0000-0000-0000-00000000b001');
  ASSERT tgt->>'channel' = 'ios' AND (tgt->>'can_refund_money')::boolean = false,
    'iOS subscription target is revoke-only';
END $$;

-- ═══ 5) refund_eligibility — CREDIT PACK ════════════════════════════════════
DO $$
DECLARE v json;
BEGIN
  -- fresh + untouched → eligible
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT (v->>'eligible')::boolean, 'fresh unused pack is refundable';
  ASSERT v->>'reason_code' = 'eligible',            'reason=eligible';
  ASSERT (v->>'unused')::boolean,                   'no spend recorded yet';
  ASSERT (v->>'window_days')::int = 14,             '14-day window (KR 7d / EU 14d superset)';
  ASSERT v->>'statutory_note' IS NULL,              'no override note when already eligible';

  -- iOS pack: eligible on the policy, but still not money-refundable by us
  v := public.refund_eligibility('credit_pack','rc:1000000000123');
  ASSERT (v->>'eligible')::boolean,                       'iOS pack passes the policy';
  ASSERT (v->>'can_refund_money')::boolean = false,       'iOS pack is not money-refundable by us';
  ASSERT v->>'channel' = 'ios',                           'iOS pack channel';
END $$;

-- one micro-WON spent after the grant ⇒ the pack is consumed
SET session_replication_role = replica;
INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, created_at)
VALUES ('a6000000-0000-0000-0000-0000000000a2', -1000, 'spend_cards', NULL, 4989000, now());
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT NOT (v->>'eligible')::boolean,             'a consumed pack is not refundable';
  ASSERT v->>'reason_code' = 'already_used',        'reason=already_used';
  ASSERT (v->>'detail')::json->>'spent_since_grant' = '1000', 'spend amount reported';
  ASSERT v->>'statutory_note' IS NOT NULL,          'ineligible verdicts carry the override note';
  -- consent was never recorded for this purchase, so "used ⇒ non-refundable" is
  -- only weakly supported for KR/EU buyers — the verdict must SAY so.
  ASSERT (v->>'consent_recorded')::boolean = false, 'missing consent is reported';
END $$;

-- age the purchase past the window (and remove the spend so the window is the
-- only reason left — proves the two rules are independent)
SET session_replication_role = replica;
DELETE FROM ai_credit_ledger WHERE reason = 'spend_cards' AND user_id = 'a6000000-0000-0000-0000-0000000000a2';
UPDATE ai_credit_ledger SET created_at = now() - interval '20 days' WHERE ref = 'pi_rp_web1';
UPDATE payment_intents  SET paid_at    = now() - interval '20 days' WHERE merchant_uid = 'pi_rp_web1';
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT v->>'reason_code' = 'outside_window',      'reason=outside_window';
  ASSERT (v->>'unused')::boolean,                   'still unused — the window alone disqualifies';
  ASSERT (v->>'days_since')::numeric >= 19.9,       'age reported for the admin';
END $$;

-- an already-clawed-back pack reports that first, whatever else is true
SET session_replication_role = replica;
INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after, created_at)
VALUES ('a6000000-0000-0000-0000-0000000000a2', -4990000, 'refund', 'refund:pi_rp_web1', 0, now());
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT v->>'reason_code' = 'already_refunded',    'reason=already_refunded wins';
END $$;

-- ═══ 6) refund_eligibility — SUBSCRIPTION ═══════════════════════════════════
DO $$
DECLARE v json;
BEGIN
  -- first period, account still inside the FREE cap ⇒ the paid benefit is unused
  v := public.refund_eligibility('subscription','a6000000-0000-0000-0000-00000000b001');
  ASSERT (v->>'eligible')::boolean,          'unused first-period subscription is refundable';
  ASSERT v->>'reason_code' = 'eligible',     'reason=eligible';
  ASSERT (v->>'detail')::json->>'owned_cards' = '0', 'card count reported';
END $$;

-- consume the benefit: drop the FREE cap to 0 and give the account a card, so the
-- account now only fits because of the plan. (Cheaper than minting 1000 rows, and
-- it exercises the exact comparison the policy makes.)
SET session_replication_role = replica;
UPDATE card_limit_settings SET max_owned_cards = 0 WHERE id = 1;
INSERT INTO decks (id, user_id, name)
VALUES ('a6000000-0000-0000-0000-00000000c001','a6000000-0000-0000-0000-0000000000a4','rp deck');
INSERT INTO cards (deck_id, user_id, template_id, field_values)
VALUES ('a6000000-0000-0000-0000-00000000c001','a6000000-0000-0000-0000-0000000000a4',
        'a6000000-0000-0000-0000-00000000d001','{}'::jsonb);
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('subscription','a6000000-0000-0000-0000-00000000b001');
  ASSERT NOT (v->>'eligible')::boolean,      'a subscription whose benefit was used is not refundable';
  ASSERT v->>'reason_code' = 'already_used', 'reason=already_used';
  ASSERT (v->>'detail')::json->>'free_card_limit' = '0', 'free cap reported alongside the count';
END $$;

-- a renewal charge is out of policy scope regardless of usage or age
SET session_replication_role = replica;
UPDATE card_limit_settings SET max_owned_cards = 1000 WHERE id = 1;
DELETE FROM cards WHERE deck_id = 'a6000000-0000-0000-0000-00000000c001';
INSERT INTO billing_subscriptions
  (id, user_id, product_id, tier, status, card_limit, provider,
   provider_subscription_id, platform, current_period_end, created_at, updated_at)
VALUES
  ('a6000000-0000-0000-0000-00000000b002','a6000000-0000-0000-0000-0000000000a5',
   'sub_5k_monthly','standard','active',5000,'lemonsqueezy','ls_sub_rp_2','web',
   now() + interval '20 days', now(), now());
INSERT INTO billing_invoices
  (provider, provider_invoice_id, user_id, subscription_id, provider_subscription_id,
   product_id, amount_usd_cents, billing_reason, status, created_at)
VALUES
  ('lemonsqueezy','inv_rp_1','a6000000-0000-0000-0000-0000000000a5',
   'a6000000-0000-0000-0000-00000000b002','ls_sub_rp_2','sub_5k_monthly',499,'initial','paid', now() - interval '1 day'),
  ('lemonsqueezy','inv_rp_2','a6000000-0000-0000-0000-0000000000a5',
   'a6000000-0000-0000-0000-00000000b002','ls_sub_rp_2','sub_5k_monthly',499,'renewal','paid', now());
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('subscription','a6000000-0000-0000-0000-00000000b002');
  ASSERT NOT (v->>'eligible')::boolean,          'a renewed subscription is out of scope';
  ASSERT v->>'reason_code' = 'renewal_charge',   'reason=renewal_charge';
  ASSERT (v->>'detail')::json->>'invoice_count' = '2', 'invoice trail reported';
  ASSERT (v->>'can_refund_money')::boolean = true,     'web sub is still money-refundable if overridden';
END $$;

-- ═══ 7) consent recording ═══════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-0000000000a2',false);
DO $$
DECLARE v json;
BEGIN
  v := public.record_purchase_consent('credits_5000','web','pi_rp_web1');
  ASSERT (v->>'ok')::boolean,                  'consent recorded';
  ASSERT v->>'policy_version' = public._refund_policy_version(),
    'the SERVER stamps the policy version (a client cannot claim an older text)';

  -- a consent naming an unknown product proves nothing → rejected
  BEGIN
    PERFORM public.record_purchase_consent('no_such_product','web',NULL);
    ASSERT false, 'unknown product must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','a6000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE v json;
BEGIN
  -- The consent above was stamped NOW, but pi_rp_web1 was backdated 20 days in §5.
  -- A disclosure the buyer only saw AFTER paying is not evidence they were warned
  -- BEFORE the purchase, so it must NOT count retroactively. This is the whole
  -- reason the server stamps consented_at instead of accepting it from the client.
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT (v->>'consent_recorded')::boolean = false,
    'a consent recorded after the purchase does not validate it retroactively';
END $$;

-- backdate the consent to just before the purchase — now it is real evidence
SET session_replication_role = replica;
UPDATE billing_consents SET consented_at = now() - interval '21 days'
 WHERE merchant_uid = 'pi_rp_web1';
SET session_replication_role = DEFAULT;

DO $$
DECLARE v json;
BEGIN
  v := public.refund_eligibility('credit_pack','pi_rp_web1');
  ASSERT (v->>'consent_recorded')::boolean,
    'a consent predating the purchase is counted';
END $$;

ROLLBACK;
