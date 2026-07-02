-- ============================================================================
-- 117: AI wallet/usage user screen + admin AI-credit stats + finish dev-API removal
--
--   1) get_ai_wallet_summary()  — user-facing: ₩ balance + today's free usage +
--      recent ledger rows (the ledger table is deny-all RLS, so a SECURITY DEFINER
--      getter is the only read path). Powers the new Wallet/Usage screen.
--   2) admin_system_stats()     — drop the (removed) api_keys counts; add AI-credit
--      wallet stats (total balance, total spent, active wallets, cards today).
--   3) DROP resolve_api_key() + api_keys — the developer REST-API feature is gone
--      (edge fn deleted, UI/docs removed in #229/#231). This was the dormant tail.
--
-- All money is micro-WON (1 unit = 1e-6 KRW). Depends on 108 (usage), 109/114
-- (wallet), 013/014/019 (admin_system_stats), 006 (api_keys).
-- ============================================================================

-- ── 1) User wallet summary (balance + free-today + recent ledger) ──
CREATE OR REPLACE FUNCTION public.get_ai_wallet_summary()
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid        uuid    := auth.uid();
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_free_limit integer := public._ai_free_cards_per_day();
  v_free_used  integer;
  result       json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT free_cards_used INTO v_free_used
    FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = v_today;
  v_free_used := COALESCE(v_free_used, 0);

  SELECT json_build_object(
    'balance_micro_won',        COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    'est_price_per_card_micro', public._ai_est_price_per_card(),
    'free_limit',               v_free_limit,
    'free_used_today',          v_free_used,
    'free_remaining_today',     GREATEST(0, v_free_limit - v_free_used),
    'ledger', COALESCE((
      SELECT json_agg(row_to_json(r))
      FROM (
        SELECT delta, reason, balance_after, created_at
          FROM ai_credit_ledger
         WHERE user_id = v_uid
         ORDER BY created_at DESC
         LIMIT 30
      ) r
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_wallet_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet_summary() TO authenticated;

-- ── 2) admin_system_stats — replace api_keys counts with AI-credit wallet stats ──
-- (recreated BEFORE the api_keys DROP so nothing references the dropped table)
CREATE OR REPLACE FUNCTION admin_system_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_wallet_balance',   COALESCE((SELECT SUM(balance) FROM ai_credit_balance), 0),
    'total_ai_spent',         COALESCE((SELECT SUM(-delta) FROM ai_credit_ledger WHERE delta < 0), 0),
    'active_wallets',         (SELECT COUNT(*) FROM ai_credit_balance WHERE balance > 0),
    'ai_cards_paid_today',    COALESCE((SELECT SUM(paid_cards_used) FROM ai_generation_usage WHERE usage_date = v_today), 0),
    'ai_cards_free_today',    COALESCE((SELECT SUM(free_cards_used) FROM ai_generation_usage WHERE usage_date = v_today), 0),
    'total_contents',         (SELECT COUNT(*) FROM contents),
    'published_contents',     (SELECT COUNT(*) FROM contents WHERE is_published = true),
    'total_study_logs',       (SELECT COUNT(*) FROM study_logs)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── 3) Finish the developer REST-API removal — drop the dormant table + RPC ──
DROP FUNCTION IF EXISTS public.resolve_api_key(text);
DROP TABLE    IF EXISTS public.api_keys CASCADE;
