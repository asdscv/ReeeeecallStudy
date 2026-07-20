-- ============================================================================
-- 143: Fix get_ai_credit_ledger overflow — return delta/balance_after as bigint.
--
-- mig 130 declared the paginated ledger RPC's OUT columns as `integer`, but
-- mig 114 widened ai_credit_ledger.delta and .balance_after to `bigint` (they
-- hold micro-WON; 1 KRW = 1e6). int32 max = 2,147,483,647 ≈ ₩2,147, so any
-- ledger row above ~₩2,148 — every real top-up pack (₩5,000/₩9,900) and any
-- admin comp grant via admin_billing adjust_wallet — forces a bigint→int
-- coercion on the function's OUT column and raises numeric_value_out_of_range
-- (22003), aborting the whole query. getAiCreditLedger() fails open to [], so
-- the web "usage history" (사용 내역) silently shows "no usage yet" for exactly
-- those users while their balance reads positive. Mobile is unaffected (reads
-- the ledger from get_ai_wallet_summary's JSON, which is bigint-safe).
--
-- Changing an OUT-column type requires DROP + CREATE (CREATE OR REPLACE can't
-- alter the return signature). Body/pagination/grants are otherwise identical to
-- mig 130. The client WalletLedgerRow already types these as `number`, so no
-- client change is needed.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_ai_credit_ledger(int, bigint);

CREATE FUNCTION public.get_ai_credit_ledger(
  p_limit     int    DEFAULT 30,
  p_before_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id            bigint,
  delta         bigint,      -- was integer (mig 130) → overflowed on micro-WON
  reason        text,
  balance_after bigint,      -- was integer (mig 130) → overflowed on micro-WON
  created_at    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.delta, l.reason, l.balance_after, l.created_at
    FROM public.ai_credit_ledger l
   WHERE l.user_id = auth.uid()
     AND (p_before_id IS NULL OR l.id < p_before_id)
   ORDER BY l.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
$$;

-- Internal-to-the-caller read: needs a JWT (auth.uid()); anon gets nothing anyway.
REVOKE EXECUTE ON FUNCTION public.get_ai_credit_ledger(int, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_credit_ledger(int, bigint) TO authenticated, service_role;
