-- ============================================================================
-- billing_sku_catalog_test.sql — store-SKU catalog assertions (mig 151 machinery,
-- mig 155 catalog contents: the clean per-platform subscription store ids).
--
-- Drives the DB-centric store↔internal product mapping directly:
--   resolve_store_product   (service_role): found / platform-null-unambiguous /
--                            inactive-excluded / unknown-null / ambiguous-null
--   set_store_product_sku   (admin + service_role UPSERT; non-admin 42501; rotation
--                            deactivates the prior active SKU via the unique-active index)
--   get_billing_products(p) projects store_product_id; the no-arg overload is unchanged
--   unique-active index      rejects two active SKUs for one (platform, product)
--   credit grant             $0.99 → 990,000 micro-USD (mig 145 face-value 1:1)
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so GRANTs
-- never block; the RPCs gate on auth.role()/is_admin() read from request.jwt settings.
-- ============================================================================
\set ON_ERROR_STOP on
\set adm '''a5000000-0000-0000-0000-0000000000a1'''
\set usr '''a5000000-0000-0000-0000-0000000000a2'''

BEGIN;
SET session_replication_role = replica;

INSERT INTO auth.users (id) VALUES (:adm),(:usr) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:adm,'admin'),(:usr,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SET session_replication_role = DEFAULT;

-- ═══ 1) resolve_store_product ═══════════════════════════════════════════════
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  -- consumables — seeded (mig 151), untouched by 155: ai_credit_099 → credits_1000 on ios AND android
  ASSERT public.resolve_store_product('ios','ai_credit_099') = 'credits_1000',
    'resolve ios ai_credit_099 → credits_1000';
  ASSERT public.resolve_store_product('android','ai_credit_999') = 'credits_10000',
    'resolve android ai_credit_999 → credits_10000';

  -- subscriptions — the mig-151 placeholders (sub_5k_monthly_v2 / sub_unlimited_monthly_v3) were
  -- RETIRED by mig 155, which activated clean ids that DIFFER PER PLATFORM on purpose: the tidy
  -- `sub_*_monthly` ids were created-then-deleted on App Store Connect and Apple reserves them
  -- permanently, so iOS uses bare ids while Google uses `<sub>:<base-plan>`. Pin all four.
  ASSERT public.resolve_store_product('ios','standard_monthly') = 'sub_5k_monthly',
    'resolve ios standard_monthly → sub_5k_monthly (mig 155)';
  ASSERT public.resolve_store_product('ios','pro_monthly') = 'sub_unlimited_monthly',
    'resolve ios pro_monthly → sub_unlimited_monthly (mig 155)';
  ASSERT public.resolve_store_product('android','sub_standard_monthly:monthly') = 'sub_5k_monthly',
    'resolve android sub_standard_monthly:monthly → sub_5k_monthly (mig 155)';
  ASSERT public.resolve_store_product('android','sub_pro_monthly:monthly') = 'sub_unlimited_monthly',
    'resolve android sub_pro_monthly:monthly → sub_unlimited_monthly (mig 155)';

  -- the retired placeholders must stay inactive (resolve excludes is_active=false)
  ASSERT public.resolve_store_product('ios','sub_5k_monthly_v2') IS NULL,
    'mig-151 placeholder sub_5k_monthly_v2 retired by mig 155';
  ASSERT public.resolve_store_product('ios','sub_unlimited_monthly_v3') IS NULL,
    'mig-151 placeholder sub_unlimited_monthly_v3 retired by mig 155';

  -- platform NULL: ios+android both map ai_credit_499 → credits_5000 → UNAMBIGUOUS
  ASSERT public.resolve_store_product(NULL,'ai_credit_499') = 'credits_5000',
    'resolve platform-null unambiguous → credits_5000';

  -- unknown store id → NULL
  ASSERT public.resolve_store_product('ios','does_not_exist') IS NULL,
    'resolve unknown → NULL';
  ASSERT public.resolve_store_product('ios','') IS NULL,
    'resolve empty → NULL';
END $$;

-- ambiguous: same store id → two DIFFERENT internal products across platforms.
-- (service role can write the table directly for the fixture.)
INSERT INTO billing_product_skus (platform, store_product_id, product_id)
  VALUES ('toss','ai_credit_099','credits_5000');
DO $$
BEGIN
  -- platform-null now spans {credits_1000 (ios/android), credits_5000 (toss)} → NULL
  ASSERT public.resolve_store_product(NULL,'ai_credit_099') IS NULL,
    'resolve platform-null AMBIGUOUS → NULL';
  -- platform-scoped stays unambiguous
  ASSERT public.resolve_store_product('ios','ai_credit_099') = 'credits_1000',
    'resolve ios still unambiguous under cross-platform ambiguity';
END $$;
DELETE FROM billing_product_skus WHERE platform='toss' AND store_product_id='ai_credit_099';

-- inactive excluded
UPDATE billing_product_skus SET is_active=false
  WHERE platform='ios' AND store_product_id='ai_credit_099';
DO $$
BEGIN
  ASSERT public.resolve_store_product('ios','ai_credit_099') IS NULL,
    'resolve inactive SKU → NULL';
END $$;
UPDATE billing_product_skus SET is_active=true
  WHERE platform='ios' AND store_product_id='ai_credit_099';

-- ═══ 2) set_store_product_sku authz + upsert + rotation ═════════════════════
-- non-admin authenticated → 42501
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-0000000000a2',false);
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM public.set_store_product_sku('lemonsqueezy','9999','credits_1000');
    ASSERT false, 'non-admin set_store_product_sku should have raised';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- 42501 as expected
  END;
END $$;

-- admin authenticated → allowed (registers a LemonSqueezy variant not seeded by 151)
SELECT set_config('request.jwt.claim.sub','a5000000-0000-0000-0000-0000000000a1',false);
DO $$
BEGIN
  PERFORM public.set_store_product_sku('lemonsqueezy','ls_var_777','credits_1000');
END $$;
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  ASSERT public.resolve_store_product('lemonsqueezy','ls_var_777') = 'credits_1000',
    'admin-registered LS variant resolves';

  -- rotation: point credits_1000's active ios SKU at a NEW store id → old one deactivates
  PERFORM public.set_store_product_sku('ios','ai_credit_099_v2','credits_1000');
  ASSERT public.resolve_store_product('ios','ai_credit_099_v2') = 'credits_1000',
    'rotated-in new ios SKU resolves';
  ASSERT public.resolve_store_product('ios','ai_credit_099') IS NULL,
    'rotated-out old ios SKU is now inactive';
  ASSERT (SELECT count(*) FROM billing_product_skus
            WHERE platform='ios' AND product_id='credits_1000' AND is_active) = 1,
    'exactly one active ios SKU for credits_1000 after rotation';
END $$;

-- ═══ 3) get_billing_products(platform) projection + no-arg back-compat ═══════
DO $$
DECLARE v_ios json; v_noarg json; v_row json; v_store text; v_has_key boolean;
BEGIN
  SELECT public.get_billing_products('android') INTO v_ios;
  SELECT r INTO v_row FROM json_array_elements(v_ios) r
    WHERE r->>'id' = 'credits_5000' LIMIT 1;
  ASSERT v_row IS NOT NULL, 'android catalog contains credits_5000';
  ASSERT v_row->>'store_product_id' = 'ai_credit_499',
    'android credits_5000 carries store_product_id ai_credit_499';

  -- no-arg overload unchanged: same rows, NO store_product_id key
  SELECT public.get_billing_products() INTO v_noarg;
  SELECT r INTO v_row FROM json_array_elements(v_noarg) r
    WHERE r->>'id' = 'credits_5000' LIMIT 1;
  ASSERT v_row IS NOT NULL, 'no-arg catalog still returns credits_5000';
  ASSERT NOT ((v_row::jsonb) ? 'store_product_id'),
    'no-arg overload has NO store_product_id key (back-compat)';
END $$;

-- ═══ 4) unique-active index rejects a second active SKU per (platform, product) ═══
DO $$
DECLARE v_hit boolean := false;
BEGIN
  BEGIN
    -- credits_10000 already has an active android SKU (ai_credit_999); a second must fail
    INSERT INTO billing_product_skus (platform, store_product_id, product_id)
      VALUES ('android','ai_credit_999_dupe','credits_10000');
    ASSERT false, 'second active android SKU for credits_10000 should have failed';
  EXCEPTION WHEN unique_violation THEN
    v_hit := true;
  END;
  ASSERT v_hit, 'unique-active index enforced';
END $$;

-- ═══ 5) credit grant = USD face value 1:1 (mig 145) ═════════════════════════
DO $$
BEGIN
  ASSERT (SELECT credits_micro_won FROM billing_products WHERE id='credits_1000') = 990000,
    'credits_1000 grants 990,000 micro-USD ($0.99)';
  ASSERT (SELECT credits_micro_won FROM billing_products WHERE id='credits_10000') = 9990000,
    'credits_10000 grants 9,990,000 micro-USD ($9.99)';
END $$;

DO $$ BEGIN RAISE NOTICE 'billing_sku_catalog_test: ALL ASSERTIONS PASSED'; END $$;

ROLLBACK;
