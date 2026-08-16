-- Rollback 221: back to deciding the graded field from what each card happens to fill in.
--
-- Re-applies 219's body. This restores the state where a blank answer field leaves a neighbour
-- standing and the card is graded against it — the learner's own mistake on 영작 오답노트, the
-- pronunciation on a [뜻 primary, 발음 hint] back.
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
           t.front_layout, t.back_layout, t.quiz_answer_key
    FROM card_templates t
    WHERE t.id IN (SELECT DISTINCT template_id FROM scoped)
  ),
  front AS (
    SELECT s.id AS card_id, array_agg(DISTINCT fl->>'field_key') AS keys
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL jsonb_array_elements(tpl.front_layout) fl
    WHERE tpl.ftype ->> (fl->>'field_key') = 'text'
      AND coalesce(btrim(s.field_values ->> (fl->>'field_key')), '') <> ''
    GROUP BY s.id
  ),
  back AS (
    SELECT s.id AS card_id,
           count(*) AS cand_n,
           count(*) FILTER (WHERE bl->>'style' = 'primary') AS primary_n,
           min(bl->>'field_key') FILTER (WHERE bl->>'style' = 'primary') AS primary_key,
           min(bl->>'field_key') AS only_key,
           -- The stored choice counts only if it is actually a present, non-empty text field on
           -- THIS card. A key left behind by a template edit must not resurrect a dead field.
           min(bl->>'field_key') FILTER (
             WHERE bl->>'field_key' = tpl.quiz_answer_key) AS chosen_key
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
             -- An unambiguous declaration still wins: the author said, and asking a model to
             -- second-guess them would be paying to override the one signal they gave.
             WHEN b.primary_n = 1 THEN b.primary_key
             WHEN b.primary_n = 0 AND b.cand_n = 1 THEN b.only_key
             ELSE b.chosen_key
           END AS answer_key
  ) k
  WHERE k.answer_key IS NOT NULL
    AND NOT (k.answer_key = ANY(f.keys));
$$;
