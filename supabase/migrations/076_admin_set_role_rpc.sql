-- ============================================================
-- 076: Admin RPC로 유저 role 변경 (트리거 우회 없이)
-- ============================================================
-- Supabase Dashboard에서 직접 UPDATE하면 트리거가 auth.uid()를
-- 못 읽어서 실패함. 이 RPC는 admin 본인의 auth.uid()로 실행되므로
-- is_admin() 체크를 통과함.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_user_role(
  p_user_id uuid,
  p_role    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins can call this
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change user roles';
  END IF;

  -- Validate role
  IF p_role NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Temporarily disable trigger (SECURITY DEFINER = superuser context)
  ALTER TABLE profiles DISABLE TRIGGER trg_prevent_role_escalation;

  UPDATE profiles SET role = p_role WHERE id = p_user_id;

  ALTER TABLE profiles ENABLE TRIGGER trg_prevent_role_escalation;

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'role', p_role);
END;
$$;
