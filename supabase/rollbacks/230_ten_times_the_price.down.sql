-- Rollback 230: back to a tenth.
--
-- Absolute values guarded by the new ones, for the same reason the migration is: a divide would
-- not be idempotent, and running this twice would take the prices to a hundredth.
--
-- Jobs already charged at the new prices are LEFT ALONE. The ledger is a record of what happened,
-- and rewriting it to match a later decision would make it a record of nothing.
UPDATE ai_action_prices SET price_micro = 10000, updated_at = now()
 WHERE action = 'card' AND price_micro = 100000;
UPDATE ai_action_prices SET price_micro = 50000, updated_at = now()
 WHERE action = 'remediation_explain' AND price_micro = 500000;

UPDATE ai_pricing_settings
   SET quiz_unit_price_micro = 5000, target_margin_bps = 8000,
       est_price_per_card_micro = 1481, updated_at = now()
 WHERE id = 1 AND quiz_unit_price_micro = 50000;
