-- ============================================================================
-- 템플릿에도 한계가 있어야 한다.
--
-- 필드는 카드마다 곱해지고 카드는 프롬프트에 통째로 들어갑니다. 커스텀 HTML 은 무제한이었고,
-- 프로덕션에서는 아직 아무도 쓰지 않습니다(최대 0자) — 쓰기 시작한 뒤에 한도를 두는 것보다
-- 지금 두는 편이 쉽습니다.
--
-- 프로덕션 106개 템플릿: 필드 평균 3.8 · p99 6 · 최대 6. 20 은 그 3배가 넘고, 그쯤이면 이미
-- 못 쓰는 양식입니다. 한도는 사람을 막으려는 게 아니라 바닥이 빠지는 것을 막으려는 것입니다.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id) VALUES ('e1000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_uid uuid := 'e1000000-0000-4000-8000-000000000001';
  v_fields jsonb;
  i int;
BEGIN
  -- ══ 1. 프로덕션 최대(6개)보다 많은 필드도 통과한다 ═══════════════════════
  v_fields := '[]'::jsonb;
  FOR i IN 1..12 LOOP
    v_fields := v_fields || jsonb_build_array(
      jsonb_build_object('key', 'f' || i, 'name', 'F' || i, 'order', i, 'type', 'text'));
  END LOOP;
  INSERT INTO card_templates (user_id, name, fields)
    VALUES (v_uid, '12필드', v_fields);

  -- ══ 2. 스무 개를 넘으면 막힌다 ═══════════════════════════════════════════
  v_fields := '[]'::jsonb;
  FOR i IN 1..21 LOOP
    v_fields := v_fields || jsonb_build_array(
      jsonb_build_object('key', 'f' || i, 'name', 'F' || i, 'order', i, 'type', 'text'));
  END LOOP;
  BEGIN
    INSERT INTO card_templates (user_id, name, fields) VALUES (v_uid, '21필드', v_fields);
    RAISE EXCEPTION 'FAIL: 필드 21개가 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 3. 커스텀 HTML 은 여유롭게, 그러나 무제한은 아니다 ═══════════════════
  --
  -- 진짜 템플릿 하나가 들어갈 크기여야 합니다. 프로덕션은 아직 0자이므로 여기서 막히면
  -- 아무도 쓰기 시작할 수 없습니다.
  INSERT INTO card_templates (user_id, name, fields, front_html)
    VALUES (v_uid, 'html', '[{"key":"f1","name":"F","order":0,"type":"text"}]'::jsonb,
            repeat('<div>x</div>', 1000));
  BEGIN
    INSERT INTO card_templates (user_id, name, fields, front_html)
      VALUES (v_uid, 'html2', '[{"key":"f1","name":"F","order":0,"type":"text"}]'::jsonb,
              repeat('x', 20001));
    RAISE EXCEPTION 'FAIL: 20,001자 HTML 이 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ══ 4. 이름 한도는 256 이 이미 걸었다 ════════════════════════════════════
  BEGIN
    INSERT INTO card_templates (user_id, name, fields)
      VALUES (v_uid, repeat('가', 201), '[{"key":"f1","name":"F","order":0,"type":"text"}]'::jsonb);
    RAISE EXCEPTION 'FAIL: 201자 템플릿 이름이 통과했다';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'template_limits_test: all assertions passed';
END $$;

ROLLBACK;
