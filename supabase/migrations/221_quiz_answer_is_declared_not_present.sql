-- 221: an empty answer field was promoting whatever was left beside it.
--
-- `_quiz_eligible_cards` decided which back field a quiz grades by aggregating the fields that
-- are PRESENT and non-empty on each card. On a card that fills every field that is the same as
-- reading the layout. On a card that does not, it silently answers a different question:
--
--   back [틀린 표현 primary, 맞는 표현 primary], 맞는 표현 blank
--       -> one primary is left standing, so the card looks unambiguous
--       -> every learner is graded against their OWN MISTAKE
--
--   back [뜻 primary, 발음 hint], 뜻 blank
--       -> the lone-candidate rule fires on a template that declares two
--       -> the learner is graded against a pronunciation
--
-- Both are the failure `_quiz_eligible_cards` was written to refuse, arriving through the door
-- it left open. The lone-candidate rule is sound — one text field on the back IS the answer by
-- elimination — but it is a statement about the TEMPLATE, and it was being applied to a card.
--
-- So the declaration is read from the layout first, and only then checked for a value here. A card
-- missing the intended answer is refused, which is the honest outcome: there is nothing to grade.
--
-- Narrowing by presence is KEPT, as the last rule, on templates nothing else can decide. Dropping
-- it outright cost 착 붙는 중국어 all 429 of its cards — measured, not guessed: its back declares
-- two primaries and the second is empty on every card, an unused field rather than an ambiguity,
-- and it was the one deck on the reporting account that could already make a quiz. The four rules
-- in order are the author's single mark, elimination, the stored choice, and only then presence.
-- `packages/shared/lib/quiz-answer-field.ts` and its edge-runtime copy make the identical change,
-- and they have to — 219 taught this function about `quiz_answer_key` while the resolver the edge
-- function actually generates from knew nothing about it, so eligible cards were counted and then
-- refused one call later with QUIZ_NOT_ENOUGH_CARDS.
--
-- Same three refusals as before, unchanged: nothing to ask, nothing to grade, answer on the front.
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
           t.front_layout, t.back_layout, t.quiz_answer_key
    FROM card_templates t
    WHERE t.id IN (SELECT DISTINCT template_id FROM scoped)
  ),
  -- What the template declares on its back, once per field key, regardless of any card. A key
  -- repeated in the layout keeps its FIRST style, which is the rule the TS resolver applies.
  declared AS (
    SELECT tpl.id AS template_id,
           count(*)                                        AS declared_n,
           count(*) FILTER (WHERE d.style = 'primary')      AS primary_n,
           min(d.key) FILTER (WHERE d.style = 'primary')    AS primary_key,
           min(d.key)                                       AS only_key
    FROM tpl
    CROSS JOIN LATERAL (
      SELECT DISTINCT ON (bl.item->>'field_key')
             bl.item->>'field_key' AS key, bl.item->>'style' AS style
      FROM jsonb_array_elements(tpl.back_layout) WITH ORDINALITY AS bl(item, ord)
      WHERE tpl.ftype ->> (bl.item->>'field_key') = 'text'
      ORDER BY bl.item->>'field_key', bl.ord
    ) d
    GROUP BY tpl.id
  ),
  -- What THIS card has: present, non-empty, text, on the back. Deduplicated on the same rule as
  -- `declared`, so a key repeated in the layout is one field here too.
  have AS (
    SELECT s.id AS card_id,
           count(*)                                          AS have_n,
           count(*) FILTER (WHERE d.style = 'primary')        AS have_primary_n,
           min(d.key) FILTER (WHERE d.style = 'primary')      AS have_primary_key,
           min(d.key)                                         AS have_only_key
    FROM scoped s JOIN tpl ON tpl.id = s.template_id
    CROSS JOIN LATERAL (
      SELECT DISTINCT ON (bl.item->>'field_key')
             bl.item->>'field_key' AS key, bl.item->>'style' AS style
      FROM jsonb_array_elements(tpl.back_layout) WITH ORDINALITY AS bl(item, ord)
      WHERE tpl.ftype ->> (bl.item->>'field_key') = 'text'
        AND coalesce(btrim(s.field_values ->> (bl.item->>'field_key')), '') <> ''
      ORDER BY bl.item->>'field_key', bl.ord
    ) d
    GROUP BY s.id
  )
  SELECT s.id, k.answer_key, btrim(s.field_values ->> k.answer_key)
  FROM scoped s
  JOIN tpl      t ON t.id = s.template_id
  JOIN declared d ON d.template_id = s.template_id
  JOIN have     h ON h.card_id = s.id
  CROSS JOIN LATERAL (
    SELECT CASE
             -- 1. The author's single mark. It outranks the stored choice: preferring a model's
             --    reading of their labels over their declaration would overrule the one signal
             --    they gave. Blank here means the answer is missing, not that a neighbour is
             --    now the answer — the `have` check below turns it into a refusal.
             WHEN d.primary_n = 1 THEN d.primary_key
             -- 2. One text field on the back: the answer by elimination, and again a statement
             --    about the TEMPLATE.
             WHEN d.primary_n = 0 AND d.declared_n = 1 THEN d.only_key
             -- 3. 219's stored key, written once by a model that read the author's own labels
             --    for a back it could not otherwise disambiguate. Terminal, like 1.
             WHEN t.quiz_answer_key IS NOT NULL THEN t.quiz_answer_key
             -- 4. Still ambiguous and never resolved: narrow by what this card HAS. All that is
             --    left, and how 착 붙는 중국어 works today.
             WHEN h.have_primary_n = 1 THEN h.have_primary_key
             WHEN h.have_primary_n = 0 AND h.have_n = 1 THEN h.have_only_key
             ELSE NULL
           END AS answer_key
  ) k
  WHERE k.answer_key IS NOT NULL
    -- something to ask
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.front_layout) fl
                 WHERE t.ftype ->> (fl->>'field_key') = 'text'
                   AND coalesce(btrim(s.field_values ->> (fl->>'field_key')), '') <> '')
    -- the answer is not already on show, anywhere on the front
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.front_layout) fl
                     WHERE fl->>'field_key' = k.answer_key)
    -- and this card actually has one
    AND coalesce(btrim(s.field_values ->> k.answer_key), '') <> '';
$$;

COMMIT;
