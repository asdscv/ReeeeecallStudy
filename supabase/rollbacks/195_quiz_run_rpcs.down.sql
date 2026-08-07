-- Rollback for 195 (Quiz run RPCs).
--
-- Functions only: 195 creates no tables, changes no columns, and rewrites nothing that existed
-- before it. Dropping these leaves the 193 tables in place, still holding whatever quizzes and
-- answers had been taken — which is the right outcome, because those rows are learner history
-- and this file's job is to remove the code that reads them, not the record of what they did.
--
-- Run this BEFORE 194's rollback if both are being applied: 194's `reserve_ai_quiz` references
-- quiz_sets and quiz_run_items by foreign key, and 193's rollback drops those tables. The order
-- across the three is 195 -> 194 -> 193.

BEGIN;

DROP FUNCTION IF EXISTS public.finish_quiz_run(uuid);
DROP FUNCTION IF EXISTS public.override_quiz_grade(uuid, numeric);
DROP FUNCTION IF EXISTS public.apply_quiz_grade(uuid, numeric, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.submit_quiz_answer(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.get_quiz_run_items(uuid);
DROP FUNCTION IF EXISTS public.start_quiz_run(uuid);
DROP FUNCTION IF EXISTS public.persist_quiz_questions(uuid, jsonb);
DROP FUNCTION IF EXISTS public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[]);
DROP FUNCTION IF EXISTS public.count_quizzable_cards(uuid, text, text[], uuid[]);
DROP FUNCTION IF EXISTS public._quiz_eligible_cards(uuid, uuid, text, text[], uuid[]);

COMMIT;
