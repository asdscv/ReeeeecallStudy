-- 235: the analytics page asked for every card it could see, twice, and got a statement timeout.
--
-- 232 gave the retention curve a callable RPC and the chart stayed empty. The reason was not
-- permission any more, it was size: `my_card_schedule` returns one row per card across the
-- learner's whole library, the page called it TWICE concurrently — once for the retention curve
-- and once for progress over time — and PostgREST cancelled both:
--
--     [analytics] retention curve: canceling statement due to statement timeout
--     [analytics] progress over time: canceling statement due to statement timeout
--
-- Which the page swallowed into an empty chart, the same way the permission error had.
--
-- Sending thousands of rows to a browser so it can produce six numbers is the actual defect. Both
-- charts are aggregates, so both are computed here: one indexed pass, six rows and a few dozen
-- rows on the wire instead of a library.
BEGIN;

/**
 * Cards still in review, bucketed by how long their interval has grown.
 *
 * "Retention" here is the share of each bucket that is still in `review` rather than lapsed —
 * the same arithmetic the page did, moved to where the rows are.
 *
 * Every bucket is returned even when empty, because a gap in the middle of a curve is
 * information and a chart with missing categories silently rescales its axis.
 */
CREATE OR REPLACE FUNCTION public.my_retention_curve()
  RETURNS TABLE (interval_label text, retention integer, cards integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH buckets(idx, label, lo, hi) AS (
    VALUES (1, '1d', 0, 1), (2, '3d', 2, 3), (3, '7d', 4, 7),
           (4, '14d', 8, 14), (5, '30d', 15, 30), (6, '60d+', 31, 2147483647)
  ),
  -- THE DECK SET FIRST, from two indexed lookups.
  --
  -- Not `learner_card_schedule`: its WHERE is a `CASE WHEN p_deck_ids IS NOT NULL THEN … ELSE …`
  -- and the planner cannot push an index through that, so it scans decks x cards — 7.6s for an
  -- account with 28 cards, against a table of 376,000, which PostgREST then cancelled outright.
  -- Rewriting it as `d.user_id = … OR EXISTS (…)` was barely better, because the OR still visits
  -- every deck.
  --
  -- Both branches here hit an index on `user_id`, and the card join is then `deck_id IN (a
  -- handful)`. Same membership rule — your own decks, plus any deck you have touched a card in,
  -- because touching four cards puts the whole deck in your library.
  my_decks AS (
    SELECT id FROM decks WHERE user_id = auth.uid()
    UNION
    SELECT deck_id FROM user_card_progress WHERE user_id = auth.uid()
  ),
  mine AS (
    SELECT CASE WHEN d.user_id = auth.uid() THEN c.srs_status       ELSE ucp.srs_status       END AS srs_status,
           CASE WHEN d.user_id = auth.uid() THEN c.interval_days    ELSE ucp.interval_days    END AS interval_days,
           CASE WHEN d.user_id = auth.uid() THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END AS last_reviewed_at
      FROM my_decks md
      JOIN decks d ON d.id = md.id
      JOIN cards c ON c.deck_id = md.id
      LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = auth.uid()
     WHERE auth.uid() IS NOT NULL
  )
  SELECT b.label,
         COALESCE(round(100.0 * count(*) FILTER (WHERE m.srs_status = 'review')
                        / NULLIF(count(m.interval_days), 0))::integer, 0),
         count(m.interval_days)::integer
    FROM buckets b
    LEFT JOIN mine m ON m.interval_days BETWEEN b.lo AND b.hi
                    AND m.last_reviewed_at IS NOT NULL
   GROUP BY b.idx, b.label
   ORDER BY b.idx;
$$;
REVOKE EXECUTE ON FUNCTION public.my_retention_curve() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_retention_curve() TO authenticated;

/**
 * How many cards had reached `review` by the end of each week, cumulatively.
 *
 * The page built this by pulling every reviewed card and bucketing in JavaScript. The running
 * total is what the chart draws, so it is what this returns.
 */
CREATE OR REPLACE FUNCTION public.my_review_progress(p_weeks integer DEFAULT 26)
  RETURNS TABLE (week date, total integer)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
  -- THE DECK SET FIRST, from two indexed lookups.
  --
  -- Not `learner_card_schedule`: its WHERE is a `CASE WHEN p_deck_ids IS NOT NULL THEN … ELSE …`
  -- and the planner cannot push an index through that, so it scans decks x cards — 7.6s for an
  -- account with 28 cards, against a table of 376,000, which PostgREST then cancelled outright.
  -- Rewriting it as `d.user_id = … OR EXISTS (…)` was barely better, because the OR still visits
  -- every deck.
  --
  -- Both branches here hit an index on `user_id`, and the card join is then `deck_id IN (a
  -- handful)`. Same membership rule — your own decks, plus any deck you have touched a card in,
  -- because touching four cards puts the whole deck in your library.
  my_decks AS (
    SELECT id FROM decks WHERE user_id = auth.uid()
    UNION
    SELECT deck_id FROM user_card_progress WHERE user_id = auth.uid()
  ),
  mine AS (
    SELECT CASE WHEN d.user_id = auth.uid() THEN c.srs_status       ELSE ucp.srs_status       END AS srs_status,
           CASE WHEN d.user_id = auth.uid() THEN c.interval_days    ELSE ucp.interval_days    END AS interval_days,
           CASE WHEN d.user_id = auth.uid() THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END AS last_reviewed_at
      FROM my_decks md
      JOIN decks d ON d.id = md.id
      JOIN cards c ON c.deck_id = md.id
      LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = auth.uid()
     WHERE auth.uid() IS NOT NULL
  ),
  per_week AS (
    SELECT date_trunc('week', m.last_reviewed_at)::date AS wk, count(*)::integer AS n
      FROM mine m
     WHERE m.srs_status = 'review' AND m.last_reviewed_at IS NOT NULL
     GROUP BY 1
  )
  SELECT p.wk,
         sum(p.n) OVER (ORDER BY p.wk ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer
    FROM per_week p
   ORDER BY p.wk
   -- Bounded so a five-year account does not send back 260 points nobody can read. The tail is
   -- the interesting end, so the LIMIT is applied to the most recent weeks by the caller's
   -- slice rather than truncating the running total's start.
   OFFSET GREATEST(0, (SELECT count(*) FROM per_week) - LEAST(GREATEST(p_weeks, 1), 260));
$$;
REVOKE EXECUTE ON FUNCTION public.my_review_progress(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_review_progress(integer) TO authenticated;

COMMIT;
