-- ============================================================================
-- 092: Guarantee default card templates always exist + repair legacy accounts.
--
-- Background: create_default_templates() (AFTER INSERT trigger on profiles)
-- historically failed for accounts created before migration 036, because
-- GoTrue's session search_path excluded 'public' ("relation card_templates
-- does not exist"). The trigger swallows every error (EXCEPTION WHEN OTHERS),
-- so those users silently ended up with ZERO card_templates. With no default
-- template, deck.default_template_id is NULL, the card form has no fields to
-- render, and the user is forced to hand-build a template before adding a card
-- -- the "creating a card is too hard" customer complaint.
--
-- This migration:
--   1. Extracts the default-template seeding into one idempotent helper.
--   2. Re-points the signup trigger at the helper (DRY -- single source of the
--      canonical default templates).
--   3. Exposes ensure_default_templates() as a client-callable RPC so the app
--      (e.g. the quick-create flow) can self-heal on demand.
--   4. Backfills every existing user that is missing default templates.
--
-- The canonical default set kept in sync with packages/shared/lib/
-- default-templates.ts (client-side fallback): 기본 (앞/뒤), 영어 단어, 중국어 단어.
-- ============================================================================

-- 1. Idempotent helper: seed the canonical default templates for one user, but
--    only when that user currently has no default template. search_path
--    includes `extensions` so card_templates' uuid_generate_v4() default
--    resolves on prod (uuid-ossp lives in the extensions schema there).
CREATE OR REPLACE FUNCTION public._seed_default_templates(p_user_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM card_templates
    WHERE user_id = p_user_id AND is_default = true
  ) THEN
    RETURN; -- already has defaults, nothing to do (idempotent)
  END IF;

  -- 기본 (앞/뒤) — the simplest preset: one front, one back.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"}]'::jsonb,
    true
  );

  -- 영어 단어 — Word / Meaning / Pronunciation / Example.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]'::jsonb,
    true
  );

  -- 중국어 단어 — 한자 / 뜻 / 병음 / 예문 / 오디오.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]'::jsonb,
    true
  );
END;
$$;

-- Keep the seeding helper internal; it must not be callable with an arbitrary
-- user_id by clients (SECURITY DEFINER bypasses RLS).
REVOKE EXECUTE ON FUNCTION public._seed_default_templates(uuid) FROM PUBLIC;

-- 2. Re-point the signup trigger function at the helper (DRY). The trigger
--    on_profile_created_templates keeps firing; it now delegates here.
CREATE OR REPLACE FUNCTION public.create_default_templates()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public._seed_default_templates(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_default_templates failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Client-callable RPC: ensure the CURRENT user has default templates. Safe
--    to call on every entry into the quick-create flow (idempotent).
CREATE OR REPLACE FUNCTION public.ensure_default_templates()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM public._seed_default_templates(auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_default_templates() TO authenticated;

-- 4. Backfill: repair every existing user missing default templates. The
--    idempotency guard inside the helper makes this a no-op for healthy
--    accounts, so it is safe to run (and to re-run).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM profiles LOOP
    PERFORM public._seed_default_templates(r.id);
  END LOOP;
END;
$$;
