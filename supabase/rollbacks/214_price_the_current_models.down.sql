-- Rollback 214: back to charging the pessimistic fallback for the current models.
--
-- The price rows are removed, which restores the 43x overcharge for any model not otherwise
-- listed. Only do this if a rate here turns out to be wrong in a way that matters more than
-- being unpriced — and prefer correcting the rate with a new row over deleting these.
BEGIN;

DROP FUNCTION IF EXISTS public.ai_unpriced_models();

DELETE FROM public.ai_pricing_config
 WHERE provider = 'gemini'
   AND model IN ('gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest')
   AND note LIKE 'seed: indicative%';

COMMIT;
