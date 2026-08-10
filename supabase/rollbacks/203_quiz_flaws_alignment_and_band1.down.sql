-- Rollback 203: restore the unpermuted `meta` and band 1's unrestricted flaw menu.
-- 202 is the last definition of get_quiz_run_items before this one; re-apply it, then
-- put band 1 back to "any flaw allowed".
BEGIN;
UPDATE public.quiz_difficulty_levels
   SET allowed_flaws = '{}'::text[],
       guidance = guidance - 'mcq'
 WHERE level = 1;
COMMIT;
-- NOTE: get_quiz_run_items must be restored by re-running 195 then 202 in order.
