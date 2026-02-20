-- ========================================
-- 031: 회원가입 시 display_name을 profiles에 저장
--
-- signUp({ data: { display_name } })으로 전달된 닉네임을
-- auth.users.raw_user_meta_data에서 읽어 profiles.display_name에 저장
-- ========================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _display_name TEXT;
BEGIN
  _display_name := NEW.raw_user_meta_data->>'display_name';

  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, _display_name);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user profile insert failed: %, retrying without templates...', SQLERRM;
  BEGIN
    ALTER TABLE profiles DISABLE TRIGGER on_profile_created_templates;
    INSERT INTO profiles (id, display_name)
    VALUES (NEW.id, _display_name);
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'handle_new_user retry also failed: %', SQLERRM;
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
