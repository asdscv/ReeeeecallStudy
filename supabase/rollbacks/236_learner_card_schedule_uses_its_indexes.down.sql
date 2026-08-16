-- Down for 236: put the CASE-in-the-WHERE version back, exactly as it was.
--
-- Slower (7.8s for a 22-card goal on production), but identical in what it returns — which is the
-- point of a rollback.
BEGIN;

CREATE OR REPLACE FUNCTION public.learner_card_schedule(p_user_id uuid, p_deck_ids uuid[])
  RETURNS TABLE (card_id uuid, deck_id uuid, srs_status text, interval_days integer,
                 ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz)
  LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT
    c.id,
    c.deck_id,
    CASE WHEN d.user_id = p_user_id THEN c.srs_status       ELSE ucp.srs_status       END,
    CASE WHEN d.user_id = p_user_id THEN c.interval_days    ELSE ucp.interval_days    END,
    CASE WHEN d.user_id = p_user_id THEN c.ease_factor      ELSE ucp.ease_factor      END,
    CASE WHEN d.user_id = p_user_id THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END,
    CASE WHEN d.user_id = p_user_id THEN c.next_review_at   ELSE ucp.next_review_at   END
  FROM decks d
  JOIN cards c ON c.deck_id = d.id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE
    CASE
      WHEN p_deck_ids IS NOT NULL THEN d.id = ANY(p_deck_ids)
      ELSE d.user_id = p_user_id
        OR EXISTS (SELECT 1 FROM user_card_progress p WHERE p.deck_id = d.id AND p.user_id = p_user_id)
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.learner_card_schedule(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
