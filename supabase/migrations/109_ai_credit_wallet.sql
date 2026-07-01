-- ============================================================================
-- 109: AI credit wallet — pay-as-you-go prepaid balance (server-gen Phase 1a).
--
-- Phase 0 (mig 108) hard-capped at 10 free cards/day. Phase 1 adds a prepaid
-- credit wallet: cards beyond the daily free allowance spend credits instead of
-- being rejected. Credits are the internal unit (1 credit = 1 card by default,
-- tunable); the ₩/credit price is set at the payment layer (PortOne / IAP — 1c).
--
--   ai_credit_balance  one row/user, current balance (deny-all; RPC-only)
--   ai_credit_ledger   append-only audit of every +grant / -spend / refund
--   add_ai_credits()   grant credits — service_role (payment webhooks) or admin,
--                      IDEMPOTENT on a payment ref (no double-grant on replay)
--   get_ai_wallet()    caller's balance + price
--   record_ai_generation()  free→paid split; paid portion debits credits
--                           (atomic; insufficient → P0002 → rolls back). Returns
--                           jsonb {remaining_free, free_now, paid_now, credits_spent}
--                           so a failed generation can be refunded precisely.
--   refund_ai_generation()  reverses a recorded call (restores credits + the
--                           exact free/paid counters) — supersedes mig-108's.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_credit_balance (
  user_id    uuid        NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  balance    integer     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_credit_balance ENABLE ROW LEVEL SECURITY;  -- deny-all; RPC-only

CREATE TABLE IF NOT EXISTS public.ai_credit_ledger (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  delta         integer     NOT NULL,   -- +grant/+refund / -spend
  reason        text        NOT NULL,   -- 'purchase'|'spend_cards'|'spend_image'|'admin_grant'|'refund'
  ref           text,                   -- payment id / external ref (dedup key for grants)
  balance_after integer     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_credit_ledger ENABLE ROW LEVEL SECURITY;  -- deny-all; RPC-only
CREATE INDEX IF NOT EXISTS ai_credit_ledger_user_time ON public.ai_credit_ledger (user_id, created_at DESC);
-- Idempotency guard: a credit GRANT carrying a ref applies at most once (C1 —
-- payment webhooks / IAP receipts retry at-least-once). Spends/refunds (ref NULL
-- or negative delta) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_grant_ref
  ON public.ai_credit_ledger (ref) WHERE ref IS NOT NULL AND delta > 0;

-- Credits charged per card beyond the free allowance (config seam).
CREATE OR REPLACE FUNCTION public._ai_credits_per_card()
  RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION public._ai_credits_per_card() FROM PUBLIC, anon, authenticated;

-- Grant credits to a user. Called by payment webhooks / IAP receipt validation
-- (service_role) or an admin — NEVER a plain user. IDEMPOTENT on p_ref: a
-- duplicate delivery for the same payment is a no-op (returns current balance).
CREATE OR REPLACE FUNCTION public.add_ai_credits(
  p_user_id uuid, p_credits integer, p_reason text, p_ref text DEFAULT NULL)
  RETURNS integer  -- balance after (or current balance if duplicate ref)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_bal integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorized to grant credits' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credit grant' USING errcode = 'invalid_parameter_value';
  END IF;

  -- fast path: a grant with this ref already landed → no-op
  IF p_ref IS NOT NULL AND EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = p_ref AND delta > 0) THEN
    RETURN COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user_id), 0);
  END IF;

  INSERT INTO ai_credit_balance (user_id, balance) VALUES (p_user_id, p_credits)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (p_user_id, p_credits, COALESCE(p_reason, 'admin_grant'), p_ref, v_bal);
  RETURN v_bal;
EXCEPTION WHEN unique_violation THEN
  -- concurrent duplicate ref lost the race on ai_credit_ledger_grant_ref →
  -- the whole block rolled back, so no double-apply. Return current balance.
  RETURN COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = p_user_id), 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_ai_credits(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_ai_credits(uuid, integer, text, text) TO authenticated, service_role;

-- Caller's wallet snapshot for the client.
CREATE OR REPLACE FUNCTION public.get_ai_wallet()
  RETURNS TABLE (balance integer, credits_per_card integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY SELECT
    COALESCE((SELECT b.balance FROM ai_credit_balance b WHERE b.user_id = v_uid), 0),
    public._ai_credits_per_card();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_wallet() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_wallet() TO authenticated;

-- Redesigned metering: split this call into free vs paid cards; the paid
-- portion spends credits atomically. Returns the split as jsonb so a failed
-- generation can be refunded EXACTLY (mig 108 returned a bare int).
DROP FUNCTION IF EXISTS public.record_ai_generation(text, integer);
CREATE FUNCTION public.record_ai_generation(p_kind text, p_cards integer DEFAULT 0)
  RETURNS jsonb  -- { remaining_free, free_now, paid_now, credits_spent }
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_used  integer;
  v_reqs  integer;
  v_free_now integer;
  v_paid_now integer;
  v_need  integer;
  v_bal   integer;
  c_free constant integer := public._ai_free_cards_per_day();
  c_cpc  constant integer := public._ai_credits_per_card();
  c_max_reqs constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_kind NOT IN ('cards', 'template', 'deck') THEN
    RAISE EXCEPTION 'Invalid generation kind: %', p_kind USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_cards IS NULL OR p_cards < 0 THEN p_cards := 0; END IF;
  IF p_kind <> 'cards' THEN p_cards := 0; END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT free_cards_used, req_count INTO v_used, v_reqs
    FROM ai_generation_usage WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;

  IF v_reqs + 1 > c_max_reqs THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;

  v_free_now := LEAST(p_cards, GREATEST(0, c_free - v_used));
  v_paid_now := p_cards - v_free_now;
  v_need     := v_paid_now * c_cpc;

  IF v_need > 0 THEN
    UPDATE ai_credit_balance SET balance = balance - v_need, updated_at = now()
      WHERE user_id = v_uid AND balance >= v_need
      RETURNING balance INTO v_bal;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient AI credits' USING errcode = 'P0002';
    END IF;
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (v_uid, -v_need, 'spend_cards', NULL, v_bal);
  END IF;

  UPDATE ai_generation_usage
     SET free_cards_used = free_cards_used + v_free_now,
         paid_cards_used = paid_cards_used + v_paid_now,
         req_count       = req_count + 1
   WHERE user_id = v_uid AND usage_date = v_today;

  RETURN jsonb_build_object(
    'remaining_free', GREATEST(0, c_free - (v_used + v_free_now)),
    'free_now',       v_free_now,
    'paid_now',       v_paid_now,
    'credits_spent',  v_need
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_ai_generation(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_ai_generation(text, integer) TO authenticated;

-- Precise reversal of a recorded generation (provider failed → refund). Restores
-- the debited credits (ledger 'refund') and the EXACT free/paid counters this
-- call recorded. Supersedes mig-108's flat refund_ai_generation(integer).
DROP FUNCTION IF EXISTS public.refund_ai_generation(integer);
CREATE FUNCTION public.refund_ai_generation(p_free integer, p_paid integer, p_credits integer)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_today date    := (now() AT TIME ZONE 'UTC')::date;
  v_bal   integer;
  v_free  integer := GREATEST(0, COALESCE(p_free, 0));
  v_paid  integer := GREATEST(0, COALESCE(p_paid, 0));
  v_cred  integer := GREATEST(0, COALESCE(p_credits, 0));
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  IF v_free > 0 OR v_paid > 0 THEN
    UPDATE ai_generation_usage
       SET free_cards_used = GREATEST(0, free_cards_used - v_free),
           paid_cards_used = GREATEST(0, paid_cards_used - v_paid)
     WHERE user_id = v_uid AND usage_date = v_today;
  END IF;

  IF v_cred > 0 THEN
    UPDATE ai_credit_balance SET balance = balance + v_cred, updated_at = now()
      WHERE user_id = v_uid RETURNING balance INTO v_bal;
    IF FOUND THEN
      INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
        VALUES (v_uid, v_cred, 'refund', NULL, v_bal);
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refund_ai_generation(integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refund_ai_generation(integer, integer, integer) TO authenticated;
