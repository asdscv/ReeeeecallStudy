-- ============================================================
-- 100: Apple 로그인 이메일 미제공 시 "Database error saving new user" 수정
-- ============================================================
-- 원인 1: handle_new_user_subscription()에 SET search_path = public 누락
--   → GoTrue 트랜잭션에서 'subscriptions' 테이블 못 찾아 에러
--   → 036에서 handle_new_user만 수정하고 이건 누락
--
-- 원인 2: handle_new_user()에서 Apple 사용자의 display_name 처리 개선
--   → Apple은 full_name을 raw_user_meta_data가 아닌 다른 위치에 넣을 수 있음
--   → full_name, name, display_name 모두 확인
-- ============================================================

-- 1. handle_new_user_subscription에 search_path 추가
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO subscriptions (user_id, tier, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 절대 유저 생성을 막지 않음 — subscription은 나중에 복구 가능
  RAISE LOG 'handle_new_user_subscription failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 2. handle_new_user 개선 — Apple 사용자의 이름 추출 로직 강화
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _display_name TEXT;
BEGIN
  -- Apple은 full_name/name을 다양한 위치에 넣을 수 있음
  -- raw_user_meta_data에서 display_name, full_name, name 순으로 확인
  _display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    -- Apple identity token에서 이름이 올 수 있는 위치
    NULLIF(TRIM(CONCAT_WS(' ',
      NEW.raw_user_meta_data->>'given_name',
      NEW.raw_user_meta_data->>'family_name'
    )), '')
  );

  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, _display_name);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user profile insert failed for user %: %', NEW.id, SQLERRM;
  -- 재시도: 템플릿 트리거 없이 프로필만 생성
  BEGIN
    ALTER TABLE profiles DISABLE TRIGGER on_profile_created_templates;
    INSERT INTO profiles (id, display_name)
    VALUES (NEW.id, _display_name)
    ON CONFLICT (id) DO NOTHING;
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'handle_new_user retry also failed for user %: %', NEW.id, SQLERRM;
    ALTER TABLE profiles ENABLE TRIGGER on_profile_created_templates;
  END;
  RETURN NEW;
END;
$$;
