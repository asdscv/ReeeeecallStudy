-- 227: one set, on its own, so a quiz can have a page instead of an expanding row.
--
-- 225 put the history behind a toggle on the list row. That was the wrong shape for it: a set is
-- a thing a learner returns to — it cost money, it has a history, and it is the unit they retake —
-- and the list row is a place to choose one, not to read one. Expanding it in place also means the
-- history is unreachable by link, so nothing can point at a quiz.
--
-- So the set gets a screen, and a screen needs to load from a URL rather than from whatever the
-- list happened to have fetched. Same row shape as one element of `list_quiz_sets`, so the two
-- surfaces cannot disagree about what a set is.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_quiz_set(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'deck_id', s.deck_id, 'title', s.title,
    'question_type', s.question_type, 'requested_count', s.requested_count,
    'generated_count', s.generated_count, 'status', s.status,
    'content_locale', s.content_locale, 'created_at', s.created_at,
    'deck_name', d.name,
    'run_count', (SELECT count(*) FROM quiz_runs r WHERE r.set_id = s.id),
    'last_taken_at', (SELECT max(COALESCE(r.completed_at, r.started_at))
                        FROM quiz_runs r WHERE r.set_id = s.id),
    'last_tally', (SELECT public._quiz_run_tally(r.id)
                     FROM quiz_runs r WHERE r.set_id = s.id
                    ORDER BY r.attempt_no DESC LIMIT 1))
    INTO v_out
    FROM quiz_sets s
    LEFT JOIN decks d ON d.id = s.deck_id
   WHERE s.id = p_set_id AND s.owner_user_id = v_uid;

  -- Null rather than an exception. A set can be deleted from another tab, or the link can be
  -- stale, and a screen showing "이 퀴즈는 없어요" is a better answer than an error boundary.
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_set(uuid) TO authenticated;

COMMIT;
