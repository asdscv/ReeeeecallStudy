-- 238: 429장짜리 덱인데 오답 보기는 늘 같은 40개에서 나왔습니다.
--
-- 220이 되살린 필러 풀은 이렇게 생겼습니다:
--
--     SELECT array_agg(a ORDER BY random())
--       FROM (SELECT DISTINCT answer_text AS a FROM _quiz_eligible_cards(...) LIMIT 40) f;
--
-- 안쪽 서브쿼리에 ORDER BY가 없습니다. `LIMIT 40`은 스캔이 먼저 뱉는 40개를 가져가고,
-- `ORDER BY random()`은 **이미 뽑힌 그 40개를 섞을 뿐**입니다. 순서를 섞는 것과 표본을
-- 뽑는 것은 다른 일인데, 한 줄 안에 나란히 있어서 뽑기까지 랜덤인 것처럼 읽힙니다.
--
-- 프로덕션에서 확인했습니다. 착 붙는 중국어(429장)의 풀을 두 번 만들어보면:
--
--     run 1:  在, 飞机, 下去, 讨厌, 号码, 护手霜, 去年, 羡慕, 朋友, 名字, …
--     run 2:  在, 飞机, 下去, 讨厌, 号码, 护手霜, 去年, 羡慕, 朋友, 名字, …
--     동일: true
--
-- 즉 429개의 정답 중 **40개만** 오답 보기가 될 수 있고, 매번 같은 40개입니다. 그 덱으로
-- 퀴즈를 여러 번 푼 학습자는 같은 오답을 반복해서 만나고, 반복해서 만난 보기는 내용을
-- 몰라도 눈에 익어서 지워집니다 — 문제를 쉽게 만드는 게 아니라, 다른 걸 시험하게 만듭니다.
--
-- 뽑기를 랜덤으로 옮깁니다. `SELECT DISTINCT ... ORDER BY random()`은 "DISTINCT일 때 ORDER BY
-- 식은 select 목록에 있어야 한다"로 거부되므로, distinct를 먼저 끝내고 그 결과를 섞습니다.
-- 40이라는 상한은 그대로입니다(프롬프트에 실려 나가는 문자열이라 무한정 늘릴 수 없습니다).
--
-- 220의 본문에서 이 SELECT 하나만 다릅니다.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_quiz_set(p_deck_id uuid, p_title text, p_question_type text, p_count integer, p_content_locale text, p_scope_kind text DEFAULT 'deck'::text, p_tags text[] DEFAULT '{}'::text[], p_card_ids uuid[] DEFAULT '{}'::uuid[], p_difficulty smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_set   uuid;
  v_cards jsonb;
  v_fillers text[];
  v_n     integer;
  v_band  quiz_difficulty_levels%ROWTYPE;
  v_guide text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT public._check_deck_access(v_uid, p_deck_id) THEN
    RAISE EXCEPTION 'Deck not accessible' USING errcode = '42501';
  END IF;
  IF p_question_type NOT IN ('mcq', 'short', 'essay') THEN
    RAISE EXCEPTION 'Unknown question type' USING errcode = 'invalid_parameter_value';
  END IF;
  -- 207: was 12. The client now generates in batches, so the length of a quiz is no longer
  -- the length of one model call.
  IF p_count IS NULL OR p_count < 1 OR p_count > 50 THEN
    RAISE EXCEPTION 'Question count out of range' USING errcode = 'P0009';
  END IF;

  IF p_difficulty IS NULL THEN
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_default AND is_active;
    IF NOT FOUND THEN
      SELECT * INTO v_band FROM quiz_difficulty_levels WHERE is_active ORDER BY sort_order LIMIT 1;
    END IF;
  ELSE
    SELECT * INTO v_band FROM quiz_difficulty_levels WHERE level = p_difficulty AND is_active;
  END IF;
  IF NOT FOUND OR v_band.level IS NULL THEN
    RAISE EXCEPTION 'Unknown difficulty level' USING errcode = 'invalid_parameter_value';
  END IF;
  -- Verbatim from 202: a band with no guidance for this type cannot state what it means
  -- here, and generating anyway would produce a question at a difficulty nobody chose.
  v_guide := v_band.guidance ->> p_question_type;
  IF v_guide IS NULL OR btrim(v_guide) = '' THEN
    RAISE EXCEPTION 'This difficulty is not available for that question type'
      USING errcode = 'P0013';
  END IF;

  SELECT count(*) INTO v_n FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No quizzable cards in scope' USING errcode = 'P0010';
  END IF;
  IF p_question_type = 'mcq' AND v_n < v_band.option_count THEN
    RAISE EXCEPTION 'Not enough cards for multiple choice' USING errcode = 'P0010';
  END IF;

  INSERT INTO quiz_sets (owner_user_id, deck_id, title, question_type, scope_kind,
                         scope_tags, scope_card_ids, requested_count, content_locale, difficulty)
    VALUES (v_uid, p_deck_id, p_title, p_question_type, p_scope_kind,
            CASE WHEN p_scope_kind = 'tags'  THEN p_tags     ELSE '{}'::text[] END,
            CASE WHEN p_scope_kind = 'cards' THEN p_card_ids ELSE '{}'::uuid[] END,
            LEAST(p_count, v_n), p_content_locale, v_band.level)
    RETURNING id INTO v_set;

  -- The QUESTIONS were already sampled at random, and stay that way.
  SELECT jsonb_agg(jsonb_build_object('card_id', card_id, 'answer_key', answer_key) ORDER BY ord)
    INTO v_cards
    FROM (SELECT card_id, answer_key, random() AS ord
            FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)
           ORDER BY random() LIMIT LEAST(p_count, v_n)) s;

  -- Other answers from the same deck, to fill the FAR distractor slots a band leaves open.
  --
  -- THE SAMPLE IS RANDOM, not just its order. Until 238 the `LIMIT 40` sat on an unordered
  -- subquery and the `ORDER BY random()` shuffled the forty it had already taken — so a
  -- 429-card deck offered the same forty wrong answers to every quiz it ever generated,
  -- verified twice on production. Distinct first, then shuffle, then take forty.
  SELECT array_agg(a) INTO v_fillers
    FROM (SELECT a
            FROM (SELECT DISTINCT answer_text AS a
                    FROM _quiz_eligible_cards(v_uid, p_deck_id, p_scope_kind, p_tags, p_card_ids)) d
           ORDER BY random() LIMIT 40) f;

  RETURN jsonb_build_object('set_id', v_set, 'eligible', v_n,
                            'requested', LEAST(p_count, v_n),
                            'difficulty', v_band.level,
                            'near_required', v_band.near_required,
                            'near_max', v_band.near_max,
                            'option_count', v_band.option_count,
                            'allowed_flaws', to_jsonb(v_band.allowed_flaws),
                            'fillers', to_jsonb(COALESCE(v_fillers, '{}'::text[])),
                            'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quiz_set(uuid, text, text, integer, text, text, text[], uuid[], smallint) TO authenticated;

COMMIT;
