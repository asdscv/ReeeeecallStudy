-- Rollback 216: back to charging whatever the tokens came to.
--
-- The column and the price table are LEFT IN PLACE — dropping them would lose the record of
-- what each historical job agreed to pay. What reverts is the behaviour: clearing
-- `fixed_price_micro` on unsettled jobs makes `charge_ai_generation` fall back to cost x markup
-- for them, and the reserve functions are restored to their 212/194 bodies by re-running those
-- migrations. Do that deliberately; this file only undoes the pricing decision.
BEGIN;

UPDATE public.ai_generation_jobs
   SET fixed_price_micro = NULL
 WHERE NOT charged AND NOT refunded;

DELETE FROM public.ai_action_prices WHERE action IN ('card', 'remediation_explain');

COMMIT;
