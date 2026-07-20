-- ============================================================================
-- 137: admins get the UNLIMITED effective limit everywhere, in ONE place.
--
-- check_card_limit (mig 116:76) and the mig-134 insert trigger both bypass
-- role='admin' — but the ARCHIVE boundary get_active_card_threshold (mig 126) and the
-- usage meter derive their limit from _owned_card_limit(uuid), which had NO admin
-- branch. So an admin with no paid subscription fell back to the global 1000 cap:
-- their own over-1000 cards got ARCHIVED FROM STUDY (get_active_card_threshold returned
-- a non-null boundary) while the meter simultaneously showed is_unlimited=true — a
-- self-contradiction, and a real study-visibility loss for admin/operator accounts.
--
-- Fix at the single source of truth: _owned_card_limit(p_owner) returns the unlimited
-- sentinel (2e9) for admins. Then get_active_card_threshold's OFFSET runs past the end
-- → NULL → nothing archived; get_owned_card_usage / get_card_usage_detail report
-- unlimited; check_card_limit and _owned_card_over_cap are unaffected (both bypass
-- admins BEFORE ever calling _owned_card_limit). No client change needed.
--
-- Forward-replace of the shipped mig-126 definition. Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    -- Admins are never capped anywhere (mirror check_card_limit / the mig-134 trigger).
    WHEN EXISTS (SELECT 1 FROM profiles WHERE id = p_owner AND role = 'admin')
      THEN 2000000000
    ELSE COALESCE(
      (SELECT s.card_limit FROM billing_subscriptions s
         WHERE s.user_id = p_owner
           AND s.status IN ('active','canceled','grace','past_due')
           AND s.card_limit IS NOT NULL
           AND (
             (s.status = 'active'
                AND (s.current_period_end IS NULL OR s.current_period_end > now()))
             OR (s.status <> 'active'
                AND s.current_period_end IS NOT NULL
                AND s.current_period_end > now())
           )
         ORDER BY s.card_limit DESC LIMIT 1),
      (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1))
  END;
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit(uuid) FROM PUBLIC, anon, authenticated;
