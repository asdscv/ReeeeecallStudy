-- Rollback for 190.
--
-- Deliberately EMPTY. Dropping `study_logs.prev_srs_status` would reinstate the
-- failure this migration repaired: `apply_study_rating` writes that column, so
-- without it every SRS rating raises 42703 and no card is ever rescheduled.
--
-- The column is also what mig 046 asked for in the first place, so removing it
-- would put the schema behind a migration recorded as applied since then.
SELECT 'mig 190 is not reversible by design — see the note above' AS note;
