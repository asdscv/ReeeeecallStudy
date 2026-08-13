-- Migration 218: the free allowance is the whole loss ceiling.
--
-- Deck-metadata and template generation were priced at nothing AND counted against nothing —
-- `IF p_kind <> 'cards' THEN p_cards := 0`. So the daily free allowance bounded card generation
-- and then a second, unbounded channel sat beside it, on the most expensive call in the app:
-- measured on production, a template costs 851 micro against a card's 161.
--
-- Now they consume one unit of the same allowance. Nothing new is shown to a learner; what
-- changes is that there is exactly one ceiling instead of one ceiling plus a hole.
--
-- Pinned:
--   1) a deck and a template each consume ONE free card;
--   2) past the allowance they cost the card list price, not nothing;
--   3) an empty wallet past the allowance is refused, so the loss cannot exceed the allowance;
--   4) card generation itself is unchanged.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e8000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  v_uid uuid := 'e8000000-0000-4000-8000-000000000001';
  v_free constant integer := public._ai_free_cards_per_day();
  v_price constant bigint := public._ai_action_price('card');
  r jsonb; v_used integer;
BEGIN
  -- (1) each consumes one unit of the free allowance
  r := reserve_ai_generation('deck', 0);
  ASSERT (r->>'free_now')::int = 1, format('a deck should consume one free card, got %s', r->>'free_now');
  ASSERT (r->>'price_micro')::bigint = 0, 'inside the allowance nothing is charged';

  r := reserve_ai_generation('template', 0);
  ASSERT (r->>'free_now')::int = 1, format('a template should consume one free card, got %s', r->>'free_now');

  SELECT free_cards_used INTO v_used FROM ai_generation_usage
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  ASSERT v_used = 2, format('two setup calls should have used two free cards, got %s', v_used);

  -- (4) cards are unaffected
  r := reserve_ai_generation('cards', 3);
  ASSERT (r->>'free_now')::int = 3, format('three cards inside the allowance, got %s', r->>'free_now');

  -- (2) past the allowance, the setup calls cost the list price
  UPDATE ai_generation_usage SET free_cards_used = v_free
   WHERE user_id = v_uid AND usage_date = (now() AT TIME ZONE 'UTC')::date;
  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  PERFORM add_ai_credits(v_uid, v_price * 10, 'admin_grant', 'deck_template_test');
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);

  r := reserve_ai_generation('template', 0);
  ASSERT (r->>'paid_now')::int = 1, format('past the allowance a template is paid, got %s', r->>'paid_now');
  ASSERT (r->>'price_micro')::bigint = v_price,
    format('a paid template should cost the card list price %s, got %s', v_price, r->>'price_micro');

  RAISE NOTICE 'deck_template_metered_test: all assertions passed';
END $$;

-- (3) THE POINT OF THE WHOLE MIGRATION: past the allowance, with nothing in the wallet, the
-- setup calls are refused. Before this they ran regardless, for free, on the most expensive
-- call in the app — so the loss had no ceiling but the shared request cap.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
DO $$ BEGIN
  UPDATE ai_credit_balance SET balance = 0 WHERE user_id = 'e8000000-0000-4000-8000-000000000001';
END $$;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', false);
DO $$ BEGIN
  BEGIN
    PERFORM reserve_ai_generation('template', 0);
    RAISE EXCEPTION 'FAIL: a template ran past the free allowance with an empty wallet';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;
  BEGIN
    PERFORM reserve_ai_generation('deck', 0);
    RAISE EXCEPTION 'FAIL: a deck ran past the free allowance with an empty wallet';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL; END;

  RAISE NOTICE 'deck_template_metered_test (ceiling): all assertions passed';
END $$;

ROLLBACK;
