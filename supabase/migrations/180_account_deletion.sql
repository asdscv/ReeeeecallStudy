-- ============================================================================
-- 180 — delete_user_account(): the RPC both clients have always called
--
-- `supabase.rpc('delete_user_account')` is invoked by
--   packages/web/src/components/settings/PrivacyDataSection.tsx
--   packages/mobile/src/screens/SettingsScreen.tsx
-- and HAS NEVER EXISTED — not in this repo, not in any commit in its history, and
-- not in production (checked against pg_proc: zero functions matching %delete_user%
-- in any schema, while control lookups for get_plan_limits and
-- get_ai_generation_quota each returned one). Both clients handle the PGRST202 by
-- showing "deletion failed", so this has been failing closed rather than losing
-- data — but self-serve account deletion has simply not worked, while
-- privacy-policy.html promises removal within 30 days.
--
-- ## Why a plain DELETE was never enough
--
-- Verified by running it, not by reading schema. 51 foreign keys in `public`
-- reference auth.users: 42 CASCADE, 4 SET NULL, and **5 NO ACTION**. The five
-- abort the statement outright:
--
--   ERROR: update or delete on table "users" violates foreign key constraint
--          "marketplace_views_viewer_id_fkey" on table "marketplace_views"
--
-- and `marketplace_views` has a row for every logged-in user who ever opened a
-- listing. They are cleared explicitly below. (A `cards.template_id` RESTRICT was
-- also suspected of blocking the cascade; it does not — a delete with a real card
-- owned by the user succeeds, because the referencing `cards` rows cascade away in
-- the same statement. Recorded so nobody re-adds a workaround for it.)
--
-- ## Why the money rows are snapshotted rather than kept in place
--
-- All seven financial tables are ON DELETE CASCADE, so deleting the auth row
-- destroys the evidence that defends a chargeback: payment_intents (20 live rows
-- in prod), billing_subscriptions, billing_invoices, ai_credit_ledger,
-- ai_credit_balance, the legacy subscriptions table, and billing_consents — the
-- last being the pre-purchase withdrawal-right disclosure mig 157 exists to prove
-- under KR 전자상거래법 / EU-UK.
--
-- Flipping those FKs to SET NULL was rejected. It leaves rows whose `user_id` is
-- NULL, which is worse than useless in a dispute: the record survives but can no
-- longer be tied to the person disputing it. Retention has to keep the linkage,
-- so the rows are copied — with the email as it stood at deletion — into a table
-- that has NO foreign key to auth.users and therefore outlives the account.
--
-- 전자상거래법 제6조 requires contract and payment records to be kept for 5 years.
-- `billing_retention` is that record and nothing more: it is not readable by any
-- client, it is not joined into any product query, and `purge_expired_billing_
-- retention()` deletes rows once the obligation ends, so "retained" does not
-- quietly become "forever".
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE + REVOKE/GRANT.
-- ============================================================================

BEGIN;

-- ── The retention record ────────────────────────────────────────────────────
-- Deliberately NOT a foreign key to auth.users. That is the entire point: this
-- table has to survive the row it describes.
CREATE TABLE IF NOT EXISTS public.billing_retention (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plain uuid, no FK. Keeps the linkage a dispute needs without resurrecting
  -- the cascade that would delete it.
  deleted_user_id  uuid NOT NULL,
  -- As it stood at deletion. A chargeback arrives naming a person, not a uuid.
  email            text,
  -- Which table the row came from, so a future reader knows how to read `record`.
  source_table     text NOT NULL,
  -- The whole row, verbatim. Copying named columns would silently drop whatever
  -- a later migration adds to the source table.
  record           jsonb NOT NULL,
  -- When the underlying event happened (paid_at / consented_at / created_at),
  -- which is what the retention clock runs on — not when the account was deleted.
  occurred_at      timestamptz,
  retained_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_retention_source_known CHECK (source_table IN (
    'payment_intents', 'billing_subscriptions', 'billing_invoices',
    'billing_consents', 'ai_credit_ledger', 'ai_credit_balance', 'subscriptions'
  ))
);

CREATE INDEX IF NOT EXISTS idx_billing_retention_user ON public.billing_retention(deleted_user_id);
CREATE INDEX IF NOT EXISTS idx_billing_retention_occurred ON public.billing_retention(occurred_at);

ALTER TABLE public.billing_retention ENABLE ROW LEVEL SECURITY;
-- No policies, deliberately. This is the same posture as card_limit_settings and
-- ai_pricing_settings: reachable only by SECURITY DEFINER functions and
-- service_role. It holds the email addresses of people who asked to be deleted,
-- so it must not be readable by any client under any circumstance. The table-level
-- grants are revoked too rather than left to RLS alone — RLS is one
-- `DISABLE ROW LEVEL SECURITY` away from being the only thing standing here.
REVOKE ALL ON TABLE public.billing_retention FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.billing_retention IS
  'Payment/consent records kept after account deletion to satisfy statutory retention '
  '(전자상거래법 제6조, 5 years). No FK to auth.users by design. Never client-readable.';

-- ── delete_user_account ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_user_account()
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_email    text;
  v_retained integer := 0;
  v_n        integer;
BEGIN
  -- The caller deletes THEIR OWN account and nobody else's. There is deliberately
  -- no p_user_id parameter: a caller-supplied id on a SECURITY DEFINER function is
  -- how this repo's IDOR family (migs 098/099) happened, and the blast radius here
  -- is an entire account.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = 'P0001';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- ── 1. Retain what the law requires, BEFORE anything cascades ─────────────
  -- to_jsonb(t.*) rather than a column list: a column added to any of these
  -- tables tomorrow is retained automatically instead of being silently dropped
  -- from the evidence.
  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'payment_intents', to_jsonb(t.*), COALESCE(t.paid_at, t.created_at)
    FROM payment_intents t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'billing_subscriptions', to_jsonb(t.*), t.created_at
    FROM billing_subscriptions t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'billing_invoices', to_jsonb(t.*), t.created_at
    FROM billing_invoices t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  -- The withdrawal-right disclosure. Losing this loses the ability to show the
  -- learner was told, before the charge, that a used purchase is non-refundable.
  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'billing_consents', to_jsonb(t.*), t.consented_at
    FROM billing_consents t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'ai_credit_ledger', to_jsonb(t.*), t.created_at
    FROM ai_credit_ledger t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'ai_credit_balance', to_jsonb(t.*), t.updated_at
    FROM ai_credit_balance t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  INSERT INTO billing_retention (deleted_user_id, email, source_table, record, occurred_at)
  SELECT v_uid, v_email, 'subscriptions', to_jsonb(t.*), t.created_at
    FROM subscriptions t WHERE t.user_id = v_uid;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_retained := v_retained + v_n;

  -- ── 2. Someone else's row that names this person ──────────────────────────
  -- `deck_shares.invite_email` stores a THIRD PARTY's address on the inviter's
  -- row. The invitee's own cascade never touches it, so without this an address
  -- belonging to a deleted account survives on an account that still exists.
  IF v_email IS NOT NULL THEN
    UPDATE deck_shares SET invite_email = NULL
     WHERE lower(invite_email) = lower(v_email);
  END IF;

  -- ── 3. Clear the five FKs that would otherwise abort the delete ───────────
  -- Nullable ones are de-identified: the moderation/analytics fact survives
  -- without naming a person who asked to be forgotten.
  UPDATE marketplace_views          SET viewer_id   = NULL WHERE viewer_id   = v_uid;
  UPDATE marketplace_reports        SET resolved_by = NULL WHERE resolved_by = v_uid;
  UPDATE official_account_settings  SET verified_by = NULL WHERE verified_by = v_uid;

  -- These two columns are NOT NULL, so the row itself has to go. Both are already
  -- bound to content that cascades with the account (deck_versions.deck_id →
  -- decks, marketplace_reports.listing_id → marketplace_listings), so in the
  -- normal case these delete nothing that the cascade would not have taken anyway.
  DELETE FROM deck_versions      WHERE created_by  = v_uid;
  DELETE FROM marketplace_reports WHERE reporter_id = v_uid;

  -- ── 4. The account itself ─────────────────────────────────────────────────
  -- 42 cascading foreign keys remove the learner's content: decks, cards,
  -- templates, progress, study logs, sessions, streaks, goals, plans, attempts,
  -- enrichments, recommendations, shares, listings, reviews. The four SET NULL
  -- FKs (analytics_events, content_views, page_views, decks.source_owner_id)
  -- de-identify rather than delete, which is the correct outcome for aggregate
  -- analytics and for a deck someone else copied.
  DELETE FROM auth.users WHERE id = v_uid;

  RETURN json_build_object(
    'deleted', true,
    'retained_records', v_retained
  );
END;
$$;

COMMENT ON FUNCTION public.delete_user_account() IS
  'Deletes the CALLING user''s account. Statutorily-required payment/consent records are '
  'copied to billing_retention first; everything else is destroyed or de-identified.';

-- Default privileges GRANT EXECUTE to PUBLIC on creation and CREATE OR REPLACE
-- does not re-alter them, so revoke before granting. `anon` must never reach this:
-- it takes no argument and acts on auth.uid(), but an unauthenticated caller
-- should get a 404 from PostgREST rather than a P0001 from inside the function.
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- ── Ending the obligation ───────────────────────────────────────────────────
-- Retention that never expires is not retention, it is hoarding. This is not
-- scheduled (pg_cron is not installed on this project); it is the callable an
-- operator or a Cloudflare cron invokes, and its existence is what makes the
-- 5-year claim in the privacy policy true rather than aspirational.
CREATE OR REPLACE FUNCTION public.purge_expired_billing_retention(p_years integer DEFAULT 5)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (auth.role() = 'service_role' OR is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  IF p_years IS NULL OR p_years < 1 THEN
    RAISE EXCEPTION 'Retention must be at least one year' USING errcode = 'P0002';
  END IF;
  -- COALESCE so a row that never carried an event date still ages out, measured
  -- from when it was retained.
  DELETE FROM billing_retention
   WHERE COALESCE(occurred_at, retained_at) < now() - make_interval(years => p_years);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_billing_retention(integer) FROM PUBLIC, anon, authenticated;

COMMIT;
