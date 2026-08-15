-- Rollback 219: back to refusing every ambiguous deck.
--
-- The column is left in place — it holds a choice a model was paid to make, and dropping it
-- would lose that. Only the eligibility function reverts, which re-refuses the 342 cards.
BEGIN;
CREATE OR REPLACE FUNCTION public._quiz_eligible_cards(
  p_uid        uuid,
  p_deck_id    uuid,
  p_scope_kind text   DEFAULT 'deck',
  p_tags       text[] DEFAULT '{}'::text[],
  p_card_ids   uuid[] DEFAULT '{}'::uuid[]
) RETURNS TABLE (card_id uuid, answer_key text, answer_text text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH scoped AS (
    SELECT c.id, c.field_values, c.template_id
    FROM cards c
    WHERE c.deck_id = p_deck_id
      AND (p_scope_kind <> 'tags'  OR c.tags && p_tags)
      AND (p_scope_kind <> 'cards' OR c.id = ANY(p_card_ids))
  ),
  tpl AS (
    SELECT t.id,
           (SELECT jsonb_object_agg(f->>'key', f->>'type')
              FROM jsonb_array_elements(t.fields) f) AS ftype,
           t.front_layout, t.back_layout
    FROM card_templates t
    WHERE t.id IN (SELECT DISTINCT template_id FROM scoped)
  ),
  -- Front: any non-empty text field. Presence is all that matters here.
  front AS (
    SELECT s.id AS card_id, array_agg(DISTINCT fl->>'field_key') AS keys
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL jsonb_array_elements(tpl.front_layout) fl
    WHERE tpl.ftype ->> (fl->>'field_key') = 'text'
      AND coalesce(btrim(s.field_values ->> (fl->>'field_key')), '') <> ''
    GROUP BY s.id
  ),
  -- Back: the candidates, and which of them the author marked primary.
  back AS (
    SELECT s.id AS card_id,
           count(*) AS cand_n,
           count(*) FILTER (WHERE bl->>'style' = 'primary') AS primary_n,
           min(bl->>'field_key') FILTER (WHERE bl->>'style' = 'primary') AS primary_key,
           min(bl->>'field_key') AS only_key
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL jsonb_array_elements(tpl.back_layout) bl
    WHERE tpl.ftype ->> (bl->>'field_key') = 'text'
      AND coalesce(btrim(s.field_values ->> (bl->>'field_key')), '') <> ''
    GROUP BY s.id
  )
  SELECT s.id,
         k.answer_key,
         btrim(s.field_values ->> k.answer_key)
  FROM scoped s
  JOIN front f ON f.card_id = s.id
  JOIN back  b ON b.card_id = s.id
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN b.primary_n = 1 THEN b.primary_key
             WHEN b.primary_n = 0 AND b.cand_n = 1 THEN b.only_key
           END AS answer_key
  ) k
  WHERE k.answer_key IS NOT NULL
    AND NOT (k.answer_key = ANY(f.keys));
$$;
COMMIT;
