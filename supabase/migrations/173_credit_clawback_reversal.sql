-- ============================================================================
-- 173: Reverse a credit clawback (RevenueCat REFUND_REVERSED), and make the
--      refund guard notice that a refund was reversed.
--
-- CONTEXT. mig 134 gave the consumable credit-pack refund two durable shapes on
-- ai_credit_ledger, both keyed 'refund:' || <grant ref>:
--   * delta < 0  — the grant existed and was reversed;
--   * delta = 0  — TOMBSTONE: the refund arrived BEFORE its grant, so a later
--                  grant redelivery must be refused (mig 158's guard).
-- Neither shape could ever be undone. The store can undo a refund: the App Store
-- sends REFUND_REVERSED when a refund it previously granted is reversed (money is
-- ours again). Until now that event fell through the webhook's switch and was
-- acked with no action, so:
--   * the clawed-back credits stayed clawed back — the customer paid and got
--     nothing, and no code path could restore the balance; and
--   * a tombstoned ref stayed refused forever, so the grant could never land.
--
-- THIS MIGRATION
--   1) reverse_credit_clawback(user, grant_ref) — undo exactly the clawback that
--      mig 134 wrote, reading the amount from the ledger (never from the caller),
--      idempotent on ref = 'reversal:' || grant_ref.
--   2) credit_grant_is_refunded() — a refund that has been reversed no longer
--      blocks the grant. Without this, (1) restores the money but a tombstoned
--      ref stays permanently unmintable, which is the same bug with extra steps.
--
-- Money conservation, stated as the invariant the pair maintains:
--     grant  +  clawback  +  reversal  =  grant       (per grant ref)
-- The reversal amount is ALWAYS -1 × the clawback row's delta, so a tombstone
-- (delta 0) reverses to 0 — nothing was taken, so nothing is given.
--
-- KNOWN LIMITATION, deliberately not tombstoned (unlike mig 134's refund-before-
-- grant case). If a REFUND_REVERSED were delivered BEFORE the refund it reverses,
-- there is no clawback row to reverse, so this returns {ok:false,
-- reason:'no_clawback'} and writes nothing; the later refund then claws back and
-- stays clawed back. The obvious symmetric fix — write a 'reversal:' marker up
-- front and let the clawback skip on it — was NOT taken, because a marker cannot
-- tell "this refund was already reversed" from "this transaction was refunded a
-- second time after a reversal", and skipping the second refund means keeping money
-- we owe back. Losing a reversal is recoverable by an admin grant; wrongly keeping a
-- refunded customer's money is not. RevenueCat generates the refund strictly before
-- its reversal and retries with backoff, so the inverted order needs the earlier
-- event to fail for as long as the later one takes to be created. Pinned by an
-- assertion in credit_clawback_reversal_test.sql so the behaviour is visible.
--
-- Idempotent: CREATE OR REPLACE only. No schema change, no data change.
-- ============================================================================

-- ── 1) reverse_credit_clawback ──────────────────────────────────────────────
-- Takes the GRANT's ref (e.g. 'rc:1000000111'), like clawback_ai_credits_by_ref
-- and credit_grant_is_refunded, so no caller has to know the namespaces.
--
-- LOCK-BEFORE-CHECK, mirroring mig 134/127: lock the clawback row FIRST, then
-- evaluate idempotency, so two concurrent REFUND_REVERSED redeliveries serialize
-- and the loser sees the committed reversal instead of double-crediting.
--
-- The role gate is INSIDE the function (mig 158's reasoning): every service-role
-- RPC here checks auth.role() itself rather than leaning on the GRANT alone.
CREATE OR REPLACE FUNCTION public.reverse_credit_clawback(
    p_user_id uuid,
    p_ref     text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claw_user  uuid;
  v_claw_delta bigint;   -- micro-USD; bigint or a ₩10,000-class pack overflows int4
  v_bal        bigint;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to reverse a credit clawback' USING errcode = '42501';
  END IF;
  IF p_ref IS NULL OR p_ref = '' THEN
    RETURN json_build_object('ok', false, 'reason', 'no_ref');
  END IF;

  -- Lock the clawback row (negative reversal OR delta-0 tombstone). Both are
  -- written with ref = 'refund:' || grant_ref and there is at most one, but
  -- ORDER BY id + LIMIT 1 keeps this well-defined if history ever holds both.
  SELECT user_id, delta INTO v_claw_user, v_claw_delta
  FROM ai_credit_ledger
  WHERE ref = 'refund:' || p_ref
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF v_claw_user IS NULL THEN
    -- Nothing was ever clawed back for this ref. Deliberately NOT an error: a
    -- REFUND_REVERSED for a purchase we never clawed back (or never saw) is a
    -- no-op, and the webhook must ack it so the store stops retrying.
    RETURN json_build_object('ok', false, 'reason', 'no_clawback');
  END IF;

  -- Defensive: never restore credits onto a different account than the one the
  -- clawback took them from.
  IF p_user_id IS NOT NULL AND p_user_id <> v_claw_user THEN
    RETURN json_build_object('ok', false, 'reason', 'user_mismatch');
  END IF;

  -- IDEMPOTENT: evaluated under the lock, so a concurrent reversal that already
  -- committed is visible (READ COMMITTED). Covers the delta-0 case too, which the
  -- ai_credit_ledger_grant_ref unique index (delta > 0 only) cannot.
  IF EXISTS (SELECT 1 FROM ai_credit_ledger WHERE ref = 'reversal:' || p_ref) THEN
    RETURN json_build_object('ok', true, 'already', true);
  END IF;

  -- A tombstone took nothing, so its reversal restores nothing. Still record the
  -- row: it is what lifts the grant block in credit_grant_is_refunded below.
  IF v_claw_delta = 0 THEN
    INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
      VALUES (v_claw_user, 0, 'purchase', 'reversal:' || p_ref,
              COALESCE((SELECT balance FROM ai_credit_balance WHERE user_id = v_claw_user), 0));
    RETURN json_build_object('ok', true, 'restored', 0, 'tombstone_lifted', true,
                             'user_id', v_claw_user);
  END IF;

  -- Restore EXACTLY what the clawback removed (-1 × its delta), self-contained
  -- balance write + ledger row, same pattern as clawback_ai_credits_by_ref.
  INSERT INTO ai_credit_balance (user_id, balance)
    VALUES (v_claw_user, -v_claw_delta)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = ai_credit_balance.balance + EXCLUDED.balance, updated_at = now()
    RETURNING balance INTO v_bal;
  INSERT INTO ai_credit_ledger (user_id, delta, reason, ref, balance_after)
    VALUES (v_claw_user, -v_claw_delta, 'purchase', 'reversal:' || p_ref, v_bal);

  RETURN json_build_object(
    'ok', true, 'restored', -v_claw_delta, 'user_id', v_claw_user, 'balance', v_bal);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reverse_credit_clawback(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reverse_credit_clawback(uuid, text) TO service_role;

-- ── 2) credit_grant_is_refunded — a REVERSED refund no longer blocks ─────────
-- mig 158's body, plus the reversal exception. Same signature, same role gate,
-- same "takes the GRANT's ref" contract.
--
-- Order matters for money: the guard stays TRUE while a refund stands, so an
-- out-of-order grant is still refused; it only turns FALSE once the store tells
-- us the refund itself was undone.
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
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ai_credit_ledger
     WHERE ref = 'reversal:' || p_ref
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.credit_grant_is_refunded(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.credit_grant_is_refunded(text) TO service_role;
