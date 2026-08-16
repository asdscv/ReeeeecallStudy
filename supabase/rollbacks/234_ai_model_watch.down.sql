-- Rollback 234: nobody watches the model lists again.
--
-- Drops the table and both reads. The next time a provider retires a model or cuts its quota, the
-- app finds out the way it did the last three times: a learner hits an error.
DROP FUNCTION IF EXISTS public.unacknowledged_ai_models();
DROP FUNCTION IF EXISTS public.record_ai_models(text, text[]);
DROP TABLE IF EXISTS public.ai_known_models;
