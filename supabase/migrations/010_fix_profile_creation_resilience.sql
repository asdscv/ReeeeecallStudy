-- ========================================
-- Fix: 프로필 생성 시 템플릿 실패해도 프로필은 반드시 생성
--
-- 문제: handle_new_user() → profiles INSERT → create_default_templates() 트리거 실패 시
--       profiles INSERT까지 롤백되어 auth.users만 남고 profiles가 없는 고아 유저 발생
-- 해결: 첫 시도 실패 시 템플릿 트리거 비활성화 후 프로필만 재시도
-- ========================================

-- 1. 고아 유저 프로필 복구
INSERT INTO profiles (id)
SELECT au.id FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT DO NOTHING;

-- 2. 트리거 함수 개선
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user profile insert failed: %, retrying without templates...', SQLERRM;
  BEGIN
    ALTER TABLE profiles DISABLE TRIGGER on_profile_created_templates;
    INSERT INTO profiles (id) VALUES (NEW.id);
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'handle_new_user retry also failed: %', SQLERRM;
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
