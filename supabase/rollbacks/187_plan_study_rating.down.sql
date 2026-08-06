-- Rollback for 187: drop the plan-study wrapper.
--
-- Net-zero: 187 only ADDS a function. It changes neither table nor the two
-- functions it calls, so dropping it restores the prior state exactly. Clients on
-- the new build fall back to nothing — the plan study session simply cannot rate —
-- so this must be rolled back together with the client, not ahead of it.
DROP FUNCTION IF EXISTS public.apply_plan_study_rating(
  uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer
);
