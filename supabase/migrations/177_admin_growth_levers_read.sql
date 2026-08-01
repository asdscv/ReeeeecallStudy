-- ============================================================================
-- 177: admin_get_growth_levers() — a READ path for the Pack B config values.
--
-- WHY. mig 154 made the growth levers changeable without a deploy and gave each
-- one an admin setter:
--     admin_set_ai_free_quota(integer)            → ai_pricing_settings.free_cards_per_day
--     admin_set_card_limit(integer, boolean)      → card_limit_settings
--     set_ai_pricing_settings(int, int, numeric)  → won_per_credit / target_margin_bps
-- but it never added a way to READ them. Both config tables are RLS-enabled with
-- ZERO policies (mig 112 / mig 116: "readers are SECURITY DEFINER"), so an admin
-- client cannot select them, and no getter RPC existed. That is why the admin UI
-- for these levers was deferred: a form cannot show what the current value is,
-- and a blind form on money knobs invites overwriting a number you cannot see.
--
-- This closes that gap and nothing else. Read-only, additive, no schema change.
--
-- SCOPE — deliberately narrow. It returns exactly the fields the three setters
-- above can change, so "what the UI shows" and "what the UI can write" cannot
-- drift apart. In particular:
--   * `usd_won_rate` is NOT exposed. mig 149 pins it with CHECK (usd_won_rate = 1)
--     — verified in the catalog as `ai_pricing_settings_usd_won_rate_is_1` — so
--     surfacing it would offer an edit that can only fail.
--   * the cost-model fields (fallback_in/out_micro_usd, est_price_per_card_micro)
--     are not levers an operator tunes by hand; they belong to the cost engine
--     (mig 112/114) and have their own RPCs.
-- `updated_at` for each row IS returned: knowing WHEN a money knob last moved is
-- the difference between reading a stale form and knowing someone changed it.
--
-- AUTHORIZATION. Same posture as the setters it pairs with: SECURITY DEFINER with
-- an in-body gate, not a bare GRANT. The role check is inside the function
-- because a definer that leans only on its GRANT silently opens up if the grant
-- is ever widened (the same reasoning mig 158 records for
-- credit_grant_is_refunded). service_role is accepted so an edge function or a
-- support script can read the levers it is about to change.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_growth_levers()
  RETURNS json
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;

  SELECT json_build_object(
    -- AI free tier (CAC / growth lever) — admin_set_ai_free_quota
    'free_cards_per_day',
      COALESCE((SELECT free_cards_per_day FROM ai_pricing_settings WHERE id = 1), 10),
    -- Pricing knobs — set_ai_pricing_settings
    'won_per_credit',
      (SELECT won_per_credit FROM ai_pricing_settings WHERE id = 1),
    'target_margin_bps',
      (SELECT target_margin_bps FROM ai_pricing_settings WHERE id = 1),
    'ai_settings_updated_at',
      (SELECT updated_at FROM ai_pricing_settings WHERE id = 1),
    -- Owned-card cap — admin_set_card_limit
    'max_owned_cards',
      (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1),
    'count_official_cards',
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1),
    'card_limit_updated_at',
      (SELECT updated_at FROM card_limit_settings WHERE id = 1)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_growth_levers() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_growth_levers() TO authenticated, service_role;  -- gate is in-fn

-- PostgREST must learn the new RPC.
NOTIFY pgrst, 'reload schema';
