-- ============================================================================
-- 153: Operational safety layer — runtime kill switches + real ban enforcement +
--      marketplace takedown. (Pack A of the ops-readiness audit.)
--
-- Adds levers a founder needs DURING an incident, none of which existed:
--   * system_flags   — runtime switches read at app boot + by the money/AI edge fns:
--       maintenance_mode        → app shows "down", edge fns 503
--       ai_generation_enabled   → instantly halt AI generation (cost blowout / key leak)
--       payments_enabled        → instantly halt checkout server-side (no redeploy)
--     Defaults preserve CURRENT behavior (all enabled, not in maintenance) so shipping
--     this changes nothing until an admin toggles it.
--   * is_user_banned() — the admin user_status ('banned'/'suspended', mig 062) had NO
--     teeth (nothing read it). This is the shared predicate the edge fns + register_session
--     now enforce, so a banned user actually loses the money/AI paths and can't hold a session.
--   * admin_set_listing_active() — take down an abusive marketplace listing from the admin
--     UI (was raw SQL only).
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

-- ── 1) system_flags — single-row runtime ops switches ───────────────────────
CREATE TABLE IF NOT EXISTS public.system_flags (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  maintenance_mode       boolean NOT NULL DEFAULT false,
  maintenance_message    text,
  ai_generation_enabled  boolean NOT NULL DEFAULT true,
  payments_enabled       boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.system_flags (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;
-- Non-secret (the app reads them on every boot) but writes are admin-only: expose reads via
-- the SECURITY DEFINER RPC below, deny direct client table access.
REVOKE ALL ON public.system_flags FROM anon, authenticated;
GRANT  ALL ON public.system_flags TO service_role;

-- get_system_flags(): public read — web/app boot + edge fns read maintenance/enabled.
CREATE OR REPLACE FUNCTION public.get_system_flags()
  RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT row_to_json(f) FROM (
    SELECT maintenance_mode, maintenance_message, ai_generation_enabled, payments_enabled
    FROM public.system_flags WHERE id = 1
  ) f;
$$;
REVOKE EXECUTE ON FUNCTION public.get_system_flags() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_system_flags() TO anon, authenticated, service_role;

-- admin_set_system_flags(): admin toggle. NULL keeps the current value (COALESCE).
CREATE OR REPLACE FUNCTION public.admin_set_system_flags(
    p_maintenance_mode      boolean DEFAULT NULL,
    p_maintenance_message   text    DEFAULT NULL,
    p_ai_generation_enabled boolean DEFAULT NULL,
    p_payments_enabled      boolean DEFAULT NULL)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.system_flags;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  UPDATE public.system_flags SET
    maintenance_mode      = COALESCE(p_maintenance_mode, maintenance_mode),
    maintenance_message   = COALESCE(p_maintenance_message, maintenance_message),
    ai_generation_enabled = COALESCE(p_ai_generation_enabled, ai_generation_enabled),
    payments_enabled      = COALESCE(p_payments_enabled, payments_enabled),
    updated_at            = now()
  WHERE id = 1
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_system_flags(boolean,text,boolean,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_system_flags(boolean,text,boolean,boolean) TO authenticated, service_role;  -- is_admin() gate in-fn

-- ── 2) is_user_banned — the shared enforcement predicate ────────────────────
-- profiles.user_status ('active'|'suspended'|'banned', mig 062). Both suspended & banned
-- lose access. SECURITY DEFINER so edge fns (service_role) and the user's own session
-- registration can read it without exposing the whole profiles row.
CREATE OR REPLACE FUNCTION public.is_user_banned(p_uid uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_uid AND user_status IN ('banned', 'suspended')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_user_banned(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_user_banned(uuid) TO authenticated, service_role;

-- ── 3) register_session — LOCK OUT banned users at session registration ─────
-- Re-defines the mig-093 3-arg fn verbatim + a ban gate at the top. Keeps the exact
-- signature the clients call. A banned/suspended user gets allowed:false → the client
-- session guard blocks them (same path as the per-platform eviction), so a ban now
-- actually denies access instead of being a cosmetic status.
CREATE OR REPLACE FUNCTION public.register_session(
  p_device_id   text,
  p_device_name text DEFAULT NULL,
  p_platform    text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  -- Ban enforcement (mig 153): a banned/suspended account cannot hold a session.
  IF public.is_user_banned(v_user_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'banned');
  END IF;

  INSERT INTO user_sessions (user_id, device_id, device_name, platform, last_seen_at)
  VALUES (v_user_id, p_device_id, p_device_name, p_platform, now())
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    last_seen_at = now(),
    device_name  = COALESCE(EXCLUDED.device_name, user_sessions.device_name),
    platform     = EXCLUDED.platform;

  IF p_platform IN ('app', 'web') THEN
    DELETE FROM user_sessions
    WHERE user_id = v_user_id
      AND platform = p_platform
      AND device_id <> p_device_id;
  END IF;

  DELETE FROM user_sessions
  WHERE user_id = v_user_id
    AND last_seen_at < now() - interval '30 days';

  RETURN jsonb_build_object('allowed', true, 'platform', p_platform);
END;
$$;

-- ── 4) admin_set_listing_active — marketplace takedown from the admin UI ────
CREATE OR REPLACE FUNCTION public.admin_set_listing_active(p_listing_id uuid, p_active boolean)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_admin()) THEN
    RAISE EXCEPTION 'Admin only' USING errcode = '42501';
  END IF;
  UPDATE public.marketplace_listings SET is_active = p_active WHERE id = p_listing_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_listing_active(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_listing_active(uuid, boolean) TO authenticated, service_role;  -- is_admin() gate in-fn
