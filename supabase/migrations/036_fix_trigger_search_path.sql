-- Fix: GoTrue triggers fail with "relation does not exist" because
-- GoTrue's session search_path does not include 'public'.
-- Adding SET search_path = public to SECURITY DEFINER functions
-- ensures they can find tables regardless of the caller's search_path.
--
-- Root cause: handle_new_user() and create_default_templates() are
-- AFTER INSERT triggers that run within GoTrue's transaction context.
-- GoTrue (supabase_auth_admin) uses a restricted search_path that
-- excludes 'public', causing "relation profiles does not exist".

-- 1. Fix handle_new_user (trigger on auth.users → inserts profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  _display_name TEXT;
BEGIN
  _display_name := NEW.raw_user_meta_data->>'display_name';

  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, _display_name);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user profile insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 2. Fix create_default_templates (trigger on profiles → inserts card_templates)
CREATE OR REPLACE FUNCTION public.create_default_templates()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"}]'::jsonb,
    true
  );
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]'::jsonb,
    true
  );
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]'::jsonb,
    true
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_default_templates failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Fix remaining SECURITY DEFINER functions without search_path
-- These are called via PostgREST (which sets search_path automatically),
-- but adding it explicitly is best practice for safety.

ALTER FUNCTION public.admin_mode_breakdown() SET search_path = public;
ALTER FUNCTION public.copy_deck_for_user(uuid, uuid, boolean, text) SET search_path = public;
ALTER FUNCTION public.get_deck_stats(uuid) SET search_path = public;
ALTER FUNCTION public.get_upload_dates(uuid, text) SET search_path = public;
ALTER FUNCTION public.increment_acquire_count(uuid) SET search_path = public;
ALTER FUNCTION public.init_subscriber_progress(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.resolve_api_key(text) SET search_path = public;
