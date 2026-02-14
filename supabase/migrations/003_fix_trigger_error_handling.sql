-- ========================================
-- Fix: 트리거 함수에 에러 핸들링 추가
-- 기본 템플릿 생성 실패 시에도 유저 가입이 성공하도록
-- ========================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_default_templates()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"}]',
    true
  );
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]',
    true
  );
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id, '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]',
    true
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'create_default_templates failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- study_logs에 by_date 모드 추가
ALTER TABLE study_logs DROP CONSTRAINT IF EXISTS study_logs_study_mode_check;
ALTER TABLE study_logs ADD CONSTRAINT study_logs_study_mode_check
  CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date'));
