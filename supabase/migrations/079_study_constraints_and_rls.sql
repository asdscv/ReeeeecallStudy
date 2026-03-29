-- 079: Study constraints, default batch sizes, and study_logs RLS tightening

-- 1. study_sessions.study_mode CHECK constraint
ALTER TABLE study_sessions ADD CONSTRAINT study_sessions_study_mode_check
CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming'));

-- 2. deck_study_state default batch sizes alignment
ALTER TABLE deck_study_state ALTER COLUMN new_batch_size SET DEFAULT 20;
ALTER TABLE deck_study_state ALTER COLUMN review_batch_size SET DEFAULT 50;

-- 3. study_logs RLS: tighten to append-only (no UPDATE/DELETE)
DROP POLICY IF EXISTS "Users can CRUD own logs" ON study_logs;
CREATE POLICY "Users can insert own logs" ON study_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own logs" ON study_logs FOR SELECT USING (auth.uid() = user_id);
