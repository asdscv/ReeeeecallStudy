-- Add onboarding_completed flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Onboarding progress tracking (extensible — add steps without migration)
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,  -- e.g. 'welcome', 'create_deck', 'add_cards', 'first_study', 'explore_market'
  completed_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(user_id, step_key)
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own onboarding" ON onboarding_progress
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_user ON onboarding_progress(user_id);

-- RPC: Complete onboarding step
CREATE OR REPLACE FUNCTION complete_onboarding_step(
  p_step_key TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  INSERT INTO onboarding_progress (user_id, step_key, metadata)
  VALUES (v_uid, p_step_key, p_metadata)
  ON CONFLICT (user_id, step_key) DO NOTHING;

  -- Check if all required steps are done
  IF (
    SELECT COUNT(DISTINCT step_key) >= 5
    FROM onboarding_progress
    WHERE user_id = v_uid
  ) THEN
    UPDATE profiles SET onboarding_completed = true WHERE id = v_uid;
  END IF;

  RETURN json_build_object('step', p_step_key, 'completed', true);
END;
$$;

-- RPC: Skip onboarding entirely
CREATE OR REPLACE FUNCTION skip_onboarding()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET onboarding_completed = true WHERE id = auth.uid();
  RETURN json_build_object('skipped', true);
END;
$$;

-- RPC: Get onboarding status
CREATE OR REPLACE FUNCTION get_onboarding_status()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_completed BOOLEAN;
  v_steps JSON;
BEGIN
  SELECT onboarding_completed INTO v_completed FROM profiles WHERE id = v_uid;

  SELECT COALESCE(json_agg(json_build_object('step_key', step_key, 'completed_at', completed_at)), '[]')
  INTO v_steps
  FROM onboarding_progress WHERE user_id = v_uid;

  RETURN json_build_object('completed', COALESCE(v_completed, false), 'steps', v_steps);
END;
$$;
