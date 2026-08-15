-- 234: know when a provider ships a model, instead of finding out from a 404.
--
-- Twice now a model has moved under us and the app found out the expensive way. `gemini-2.0-flash`
-- and `gemini-2.0-flash-lite` were answered with 404 "no longer available" while still sitting
-- ahead of a working model in the fallback chain (mig 214's note). `gemini-2.5-flash-lite` was
-- quietly cut to twenty requests a day and, as the PRIMARY, took every AI feature in the app with
-- it. And `deepseek-chat` was in the provider table for months after `GET /models` stopped
-- listing it.
--
-- Each of those was discovered by a learner hitting an error. A provider's model list is one HTTP
-- call and it is authoritative, so the app can simply watch it.
--
-- This is the memory: what we have seen, when we first saw it, and whether anyone has looked at
-- it since. `record_ai_models` takes today's list and RETURNS ONLY WHAT IS NEW — the diff is the
-- notification, and computing it here rather than in the caller means a caller that crashes
-- halfway cannot lose a model by half-recording the list.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_known_models (
  provider     text        NOT NULL,
  model        text        NOT NULL,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  -- Set when a human has decided what to do about it. A model we have looked at and rejected is
  -- not the same as one nobody has seen, and only the second kind should raise an alarm.
  acknowledged boolean     NOT NULL DEFAULT false,
  -- Absent from the provider's list on the most recent check. NOT deleted: a model that has
  -- disappeared is exactly what we want a record of, because something may still be pointing at
  -- it — which is how a 404 in the fallback chain went unnoticed.
  retired_at   timestamptz,
  PRIMARY KEY (provider, model)
);

ALTER TABLE public.ai_known_models ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS, and nothing else has any business reading it.

/**
 * Record a provider's current model list. Returns the models that are NEW to us.
 *
 * Also marks anything missing from the list as retired, and un-retires anything that came back —
 * a provider taking a model down for an hour should not leave a permanent tombstone.
 */
-- OUT columns are named `new_*` on purpose: `RETURNS TABLE (model ...)` declares a plpgsql
-- variable called `model`, which then collides with the column of the same name inside the
-- statement — "column reference model is ambiguous", at runtime, not at create time.
CREATE OR REPLACE FUNCTION public.record_ai_models(p_provider text, p_models text[])
  RETURNS TABLE (new_model text, new_first_seen timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_provider IS NULL OR p_models IS NULL OR cardinality(p_models) = 0 THEN
    -- An empty list is a FAILED FETCH, not a provider with no models. Retiring everything on
    -- the strength of a network blip would be the loudest possible false alarm.
    RAISE EXCEPTION 'Refusing to record an empty model list for %', p_provider
      USING errcode = 'invalid_parameter_value';
  END IF;

  CREATE TEMP TABLE _seen ON COMMIT DROP AS
    SELECT DISTINCT unnest(p_models) AS model;

  RETURN QUERY
  WITH upserted AS (
    INSERT INTO ai_known_models (provider, model)
    SELECT p_provider, s.model FROM _seen s
    ON CONFLICT (provider, model) DO UPDATE
      SET last_seen = now(), retired_at = NULL
    RETURNING ai_known_models.model, ai_known_models.first_seen,
              (xmax = 0) AS inserted
  ),
  retired AS (
    UPDATE ai_known_models k SET retired_at = now()
     WHERE k.provider = p_provider AND k.retired_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM _seen s WHERE s.model = k.model)
    RETURNING 1
  )
  SELECT u.model, u.first_seen FROM upserted u WHERE u.inserted
   ORDER BY u.model;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_ai_models(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_models(text, text[]) TO service_role;

/** Everything seen but never looked at, newest first — what a notification should say. */
CREATE OR REPLACE FUNCTION public.unacknowledged_ai_models()
  RETURNS TABLE (provider text, model text, first_seen timestamptz, retired_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT k.provider, k.model, k.first_seen, k.retired_at
    FROM ai_known_models k
   WHERE NOT k.acknowledged AND auth.role() = 'service_role'
   ORDER BY k.first_seen DESC, k.provider, k.model;
$$;
REVOKE EXECUTE ON FUNCTION public.unacknowledged_ai_models() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unacknowledged_ai_models() TO service_role;

COMMIT;

-- ── Seed what we already run on, acknowledged ──────────────────────────────
--
-- Separate transaction so the first watch run reports genuinely new models rather than announcing
-- the entire catalogue as a discovery.
BEGIN;

INSERT INTO ai_known_models (provider, model, acknowledged) VALUES
  ('gemini',   'gemini-3.1-flash-lite',    true),
  ('gemini',   'gemini-flash-lite-latest', true),
  ('gemini',   'gemini-2.5-flash',         true),
  ('gemini',   'gemini-2.5-flash-lite',    true),
  ('deepseek', 'deepseek-v4-flash',        true),
  ('deepseek', 'deepseek-v4-pro',          true)
ON CONFLICT (provider, model) DO UPDATE SET acknowledged = true;

COMMIT;
