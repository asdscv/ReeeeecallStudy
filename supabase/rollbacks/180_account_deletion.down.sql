-- Rollback 180 — remove account deletion.
--
-- ⚠️ DESTRUCTIVE, and not symmetrically so. Dropping `billing_retention` discards
-- the payment and consent records of accounts that have ALREADY been deleted —
-- rows that exist nowhere else, because the originals cascaded away with the auth
-- user. Once gone there is no way to answer a chargeback from one of those
-- accounts.
--
-- So the table is NOT dropped here. Reverting the code path is cheap and safe;
-- discarding retained evidence is neither, and a rollback script is the wrong
-- place to make that decision silently. Drop it by hand, deliberately, if you
-- genuinely mean to:
--
--   DROP TABLE public.billing_retention;
--
-- Reverting the function alone restores the previous behaviour exactly: the RPC
-- stops existing, and both clients fall back to the PGRST202 → "deletion failed"
-- message they showed before mig 180.
--
-- Idempotent: IF EXISTS throughout, so a second pass is a no-op.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_user_account();
DROP FUNCTION IF EXISTS public.purge_expired_billing_retention(integer);

-- billing_retention deliberately left in place — see the note above.

COMMIT;
