-- Migration 045: bulk_insert_cards RPC tracking
-- This RPC was created in a previous deployment and this migration
-- exists for version-control tracking purposes.
--
-- The bulk_insert_cards function is called by the frontend ImportModal
-- to insert multiple cards in a single RPC call instead of one-by-one.
-- See: src/stores/card-store.ts → createCards()

-- No-op: function already exists in production
SELECT 1;
