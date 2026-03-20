# 공식계정 덱 대량 등록 가이드

## 개요

공식계정으로 마켓플레이스에 학습 덱을 대량 등록하는 전체 프로세스.
별도 UI 없이 Supabase SQL Editor 또는 스크립트로 직접 DB에 입력하는 방식.

콘텐츠 종류에 제한 없음 — 어학(영어, 중국어 등), 자격증(노무사, 회계사 등), 일반 학습 등 모두 가능.

---

## 전체 플로우

```
1. 공식계정 확인/생성
2. 카드 템플릿 확인 (기존 사용 또는 커스텀 생성)
3. 덱 생성 (INSERT → decks)
4. 카드 대량 삽입 (bulk_insert_cards RPC 또는 직접 INSERT → cards)
5. 마켓플레이스 등록 (INSERT → marketplace_listings)
```

---

## Step 1: 공식계정 확인

### 공식계정 조회

```sql
-- 공식계정 목록 확인
SELECT p.id, p.display_name, p.is_official, oas.display_badge, oas.organization_name
FROM profiles p
LEFT JOIN official_account_settings oas ON oas.user_id = p.id
WHERE p.is_official = true;
```

### 공식계정이 없으면 — admin RPC로 지정

```sql
-- admin 유저의 JWT로 호출해야 함 (Supabase Dashboard > SQL Editor에서 실행)
SELECT admin_set_official(
  'USER_UUID_HERE',   -- 공식계정으로 만들 유저 ID
  true,               -- is_official
  'official',         -- badge: verified | official | educator | publisher | partner
  '리콜 공식'          -- organization_name
);
```

> **참고**: `admin_set_official`은 SECURITY DEFINER + admin role 체크가 있으므로,
> Supabase Dashboard SQL Editor (service_role)에서 직접 실행하거나,
> admin 계정으로 로그인 후 앱에서 호출해야 합니다.

### service_role로 직접 지정하는 방법 (SQL Editor)

```sql
-- 1) profiles.is_official 설정 (트리거 우회를 위해 직접)
UPDATE profiles SET is_official = true WHERE id = 'USER_UUID';

-- 위가 트리거에 막히면 트리거 일시 비활성화:
ALTER TABLE profiles DISABLE TRIGGER trg_prevent_official_escalation;
UPDATE profiles SET is_official = true WHERE id = 'USER_UUID';
ALTER TABLE profiles ENABLE TRIGGER trg_prevent_official_escalation;

-- 2) official_account_settings 생성
INSERT INTO official_account_settings (user_id, display_badge, organization_name, featured_priority)
VALUES ('USER_UUID', 'official', '리콜 공식', 50);
```

---

## Step 2: 카드 템플릿 확인/생성

덱에 카드를 넣으려면 `template_id`가 필요합니다.

### 기존 기본 템플릿 (유저 생성 시 자동 생성)

```sql
SELECT id, name, fields FROM card_templates WHERE user_id = 'USER_UUID';
```

| 이름 | fields | 용도 |
|------|--------|------|
| 기본 (앞/뒤) | field_1(앞면), field_2(뒷면) | 단순 플래시카드 (자격증, 일반 학습 등) |
| 중국어 단어 | field_1(한자), field_2(뜻), field_3(병음), field_4(예문), field_5(오디오) | 중국어 |
| 영어 단어 | field_1(Word), field_2(Meaning), field_3(Pronunciation), field_4(Example) | 영어 단어 |

### 커스텀 템플릿 생성 (필요한 경우)

기존 템플릿이 맞지 않으면 새로 만들 수 있습니다.

```sql
-- 예시: 노무사 시험용 템플릿
INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
VALUES (
  'USER_UUID',
  '노무사 시험',
  '[
    {"key":"field_1","name":"질문","type":"text","order":0},
    {"key":"field_2","name":"답변","type":"text","order":1},
    {"key":"field_3","name":"관련법령","type":"text","order":2},
    {"key":"field_4","name":"해설","type":"text","order":3}
  ]',
  '[{"field_key":"field_1","style":"primary"}]',
  '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]',
  false
)
RETURNING id;

-- 예시: 회화 학습 템플릿
INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
VALUES (
  'USER_UUID',
  '회화',
  '[
    {"key":"field_1","name":"상황","type":"text","order":0},
    {"key":"field_2","name":"영어 표현","type":"text","order":1},
    {"key":"field_3","name":"번역","type":"text","order":2},
    {"key":"field_4","name":"예시 대화","type":"text","order":3}
  ]',
  '[{"field_key":"field_1","style":"hint"},{"field_key":"field_2","style":"primary"}]',
  '[{"field_key":"field_3","style":"primary"},{"field_key":"field_4","style":"detail"}]',
  false
)
RETURNING id;
```

---

## Step 3: 덱 생성

```sql
INSERT INTO decks (id, user_id, name, description, default_template_id, color, icon)
VALUES (
  gen_random_uuid(),
  'USER_UUID',              -- 공식계정 user_id
  '덱 이름',
  '덱 설명',
  'TEMPLATE_UUID',          -- 사용할 템플릿
  '#3B82F6',                -- 색상
  '📚'                      -- 아이콘
)
RETURNING id;
-- 결과: DECK_UUID
```

---

## Step 4: 카드 대량 삽입

### 방법 A: SQL로 직접 INSERT (Supabase SQL Editor)

**field_values는 템플릿의 fields 구조에 맞춰야 합니다.**

```sql
-- 영어 단어 예시
INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position)
VALUES
  ('DECK_UUID', 'USER_UUID', 'TEMPLATE_UUID',
   '{"field_1": "ability", "field_2": "능력", "field_4": "She has the ability to speak three languages."}'::jsonb, 0),
  ('DECK_UUID', 'USER_UUID', 'TEMPLATE_UUID',
   '{"field_1": "abroad", "field_2": "해외에", "field_4": "He studied abroad for two years."}'::jsonb, 1)
-- ... 반복
;

-- 노무사 시험 예시
INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position)
VALUES
  ('DECK_UUID', 'USER_UUID', 'TEMPLATE_UUID',
   '{"field_1": "근로기준법상 근로시간 원칙은?", "field_2": "1주 40시간, 1일 8시간", "field_3": "근로기준법 제50조", "field_4": "사용자는 근로자에게 1주 간에 40시간을 초과하여 근로하게 하여서는 아니 된다."}'::jsonb, 0)
;

-- 덱의 next_position 업데이트 (필수)
UPDATE decks SET next_position = (
  SELECT COUNT(*) FROM cards WHERE deck_id = 'DECK_UUID'
) WHERE id = 'DECK_UUID';
```

### 방법 B: bulk_insert_cards RPC (앱에서 공식계정 로그인 후)

```typescript
const cards = csvData.map((row) => ({
  field_values: {
    field_1: row.word,
    field_2: row.meaning,
    field_4: row.example,
  },
  tags: ['ielts', '5.0'],
}));

const { data } = await supabase.rpc('bulk_insert_cards', {
  p_deck_id: 'DECK_UUID',
  p_template_id: 'TEMPLATE_UUID',
  p_cards: cards,
});
```

### 방법 C: CSV → SQL 변환 스크립트 (Python)

```python
import csv, json

DECK_UUID = 'your-deck-uuid'
USER_UUID = 'your-user-uuid'
TEMPLATE_UUID = 'your-template-uuid'

# field_values 매핑 — CSV 컬럼명 → 템플릿 field key
# 콘텐츠 종류에 맞게 수정
FIELD_MAP = {
    'field_1': 'english',      # Word (또는 질문, 상황 등)
    'field_2': 'ko_meaning',   # Meaning (또는 답변, 번역 등)
    'field_4': 'example',      # Example (또는 해설, 예시 등)
}

with open('STUDY_DATA/ielts-5.0-800.csv', 'r') as f:
    reader = csv.DictReader(f)
    values = []
    for i, row in enumerate(reader):
        fv = {fk: row[csv_col] for fk, csv_col in FIELD_MAP.items()}
        fv_json = json.dumps(fv, ensure_ascii=False).replace("'", "''")
        values.append(
            f"('{DECK_UUID}', '{USER_UUID}', '{TEMPLATE_UUID}', "
            f"'{fv_json}'::jsonb, {i})"
        )

sql = f"""INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position)
VALUES
{chr(44) + chr(10).join(values)};

UPDATE decks SET next_position = {len(values)} WHERE id = '{DECK_UUID}';
"""

with open('bulk_insert.sql', 'w') as f:
    f.write(sql)

print(f"Generated SQL for {len(values)} cards -> bulk_insert.sql")
```

---

## Step 5: 마켓플레이스 등록

```sql
INSERT INTO marketplace_listings (
  deck_id, owner_id, title, description, tags, category, share_mode, card_count
)
VALUES (
  'DECK_UUID',
  'USER_UUID',
  '덱 제목',
  '덱 설명. 공식 리콜 제공.',
  ARRAY['태그1', '태그2'],
  'general',                         -- general|language|science|math|history|programming|trivia|exam|other
  'copy',                            -- copy|subscribe|snapshot
  (SELECT COUNT(*) FROM cards WHERE deck_id = 'DECK_UUID')
);
-- 트리거가 자동으로 owner_display_name, owner_is_official 세팅
```

### 등록 확인

```sql
SELECT ml.id, ml.title, ml.card_count, ml.owner_is_official,
       ml.share_mode, ml.is_active, ml.created_at
FROM marketplace_listings ml
WHERE ml.owner_id = 'USER_UUID';
```

---

## 다국어 대상 덱 (같은 콘텐츠, 언어별 분리)

어학 콘텐츠의 경우 같은 원본 데이터에서 **타겟 언어별로 덱을 분리**해야 할 수 있습니다.

예시: `ielts-5.0-800.csv` 하나로 7개 덱 생성

| 덱 이름 | field_2 (Meaning) 소스 | field_4 (Example) 소스 | 대상 |
|---------|----------------------|----------------------|------|
| IELTS 5.0 영단어 800 (한국어) | `ko_meaning` | `ko_example` | 한국어 사용자 |
| IELTS 5.0 英単語 800 (日本語) | `ja_meaning` | `ja_example` | 일본어 사용자 |
| IELTS 5.0 英语词汇 800 (中文) | `zh_meaning` | `zh_example` | 중국어 사용자 |
| IELTS 5.0 Vocabulario 800 (Español) | `es_meaning` | `es_example` | 스페인어 사용자 |
| IELTS 5.0 Từ vựng 800 (Tiếng Việt) | `vi_meaning` | `vi_example` | 베트남어 사용자 |
| IELTS 5.0 คำศัพท์ 800 (ภาษาไทย) | `th_meaning` | `th_example` | 태국어 사용자 |
| IELTS 5.0 Kosakata 800 (Bahasa Indonesia) | `id_meaning` | `id_example` | 인도네시아어 사용자 |

**Python 스크립트 예시 (언어별 덱 자동 생성)**:

```python
import csv, json

USER_UUID = 'your-user-uuid'
TEMPLATE_UUID = 'your-template-uuid'

LANGUAGES = {
    'ko': {'meaning': 'ko_meaning', 'example': 'ko_example', 'label': '한국어',    'deck_prefix': 'IELTS 5.0 영단어 800'},
    'ja': {'meaning': 'ja_meaning', 'example': 'ja_example', 'label': '日本語',    'deck_prefix': 'IELTS 5.0 英単語 800'},
    'zh': {'meaning': 'zh_meaning', 'example': 'zh_example', 'label': '中文',      'deck_prefix': 'IELTS 5.0 英语词汇 800'},
    'es': {'meaning': 'es_meaning', 'example': 'es_example', 'label': 'Español',   'deck_prefix': 'IELTS 5.0 Vocabulario 800'},
    'vi': {'meaning': 'vi_meaning', 'example': 'vi_example', 'label': 'Tiếng Việt','deck_prefix': 'IELTS 5.0 Từ vựng 800'},
    'th': {'meaning': 'th_meaning', 'example': 'th_example', 'label': 'ภาษาไทย',  'deck_prefix': 'IELTS 5.0 คำศัพท์ 800'},
    'id': {'meaning': 'id_meaning', 'example': 'id_example', 'label': 'Bahasa Indonesia', 'deck_prefix': 'IELTS 5.0 Kosakata 800'},
}

with open('STUDY_DATA/ielts-5.0-800.csv', 'r') as f:
    rows = list(csv.DictReader(f))

all_sql = []

for lang_code, lang_info in LANGUAGES.items():
    deck_name = f"{lang_info['deck_prefix']} ({lang_info['label']})"

    # 1) 덱 생성
    all_sql.append(f"""
-- === {deck_name} ===
DO $$
DECLARE
  v_deck_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO decks (id, user_id, name, description, default_template_id)
  VALUES (v_deck_id, '{USER_UUID}', '{deck_name}', '{deck_name}', '{TEMPLATE_UUID}');
""")

    # 2) 카드 삽입
    for i, row in enumerate(rows):
        fv = {
            "field_1": row["english"],
            "field_2": row[lang_info["meaning"]],
            "field_4": row[lang_info["example"]],
        }
        fv_json = json.dumps(fv, ensure_ascii=False).replace("'", "''")
        all_sql.append(
            f"  INSERT INTO cards (deck_id, user_id, template_id, field_values, sort_position) "
            f"VALUES (v_deck_id, '{USER_UUID}', '{TEMPLATE_UUID}', '{fv_json}'::jsonb, {i});"
        )

    # 3) next_position + 마켓 등록
    all_sql.append(f"""
  UPDATE decks SET next_position = {len(rows)} WHERE id = v_deck_id;

  INSERT INTO marketplace_listings (deck_id, owner_id, title, description, tags, category, share_mode, card_count)
  VALUES (v_deck_id, '{USER_UUID}', '{deck_name}', '{deck_name}', ARRAY['ielts','english','vocabulary','5.0','{lang_code}'], 'exam', 'copy', {len(rows)});
END $$;
""")

with open('bulk_multilang.sql', 'w') as f:
    f.write('\n'.join(all_sql))

print(f"Generated SQL for {len(LANGUAGES)} languages x {len(rows)} cards")
```

> **참고**: 다국어 분리가 필요 없는 콘텐츠(노무사, 회계사 등 단일 언어)는 이 단계를 건너뛰고 Step 3~5만 진행하면 됩니다.

---

## 한 번에 여러 덱 등록 (시리즈)

```sql
-- 예시: IELTS 시리즈 (한국어 대상)
INSERT INTO decks (id, user_id, name, description, default_template_id, color, icon) VALUES
  (gen_random_uuid(), 'USER_UUID', 'IELTS 5.0 필수 영단어 800',  'IELTS 5.0 목표', 'TPL_UUID', '#3B82F6', '📘'),
  (gen_random_uuid(), 'USER_UUID', 'IELTS 5.5 핵심 영단어 1000', 'IELTS 5.5 목표', 'TPL_UUID', '#6366F1', '📗'),
  (gen_random_uuid(), 'USER_UUID', 'IELTS 6.0 고급 영단어 1200', 'IELTS 6.0 목표', 'TPL_UUID', '#8B5CF6', '📙'),
  (gen_random_uuid(), 'USER_UUID', 'IELTS 6.5 실전 영단어 1500', 'IELTS 6.5 목표', 'TPL_UUID', '#EC4899', '📕'),
  (gen_random_uuid(), 'USER_UUID', 'IELTS 7.0 만점 영단어 1500', 'IELTS 7.0 목표', 'TPL_UUID', '#F59E0B', '📓')
RETURNING id, name;
-- 반환된 각 DECK_UUID로 카드 INSERT + 마켓 등록
```

---

## 주의사항

1. **RLS**: Supabase SQL Editor는 service_role로 실행되어 RLS를 우회합니다. `user_id` 값을 정확히 넣어야 합니다.
2. **트리거**: `marketplace_listings` INSERT 시 `sync_listing_owner_info` 트리거가 자동 실행되어 `owner_display_name`, `owner_is_official`을 profiles에서 가져옵니다.
3. **deck_id UNIQUE**: `marketplace_listings.deck_id`는 UNIQUE — 하나의 덱은 하나의 리스팅만 가능.
4. **card_count 동기화**: 리스팅의 `card_count`를 실제 카드 수와 맞추려면:
   ```sql
   UPDATE marketplace_listings ml
   SET card_count = (SELECT COUNT(*) FROM cards WHERE deck_id = ml.deck_id)
   WHERE ml.owner_id = 'USER_UUID';
   ```
5. **template_id**: 카드에 넣는 `template_id`는 반드시 해당 유저 소유의 템플릿이어야 합니다 (FK 제약).
6. **field_values 구조**: 반드시 사용하는 템플릿의 `fields` 정의에 맞는 key(field_1, field_2 ...)를 사용해야 합니다. 앱에서 카드를 볼 때 이 key로 렌더링됩니다.
