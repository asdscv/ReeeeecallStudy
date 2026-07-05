-- ============================================================================
-- 130: Paginated AI credit ledger — powers the wallet "usage history" (사용 내역)
--      infinite scroll.
--
-- get_ai_wallet_summary (mig 117) returns only the newest 30 ledger rows inline.
-- ai_credit_ledger is deny-all RLS, so the client can't page it directly — this
-- SECURITY DEFINER RPC returns the CALLER's own rows with stable keyset pagination
-- on the identity PK `id` (monotonic → correlates with created_at, no tie skips).
--
-- Cursor: pass the smallest `id` you've seen as p_before_id to get the next older
-- page; NULL/omit for the first page. Read-only; no IDOR surface (keys off
-- auth.uid(), takes no user id param). Additive: CREATE OR REPLACE only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ai_credit_ledger(
  p_limit     int    DEFAULT 30,
  p_before_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id            bigint,
  delta         integer,
  reason        text,
  balance_after integer,
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
