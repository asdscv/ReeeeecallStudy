-- Migration 045: bulk_insert_cards RPC
-- Bulk insert cards for CSV/JSON import (called from card-store.ts createCards)

CREATE OR REPLACE FUNCTION public.bulk_insert_cards(
  p_deck_id UUID,
  p_template_id UUID,
  p_cards JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_position INTEGER;
  v_card JSONB;
  v_inserted INTEGER := 0;
BEGIN
  -- Auth check
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify deck ownership
  IF NOT EXISTS (
    SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Deck not found or not owned by user';
  END IF;

  -- Get current next_position
  SELECT next_position INTO v_position FROM decks WHERE id = p_deck_id;

  -- Insert each card
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO cards (
      deck_id, user_id, template_id,
      field_values, tags, sort_position
    ) VALUES (
      p_deck_id,
      v_user_id,
      p_template_id,
      COALESCE(v_card->'field_values', '{}'::jsonb),
      COALESCE(
        (SELECT array_agg(t.value::text)
         FROM jsonb_array_elements_text(v_card->'tags') AS t(value)),
        '{}'::text[]
      ),
      v_position
    );

    v_position := v_position + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Update deck next_position
  UPDATE decks
  SET next_position = v_position,
      updated_at = NOW()
  WHERE id = p_deck_id;

  RETURN jsonb_build_object('inserted', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_insert_cards(UUID, UUID, JSONB) TO authenticated;
