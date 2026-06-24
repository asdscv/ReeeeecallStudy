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
--   1. Extracts the default-template seeding into one idempotent helper that is
--      per-template-name idempotent (repairs partial-state accounts too).
--   2. Re-points the signup trigger at the helper (DRY -- single source of the
--      canonical default templates).
--   3. Exposes ensure_default_templates() as a client-callable RPC so the app
--      (e.g. the quick-create flow) can self-heal on demand.
--   4. Backfills every existing PROFILE that is missing default templates.
--
-- The canonical default set kept in sync with packages/shared/lib/
-- default-templates.ts (client-side display catalog): 기본 (앞/뒤), 영어 단어,
-- 중국어 단어.
-- ============================================================================

-- 1. Idempotent helper: seed each canonical default template for one user, but
--    only when that specific template (by name) is missing. Being per-name
--    idempotent means it also repairs partial-state accounts (e.g. has 기본 but
--    not 영어/중국어) and can never create a duplicate-named preset. search_path
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

  -- 기본 (앞/뒤) — the simplest preset: one front, one back.
  IF NOT EXISTS (SELECT 1 FROM card_templates WHERE user_id = p_user_id AND name = '기본 (앞/뒤)') THEN
    INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
    VALUES (
      p_user_id, '기본 (앞/뒤)',
      '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]'::jsonb,
      '[{"field_key":"field_1","style":"primary"}]'::jsonb,
      '[{"field_key":"field_2","style":"primary"}]'::jsonb,
      true
    );
  END IF;

  -- 영어 단어 — Word / Meaning / Pronunciation / Example.
  IF NOT EXISTS (SELECT 1 FROM card_templates WHERE user_id = p_user_id AND name = '영어 단어') THEN
    INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
    VALUES (
      p_user_id, '영어 단어',
      '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]'::jsonb,
      '[{"field_key":"field_1","style":"primary"}]'::jsonb,
      '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]'::jsonb,
      true
    );
  END IF;

  -- 중국어 단어 — 한자 / 뜻 / 병음 / 예문 / 오디오.
  IF NOT EXISTS (SELECT 1 FROM card_templates WHERE user_id = p_user_id AND name = '중국어 단어') THEN
    INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
    VALUES (
      p_user_id, '중국어 단어',
      '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]'::jsonb,
      '[{"field_key":"field_1","style":"primary"}]'::jsonb,
      '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]'::jsonb,
      true
    );
  END IF;
END;
$$;

-- Keep the seeding helper INTERNAL. It is SECURITY DEFINER and takes an
-- arbitrary p_user_id, so it must not be callable by clients. Supabase's
-- default privileges GRANT EXECUTE on new functions to anon/authenticated
-- DIRECTLY, so a plain `REVOKE ... FROM PUBLIC` is NOT enough -- the role
-- grants must be revoked too, or the function stays reachable via PostgREST
-- /rpc and could seed templates into another user's account.
REVOKE EXECUTE ON FUNCTION public._seed_default_templates(uuid) FROM PUBLIC, anon, authenticated;

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
--    to call on every entry into the quick-create flow (idempotent). Only ever
--    acts on auth.uid(); revoke anon (it would just raise anyway) for hygiene.
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

REVOKE EXECUTE ON FUNCTION public.ensure_default_templates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_templates() TO authenticated;

-- 4. Backfill: repair every existing profile missing default templates. The
--    per-name idempotency guards make this a no-op for healthy accounts, so it
--    is safe to run (and to re-run). Per-iteration exception handling so one bad
--    row cannot abort the whole migration (and its function/grant definitions).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM profiles LOOP
    BEGIN
      PERFORM public._seed_default_templates(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'ensure_default_templates backfill failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
