-- ============================================================================
-- 158: Make the refund-before-grant guard actually work.
--
-- THE BUG. mig 134 added a guard to the RevenueCat webhook: before granting a
-- consumable credit pack, look for a `refund:<ref>` tombstone and skip the grant if
-- the REFUND already arrived (RevenueCat does not guarantee delivery order). The
-- guard read the table directly:
--
--     await sb.from('ai_credit_ledger').select('id').eq('ref', 'refund:' + creditRef)
--
-- but ai_credit_ledger is deliberately RPC-ONLY (mig 109: RLS on, no table grants —
-- every access goes through a SECURITY DEFINER function). service_role was never
-- granted SELECT on it, so that read returned
--     42501 permission denied for table ai_credit_ledger
-- on every single call. The webhook discarded the error (`const { data: tomb }`,
-- no error branch), so `tomb` was always null and the guard NEVER fired.
--
-- IMPACT: a refund that arrived before its grant tombstoned the ref and then the
-- grant landed anyway — credits issued for a purchase the store had already
-- refunded. Money out, nothing back. This has been the behaviour since mig 134;
-- it was invisible because mobile IAP had no production traffic yet.
--
-- Verified by driving the deployed webhook against a local DB with real
-- RevenueCat-shaped events: the tombstone was written, the late grant still
-- credited the wallet, and PostgREST answered the guard's query with 42501.
--
-- THE FIX (this migration). Do NOT hand service_role a table grant — that would
-- punch the first hole in the RPC-only design that every other wallet access
-- respects. Instead expose the single question the webhook needs as a
-- SECURITY DEFINER predicate. The webhook switches to it and, crucially, now
-- FAILS CLOSED when the check itself errors (500 → RevenueCat retries) rather
-- than granting on a failed lookup.
--
-- Idempotent: CREATE OR REPLACE only.
-- ============================================================================

-- credit_grant_is_refunded — "has this credit grant already been reversed?"
--
-- True when a clawback tombstone exists for p_ref. Both mig 127 and mig 134 write
-- their reversal row with ref = 'refund:' || <the grant's ref>, and mig 134 also
-- writes a delta-0 tombstone when the refund BEATS the grant — so this one lookup
-- answers both "already clawed back" and "refunded before we granted".
--
-- Takes the GRANT's ref (e.g. 'rc:1000000111'), not the tombstone's, so callers
-- cannot accidentally pass a pre-namespaced value.
-- The role gate is INSIDE the function, not just on the GRANT: every other
-- service-role RPC in this codebase (set_subscription_platform, clawback_*, …)
-- checks auth.role() itself, and a definer function that leans only on its GRANT
-- silently opens up if the grant is ever widened.
CREATE OR REPLACE FUNCTION public.credit_grant_is_refunded(p_ref text)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to read credit refund state' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.ai_credit_ledger
     WHERE ref = 'refund:' || p_ref
  );
END;
$$;

-- service_role (the webhooks) and admins only — a plain user has no business
-- probing another account's ledger refs.
REVOKE EXECUTE ON FUNCTION public.credit_grant_is_refunded(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.credit_grant_is_refunded(text) TO service_role;
