-- ============================================================================
-- admin_growth_levers_test.sql — the Pack B levers are readable, writable, and
-- bounded (mig 177 + the mig 154 setters).
--
-- WHY THIS EXISTS. mig 154 made the free quota / card cap / pricing knobs
-- changeable without a deploy, but gave them no READ path: both config tables are
-- RLS-enabled with zero policies. The admin UI was deferred for exactly that
-- reason. mig 177 adds `admin_get_growth_levers()`.
--
-- What is pinned here:
--   1. the getter reports what is actually stored (not a default it invented);
--   2. every setter's write is visible through the getter — the round trip the UI
--      depends on;
--   3. the REFUSALS the UI must respect, because a form that offers an
--      impossible value is a form that only fails: target_margin_bps = 10000 is
--      a division by zero in the charging path, and usd_won_rate is pinned to 1;
--   4. authorization — a plain user can neither read nor write the levers.
--
-- Runs in a txn and ROLLBACKs → leaves no data. Connection role is superuser, so
-- GRANTs never block; the RPCs gate on auth.role()/is_admin() from request.jwt.
-- ============================================================================
\set ON_ERROR_STOP on
--   adm   c7000000-0000-0000-0000-0000000000a1  (admin)
--   usr   c7000000-0000-0000-0000-0000000000a2  (plain user)
\set adm '''c7000000-0000-0000-0000-0000000000a1'''
\set usr '''c7000000-0000-0000-0000-0000000000a2'''

BEGIN;
SET session_replication_role = replica;
INSERT INTO auth.users (id) VALUES (:adm),(:usr) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, role) VALUES (:adm,'admin'),(:usr,'user')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET session_replication_role = DEFAULT;

-- ═══ 1) the getter reports what is STORED ══════════════════════════════════
-- Written directly (not via the setters) so the read is proved independently of
-- the write path.
UPDATE ai_pricing_settings   SET free_cards_per_day = 37, won_per_credit = 250,
                                 target_margin_bps = 7500 WHERE id = 1;
UPDATE card_limit_settings   SET max_owned_cards = 4321, count_official_cards = true WHERE id = 1;

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','c7000000-0000-0000-0000-0000000000a1',false);
DO $$
DECLARE g json;
BEGIN
  g := public.admin_get_growth_levers();
  ASSERT (g->>'free_cards_per_day')::int = 37,
    format('the getter reads the stored quota, got %s', g->>'free_cards_per_day');
  ASSERT (g->>'won_per_credit')::int = 250, 'won_per_credit is reported';
  ASSERT (g->>'target_margin_bps')::int = 7500, 'target_margin_bps is reported';
  ASSERT (g->>'max_owned_cards')::int = 4321, 'max_owned_cards is reported';
  ASSERT (g->>'count_official_cards')::boolean = true, 'count_official_cards is reported';
  ASSERT g->>'ai_settings_updated_at' IS NOT NULL, 'the AI settings timestamp is reported';
  ASSERT g->>'card_limit_updated_at' IS NOT NULL, 'the card-limit timestamp is reported';

  -- usd_won_rate is pinned by a CHECK, so offering it in a UI could only fail.
  ASSERT NOT (g::jsonb ? 'usd_won_rate'),
    'usd_won_rate must NOT be exposed — mig 149 pins it to 1';
END $$;

-- ═══ 2) each setter's write is visible through the getter ═══════════════════
-- The round trip the admin form depends on: write, then re-read and see it.
DO $$
DECLARE g json;
BEGIN
  PERFORM public.admin_set_ai_free_quota(25);
  PERFORM public.admin_set_card_limit(2500, false);
  PERFORM public.set_ai_pricing_settings(p_won_per_credit := 300, p_target_margin_bps := 6000);

  g := public.admin_get_growth_levers();
  ASSERT (g->>'free_cards_per_day')::int = 25, 'the quota setter round-trips';
  ASSERT (g->>'max_owned_cards')::int = 2500, 'the card-cap setter round-trips';
  ASSERT (g->>'count_official_cards')::boolean = false, 'the official-cards flag round-trips';
  ASSERT (g->>'won_per_credit')::int = 300, 'won_per_credit round-trips';
  ASSERT (g->>'target_margin_bps')::int = 6000, 'target_margin_bps round-trips';
END $$;

-- The free quota the getter reports must be the SAME number enforcement uses;
-- otherwise the form would show a value the generator ignores.
DO $$
BEGIN
  ASSERT (public.admin_get_growth_levers()->>'free_cards_per_day')::int
         = public._ai_free_cards_per_day(),
    'the reported quota is the one _ai_free_cards_per_day() enforces';
END $$;

-- A partial card-limit update must not clobber the other column (COALESCE
-- semantics) — a UI that submits one field must not silently reset the other.
DO $$
DECLARE g json;
BEGIN
  PERFORM public.admin_set_card_limit(p_count_official := true);
  g := public.admin_get_growth_levers();
  ASSERT (g->>'max_owned_cards')::int = 2500,
    'setting only the flag left max_owned_cards alone';
  ASSERT (g->>'count_official_cards')::boolean = true, 'the flag did change';
END $$;

-- ═══ 3) the refusals a UI must respect ═════════════════════════════════════
DO $$
BEGIN
  -- 100% margin is a live DIVISOR in the charging path (markup = 10000/(10000-bps)),
  -- so it would divide by zero → silent no-charge. mig 114 tightened this bound.
  BEGIN
    PERFORM public.set_ai_pricing_settings(p_target_margin_bps := 10000);
    ASSERT false, 'target_margin_bps = 10000 must be refused (division by zero)';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.set_ai_pricing_settings(p_won_per_credit := 0);
    ASSERT false, 'won_per_credit = 0 must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.admin_set_ai_free_quota(-1);
    ASSERT false, 'a negative free quota must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.admin_set_card_limit(-1, NULL);
    ASSERT false, 'a negative card cap must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- The refused writes must have changed nothing.
  ASSERT (public.admin_get_growth_levers()->>'target_margin_bps')::int = 6000,
    'a refused margin write left the stored value alone';
  ASSERT (public.admin_get_growth_levers()->>'free_cards_per_day')::int = 25,
    'a refused quota write left the stored value alone';
END $$;

-- ═══ 4) authorization ══════════════════════════════════════════════════════
-- These are money/growth knobs: admins (or service_role) only, read AND write.
SELECT set_config('request.jwt.claim.sub','c7000000-0000-0000-0000-0000000000a2',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.admin_get_growth_levers();
    ASSERT false, 'a plain user must not read the growth levers';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.admin_set_ai_free_quota(9999);
    ASSERT false, 'a plain user must not change the free quota';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.set_ai_pricing_settings(p_won_per_credit := 1);
    ASSERT false, 'a plain user must not change pricing';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.admin_set_card_limit(1, NULL);
    ASSERT false, 'a plain user must not change the card cap';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- service_role reads them (an edge function or support script about to change one).
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
BEGIN
  ASSERT (public.admin_get_growth_levers()->>'free_cards_per_day')::int = 25,
    'service_role can read the levers';
END $$;

-- ═══ 5) the config tables stay RPC-only ════════════════════════════════════
-- The new getter must not have been an excuse to open the tables directly.
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_pricing_settings'::regclass),
    'ai_pricing_settings must keep RLS enabled';
  ASSERT (SELECT COUNT(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'ai_pricing_settings') = 0,
    'ai_pricing_settings must have NO policies';
  ASSERT (SELECT COUNT(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'card_limit_settings') = 0,
    'card_limit_settings must have NO policies';
  ASSERT has_table_privilege('anon','public.ai_pricing_settings','SELECT') = false
      OR (SELECT COUNT(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'ai_pricing_settings') = 0,
    'anon cannot read pricing settings';
END $$;

ROLLBACK;
