-- 219: let a template say which back field a quiz grades, so ambiguous decks stop being refused.
--
-- Measured on the reporting account, four of five decks could not make a quiz at all:
--
--     착 붙는 중국어   429/429 quizzable   one primary on the back
--     영어 회화!         0/114             three primaries
--     중국어 발음        0/69              two primaries
--     영작 오답노트      0/29              two primaries (틀린 표현 + 맞는 표현)
--     50일 수학          0/130             no primary at all, three candidates
--
-- 342 of 771 cards, every one refused for a DECLARATION the author made twice — or not at all —
-- rather than for anything missing on the card. `_quiz_eligible_cards` requires exactly one
-- primary back field because a positional rule would have to guess otherwise, and on 영작
-- 오답노트 the first primary is the learner's OWN MISTAKE: guessing by layout order would have
-- graded every answer against the wrong expression. Refusing really was better than that.
--
-- What changes is that the guess is no longer the only alternative. The ambiguity is a property
-- of the TEMPLATE, not of each card — all 29 오답노트 cards offer the same two fields — so it is
-- resolved once, by a model that can read the author's own labels, and stored here.
--
-- The model picks a KEY, never text. `expected` and the correct multiple-choice option are still
-- filled server-side from the card, which is the property `ai-quiz.ts` states as "a model that
-- cannot type the answer cannot mistype it". This does not weaken it: the worst case is the
-- wrong existing field rather than an invented answer, and it is visible in one column.
BEGIN;

ALTER TABLE public.card_templates
  ADD COLUMN IF NOT EXISTS quiz_answer_key text;

COMMENT ON COLUMN public.card_templates.quiz_answer_key IS
  'Which back field a quiz grades, when the layout declares more than one primary (or none). '
  'Chosen once by a model from the author''s own field labels; NULL means the layout is '
  'unambiguous and no choice was needed. Never a value, always a field key.';

-- ── eligibility: honour the stored key ─────────────────────────────────────
--
-- 195's body verbatim apart from the `answer_key` resolution, which now consults the template
-- before giving up. Cards remain refused when there is nothing to ask, nothing to grade, or the
-- answer is already on the front — those are not ambiguity, they are absence.
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

COMMIT;

-- ── the choice itself ──────────────────────────────────────────────────────
--
-- Two halves, deliberately split. `get_quiz_answer_candidates` is a READ the client may make to
-- find out whether a deck needs a choice and what the options are; `set_quiz_answer_key` is
-- service-role only, so the key can only be written by the edge function after a model picked
-- it. A client that could write it could grade itself against a field of its choosing.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_quiz_answer_candidates(p_deck_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;

  -- One row per template in the deck that is BOTH ambiguous and unresolved, with the author's
  -- own labels and up to three real values — a model choosing from labels alone would be
  -- choosing from a guess about what "back" means.
  SELECT jsonb_agg(jsonb_build_object(
           'template_id', x.template_id,
           'template_name', x.template_name,
           'candidates', x.candidates,
           'samples', x.samples))
    INTO v_out
    FROM (
      SELECT t.id AS template_id, t.name AS template_name,
             (SELECT jsonb_agg(jsonb_build_object(
                       'key', bl->>'field_key',
                       'label', COALESCE((SELECT f->>'name' FROM jsonb_array_elements(t.fields) f
                                           WHERE f->>'key' = bl->>'field_key'), bl->>'field_key')))
                FROM jsonb_array_elements(t.back_layout) bl
               WHERE (SELECT f->>'type' FROM jsonb_array_elements(t.fields) f
                       WHERE f->>'key' = bl->>'field_key') = 'text'
                 AND (t.quiz_answer_key IS NULL)
                 AND (bl->>'style' = 'primary'
                      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.back_layout) b2
                                      WHERE b2->>'style' = 'primary'))) AS candidates,
             (SELECT jsonb_agg(c.field_values)
                FROM (SELECT field_values FROM cards
                       WHERE deck_id = p_deck_id AND template_id = t.id
                       ORDER BY sort_position LIMIT 3) c) AS samples
        FROM card_templates t
       WHERE t.id IN (SELECT DISTINCT template_id FROM cards WHERE deck_id = p_deck_id)
         AND t.quiz_answer_key IS NULL
    ) x
   WHERE x.candidates IS NOT NULL AND jsonb_array_length(x.candidates) > 1;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_answer_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_answer_candidates(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_quiz_answer_key(
  p_template_id uuid, p_answer_key text
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  -- The key must be a text field the template actually declares on its BACK. A model returning
  -- a plausible-looking key it invented, or naming a front field, writes nothing.
  SELECT EXISTS (
    SELECT 1 FROM card_templates t
    CROSS JOIN LATERAL jsonb_array_elements(t.back_layout) bl
    WHERE t.id = p_template_id
      AND bl->>'field_key' = p_answer_key
      AND (SELECT f->>'type' FROM jsonb_array_elements(t.fields) f
            WHERE f->>'key' = p_answer_key) = 'text'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.front_layout) fl
                       WHERE fl->>'field_key' = p_answer_key)
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN false; END IF;

  UPDATE card_templates SET quiz_answer_key = p_answer_key, updated_at = now()
   WHERE id = p_template_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_quiz_answer_key(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_quiz_answer_key(uuid, text) TO service_role;

COMMIT;
