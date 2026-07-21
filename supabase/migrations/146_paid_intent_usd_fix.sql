-- ============================================================================
-- 146: Finish the mig-145 ₩→micro-USD rebase for NON-pending payment intents.
--
-- mig 145 (section 4) rebased payment_intents.amount_micro_won ÷1350 only
-- `WHERE status = 'pending'`. But PAID and REFUNDED rows carry amount_micro_won
-- too, and two consumers read it AS micro-USD after 145:
--   • admin_billing_overview.paid_revenue_30d  (mig 145 §6)  — SUM(amount_micro_won)
--   • the credit-pack refund clawback (mig 127/144)          — claws amount_micro_won
-- So a still-₩ paid row (e.g. a $0.99 pack snapshotted 1,000,000,000 micro-WON)
-- reads as $1,000 — 1350× — inflating admin 30-day revenue and over-clawing on a
-- refund. On prod there are paid+refunded test intents (credit_pack, owner comp),
-- so this is live, not just latent.
--
-- Fix: rebase every NON-pending intent's amount_micro_won ÷1350 (pending rows were
-- already done by 145, so they're excluded to avoid a double divide). Idempotent by
-- construction after 145+146 run once; on a fresh CI DB there are no payment_intents
-- so it's a no-op. Whole-WON `amount_krw` is left as-is (a legacy display column;
-- the admin USD conversion is handled separately by the admin list RPCs).
-- ============================================================================

UPDATE public.payment_intents
   SET amount_micro_won = round(amount_micro_won / 1350.0)
 WHERE amount_micro_won IS NOT NULL
   AND status <> 'pending';
