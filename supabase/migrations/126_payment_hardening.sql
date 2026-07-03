-- ============================================================================
-- 126: Payment / billing HARDENING — audit blocker fixes (money = micro-WON).
--
-- Additive + idempotent (guarded DO / CREATE OR REPLACE only). Keeps the
-- gated-off, fail-closed posture: every write RPC stays SECURITY DEFINER and
-- service_role/admin-guarded; no new client GRANTs. Each block reproduces the
-- CURRENT body (migs 109/111/121/123) with ONLY the audited change.
--
--   1) refund_ai_generation self-mint  → REVOKE from PUBLIC/anon/authenticated
--      (idempotent no-op on prod: mig 111 already DROPPED it + replaced it with
--       service_role-only refund_ai_job; this belt-and-suspenders closes it on
--       any DB that applied 109/110 but not 111).
--   2) _owned_card_limit NULL-period perpetual grant → only 'active' may have a
--      NULL period_end (admin comp); canceled/grace/past_due MUST be paid-through.
--   3) sync_subscription terminal-state guard → never resurrect a refunded (or
--      lapsed 'expired') sub back to active/grace from an out-of-order event.
--   4) get_active_card_threshold OFFSET guard → GREATEST(limit-1, 0) so a limit
--      of 0 can never produce OFFSET -1 (would error).
-- ============================================================================

-- ── 1) SELF-MINT: refund_ai_generation ─────────────────────────────────────────
-- mig 109 GRANTed refund_ai_generation(integer,integer,integer) to `authenticated`
-- and credited the caller's own wallet from a CLIENT-SUPPLIED amount (no spend
-- check / cap / idempotency) → any logged-in user could self-mint credits via
-- PostgREST /rpc. mig 111 already remediated this by DROPPING the function and
-- replacing it with refund_ai_job(uuid,text) (amount DERIVED from a recorded job
-- row, idempotent, service_role/admin only). Confirmed: ZERO client/edge callers
-- of refund_ai_generation anywhere (grep of packages/** + supabase/functions/**);
-- the ai-generate edge fn refunds via service_role refund_ai_job, never this fn.
--
-- So on current prod this function no longer exists. A bare REVOKE would ERROR
-- ("function does not exist") and abort the whole migration, so we guard it: for
-- ANY lingering refund_ai_generation overload (e.g. a DB that applied 109/110 but
-- not 111) strip the self-mint grants; otherwise it is a documented no-op.
DO $$
DECLARE r record; v_found boolean := false;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'refund_ai_generation'
  LOOP
    v_found := true;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'mig126: revoked self-mint grants on lingering %', r.sig;
  END LOOP;
  IF NOT v_found THEN
    RAISE NOTICE 'mig126: refund_ai_generation already absent (dropped by mig 111 -> service_role-only refund_ai_job). No-op.';
  END IF;
END $$;

-- ── 2) NULL-PERIOD PERPETUAL GRANT: _owned_card_limit(p_owner uuid) ─────────────
-- BUG (mig 121): status IN (canceled,grace,past_due) with current_period_end IS
-- NULL granted the raised plan cap FOREVER (NULL passed the period gate). Fix:
-- only a truly 'active' sub may carry a NULL period_end (= perpetual, for admin
-- comp grants). canceled/grace/past_due MUST have a real, still-future
-- current_period_end to keep the raised cap; otherwise fall back to the global
-- card_limit_settings cap. Active-with-NULL and active-future keep working.
CREATE OR REPLACE FUNCTION public._owned_card_limit(p_owner uuid)
  RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.card_limit FROM billing_subscriptions s
       WHERE s.user_id = p_owner
         AND s.status IN ('active','canceled','grace','past_due')
         AND s.card_limit IS NOT NULL
         AND (
           -- only 'active' may have NULL period_end = perpetual (admin comp grant)
           (s.status = 'active'
              AND (s.current_period_end IS NULL OR s.current_period_end > now()))
           -- non-active: must be genuinely paid-through (real future period_end)
           OR (s.status <> 'active'
              AND s.current_period_end IS NOT NULL
              AND s.current_period_end > now())
         )
       ORDER BY s.card_limit DESC LIMIT 1),
    (SELECT max_owned_cards FROM card_limit_settings WHERE id = 1));
$$;
REVOKE EXECUTE ON FUNCTION public._owned_card_limit(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3) TERMINAL-STATE GUARD: sync_subscription ─────────────────────────────────
-- BUG (mig 121): an out-of-order provider event carrying status 'active'/'grace'
-- would UPDATE a row that is already TERMINAL (refunded, or expired-and-lapsed)
-- back to a paying state — resurrecting a refunded/chargebacked sub and its
-- raised card-limit grant. Fix: lock+read the existing row first; if it is
-- 'refunded' (always terminal) or 'expired' with a past/NULL period, IGNORE an
-- incoming 'active'/'grace' transition (return {ok:false, reason:'terminal'}).
-- All other transitions behave exactly as before. Signature/guards unchanged.
CREATE OR REPLACE FUNCTION public.sync_subscription(
    p_provider                 text,
    p_provider_subscription_id text,
    p_status                   text,
    p_period_end               timestamptz,
    p_cancel_at_period_end     boolean)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_user       uuid;
  v_cur_status text;
  v_cur_period timestamptz;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to sync subscription' USING errcode = '42501';
  END IF;
  IF p_provider_subscription_id IS NULL OR p_provider_subscription_id = '' THEN
    RAISE EXCEPTION 'provider_subscription_id required' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_status NOT IN ('active','canceled','expired','grace','past_due','paused','refunded') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = 'invalid_parameter_value';
  END IF;

  -- Lock + read the matched row so we can enforce terminal-state transitions.
  SELECT id, user_id, status, current_period_end
    INTO v_id, v_user, v_cur_status, v_cur_period
  FROM billing_subscriptions
  WHERE provider = p_provider
    AND provider_subscription_id = p_provider_subscription_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Terminal-state guard: never resurrect a refunded (or already lapsed 'expired')
  -- subscription back to ANY entitled state from an out-of-order provider event.
  -- The card cap is granted for status IN (active,canceled,grace,past_due) with a
  -- future period, so ALL of those incoming transitions must be blocked on a terminal
  -- row (not just active/grace) — else an out-of-order cancel/payment_failed after a
  -- refund would restore the raised limit.
  IF p_status IN ('active','grace','canceled','past_due')
     AND (
       v_cur_status = 'refunded'
       OR (v_cur_status = 'expired'
           AND (v_cur_period IS NULL OR v_cur_period <= now()))
     )
  THEN
    RETURN json_build_object('ok', false, 'reason', 'terminal');
  END IF;

  UPDATE billing_subscriptions
     SET status               = p_status,
         current_period_end   = COALESCE(p_period_end, current_period_end),
         cancel_at_period_end = COALESCE(p_cancel_at_period_end, cancel_at_period_end),
         updated_at           = now()
   WHERE id = v_id;

  RETURN json_build_object(
    'ok', true, 'id', v_id, 'user_id', v_user, 'status', p_status);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_subscription(text, text, text, timestamptz, boolean)
  TO service_role, authenticated;   -- authenticated reaches it only past the is_admin guard

-- ── 4) OFFSET GUARD: get_active_card_threshold() ───────────────────────────────
-- BUG (mig 123): OFFSET (_owned_card_limit - 1); a limit of 0 → OFFSET -1, which
-- errors ("OFFSET must not be negative") and breaks study for that user. Fix:
-- GREATEST(limit - 1, 0) so the OFFSET is never negative. Body otherwise
-- reproduced unchanged.
CREATE OR REPLACE FUNCTION public.get_active_card_threshold()
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.created_at
  FROM cards c
  JOIN decks d ON d.id = c.deck_id
  WHERE d.user_id = auth.uid()
    AND (
      (SELECT count_official_cards FROM card_limit_settings WHERE id = 1)
      OR NOT EXISTS (SELECT 1 FROM official_deck_manifest m WHERE m.deck_id = d.id)
    )
  ORDER BY c.created_at ASC, c.id ASC
  OFFSET GREATEST(public._owned_card_limit(auth.uid()) - 1, 0)
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_active_card_threshold() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_card_threshold() TO authenticated;
