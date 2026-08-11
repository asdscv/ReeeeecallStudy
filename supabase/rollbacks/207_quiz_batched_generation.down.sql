-- Rollback 207: restore single-call generation.
--   psql ... -f supabase/migrations/195_quiz_run_rpcs.sql   (persist_quiz_questions, overwrite form)
--   psql ... -f supabase/migrations/202_quiz_difficulty_guidance.sql  (create_quiz_set, cap 12)
-- Nothing else to drop: 207 only replaced two functions.
SELECT 'run 195 then 202 to roll 207 back' AS note;
