-- Study reminder preferences on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_hour INTEGER DEFAULT 9;  -- Local hour (0-23)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_days TEXT[] DEFAULT '{mon,tue,wed,thu,fri}';

-- Reminder log (prevent duplicate sends)
CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,  -- 'daily', 'streak_risk', 'comeback'
  sent_at TIMESTAMPTZ DEFAULT now(),
  channel TEXT DEFAULT 'email'
);

ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own reminders" ON reminder_logs FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_user_date ON reminder_logs(user_id, sent_at DESC);

-- RPC: Get users who need reminders
CREATE OR REPLACE FUNCTION get_reminder_targets()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'user_id', p.id,
      'email', u.email,
      'display_name', p.display_name,
      'locale', p.locale,
      'streak', COALESCE(s.current_streak, 0),
      'last_study_date', s.last_study_date,
      'daily_goal', p.daily_study_goal,
      'reminder_type', CASE
        WHEN s.last_study_date = CURRENT_DATE - 1 AND COALESCE(s.current_streak, 0) >= 3 THEN 'streak_risk'
        WHEN s.last_study_date < CURRENT_DATE - 3 THEN 'comeback'
        ELSE 'daily'
      END
    )), '[]')
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN study_streaks s ON s.user_id = p.id
    WHERE p.reminder_enabled = true
      AND p.user_status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM reminder_logs rl
        WHERE rl.user_id = p.id AND rl.sent_at > CURRENT_DATE
      )
      AND (s.last_study_date IS NULL OR s.last_study_date < CURRENT_DATE)
  );
END;
$$;
