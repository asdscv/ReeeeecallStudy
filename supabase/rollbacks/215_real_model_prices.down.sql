-- Rollback 215: back to the seeded (wrong) rates from 214.
--
-- This restores an under-recording of 2.5x on input and 3.75x on output for
-- gemini-3.1-flash-lite. Only useful if the verified rates turn out to be misread.
BEGIN;
DELETE FROM public.ai_pricing_config
 WHERE provider = 'gemini' AND note LIKE 'verified 2026-08-12%';
DELETE FROM public.ai_pricing_config
 WHERE provider = 'gemini' AND note LIKE 'ALIAS —%';
COMMIT;
