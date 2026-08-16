-- Rollback 227: a quiz set can no longer be loaded on its own.
--
-- Drops `get_quiz_set`. The detail screen has nothing to read from a URL, so a set is reachable
-- only through whatever the list happened to fetch.
DROP FUNCTION IF EXISTS public.get_quiz_set(uuid);
