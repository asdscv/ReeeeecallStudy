-- 236: 7.8 seconds to answer a question about 22 cards.
--
-- 235 moved the two analytics charts off `learner_card_schedule` because it was slow. That fixed
-- the charts and left the function, and the function is under more than the charts. Measured on
-- production, the reporting account, a goal with 22 cards:
--
--     get_goal_knowledge(goal, now, 1.0)   →   7.8s
--
-- That runs on the dashboard and the learning screens, every load. It is also why the browser
-- console showed `[learning-store] get_goal_knowledge failed: TypeError: Failed to fetch` — a
-- request that slow is still in flight when the page navigates away, and with any load at all it
-- meets the statement timeout instead.
--
-- ── Two causes, and the second one hid the first ────────────────────────────
--
-- 1. THE `CASE` IN THE WHERE CLAUSE.
--
--        WHERE CASE WHEN p_deck_ids IS NOT NULL THEN d.id = ANY(p_deck_ids)
--                   ELSE d.user_id = p_user_id OR EXISTS (...) END
--
--    A CASE is one opaque boolean to the planner: neither branch can be pushed down to an index,
--    so it reads every deck and every card and evaluates the CASE per row. 20,743 buffers — 162MB
--    — to return 22 rows.
--
-- 2. IT WAS NEVER GOING TO BE PLANNED WELL, whatever the WHERE said.
--
--    A SQL function is INLINED into its caller only if it has a single SELECT body, is not
--    SECURITY DEFINER, HAS NO `SET` CLAUSE, and HAS NO CTE. This had a SET; rewriting it with a
--    `WITH my_decks` — the shape 235 used, which is fast when pasted into the caller by hand —
--    hit the CTE rule instead. Measured, each step:
--
--        original                                  5,988 ms   20,743 buffers
--        rewritten with a CTE, SET removed         5,734 ms   20,743 buffers
--        same body pasted into the caller by hand      4.4 ms      32 buffers
--
--    Not inlined means one generic plan for both call shapes, with the array argument unknown.
--    The planner cannot see that the outer side is 22 rows, so it hash-joins the whole of
--    `user_card_progress` instead of probing it on (user_id, card_id).
--
-- ── The fix: one shape per branch ───────────────────────────────────────────
--
-- plpgsql, and the two cases are two separate statements. Each has a fixed, directly indexable
-- predicate — `d.id = ANY($1)` on the primary key, or a deck set from two indexed lookups — so a
-- generic plan is a good plan for both, and neither can be spoiled by the other's estimates.
--
--     get_goal_knowledge   7.8s  →  0.21s     (same numbers: 22/16/6/6)
--     my_card_schedule     2.6s  →  0.23s
--     my_retention_curve   1.0s  →  0.20s
--
-- Same membership rule, same columns, same row shape. `ease_factor` is cast because the column is
-- `real` and the signature says `numeric`: the SQL body coerced that silently, and plpgsql —
-- correctly — refuses to.
BEGIN;

CREATE OR REPLACE FUNCTION public.learner_card_schedule(p_user_id uuid, p_deck_ids uuid[])
  RETURNS TABLE (card_id uuid, deck_id uuid, srs_status text, interval_days integer,
                 ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz)
  LANGUAGE plpgsql STABLE SET search_path = public
AS $$
BEGIN
  IF p_deck_ids IS NOT NULL THEN
    -- An explicit deck list is used AS GIVEN, with no ownership filter — exactly as before. Every
    -- caller that passes one is a SECURITY DEFINER wrapper that has already decided what this
    -- learner may see, and a second opinion here would change results, not just plans.
    RETURN QUERY
    SELECT c.id, c.deck_id,
      CASE WHEN d.user_id = p_user_id THEN c.srs_status       ELSE ucp.srs_status       END,
      CASE WHEN d.user_id = p_user_id THEN c.interval_days    ELSE ucp.interval_days    END,
      (CASE WHEN d.user_id = p_user_id THEN c.ease_factor     ELSE ucp.ease_factor      END)::numeric,
      CASE WHEN d.user_id = p_user_id THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END,
      CASE WHEN d.user_id = p_user_id THEN c.next_review_at   ELSE ucp.next_review_at   END
      FROM public.decks d
      JOIN public.cards c ON c.deck_id = d.id
      LEFT JOIN public.user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
     WHERE d.id = ANY(p_deck_ids);
  ELSE
    RETURN QUERY
    SELECT c.id, c.deck_id,
      CASE WHEN d.user_id = p_user_id THEN c.srs_status       ELSE ucp.srs_status       END,
      CASE WHEN d.user_id = p_user_id THEN c.interval_days    ELSE ucp.interval_days    END,
      (CASE WHEN d.user_id = p_user_id THEN c.ease_factor     ELSE ucp.ease_factor      END)::numeric,
      CASE WHEN d.user_id = p_user_id THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END,
      CASE WHEN d.user_id = p_user_id THEN c.next_review_at   ELSE ucp.next_review_at   END
      FROM public.decks d
      JOIN public.cards c ON c.deck_id = d.id
      LEFT JOIN public.user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
      -- Deck-level membership, not card-level: touching four cards of a deck puts the whole deck
      -- in your library, and the rest are unseen rather than nonexistent. Same rule the EXISTS in
      -- the old ELSE branch expressed, as two indexed lookups instead of a correlated subquery.
     WHERE d.id IN (
       SELECT dd.id      FROM public.decks dd              WHERE dd.user_id = p_user_id
       UNION
       SELECT pp.deck_id FROM public.user_card_progress pp WHERE pp.user_id = p_user_id
     );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.learner_card_schedule(uuid, uuid[]) IS
  'One row per card in the learner''s library, with whichever side''s SRS state applies. '
  'Branches per call shape on purpose: the previous single query wrapped both shapes in a CASE '
  'the planner could not index, and took 7.8s to answer a question about 22 cards.';

-- Unchanged: NOT granted to `authenticated`. It takes a user id as an argument, so any learner
-- able to call it could ask about any other. `my_card_schedule` (mig 232) is the DEFINER wrapper
-- that derives the id from auth.uid() and is the thing clients call.
REVOKE EXECUTE ON FUNCTION public.learner_card_schedule(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMIT;
