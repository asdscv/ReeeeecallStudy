-- 160 rollback: safe only before the P5B client cutover.
REVOKE EXECUTE ON FUNCTION public.apply_study_rating(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.undo_study_rating(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.undo_study_rating(uuid);
DROP FUNCTION IF EXISTS public.finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.apply_study_rating(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer);

DROP TRIGGER IF EXISTS bump_progress_srs_revision ON public.user_card_progress;
DROP TRIGGER IF EXISTS bump_cards_srs_revision ON public.cards;
DROP FUNCTION IF EXISTS public.bump_srs_revision();

DROP TABLE IF EXISTS public.study_rating_events;
DROP INDEX IF EXISTS public.study_sessions_client_session_uidx;
DROP INDEX IF EXISTS public.study_logs_rating_event_uidx;

ALTER TABLE public.study_sessions DROP COLUMN IF EXISTS client_session_id;
ALTER TABLE public.study_logs DROP COLUMN IF EXISTS rating_event_id;
ALTER TABLE public.user_card_progress DROP COLUMN IF EXISTS srs_revision;
ALTER TABLE public.cards DROP COLUMN IF EXISTS srs_revision;
