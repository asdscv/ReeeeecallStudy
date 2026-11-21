BEGIN;

DO $migration$
DECLARE
  definition text := pg_get_functiondef(
    'public._apply_study_rating_core(uuid,uuid,uuid,uuid,text,text,text,bigint,jsonb,integer)'::regprocedure);
  old_check constant text := $check$(p_study_mode IN ('random','sequential','by_date') AND p_rating <> 'next')$check$;
  new_check constant text := $check$(p_study_mode IN ('random','sequential','by_date') AND p_rating NOT IN ('next','known','unknown'))$check$;
BEGIN
  IF strpos(definition, old_check) > 0 THEN
    RETURN;
  END IF;
  IF strpos(definition, new_check) = 0 THEN
    RAISE EXCEPTION 'Expected self-rating validation is missing';
  END IF;
  EXECUTE replace(definition, new_check, old_check);
END;
$migration$;

COMMIT;
