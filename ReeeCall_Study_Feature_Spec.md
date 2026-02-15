# ReeeCall Study — 상세 기능 명세서 (Feature Specification)

> **버전**: v2.0
> **최종 수정**: 2026-02-14
> **기술 스택**: Supabase (Auth · DB · Storage) + Cloudflare Pages + Python (서버 로직 필요시)
> **대상 사용자**: 본인 1인 (Solo User)
> **배포 형태**: 웹 서비스 (PC 우선, 모바일 반응형)

---

## 0. 아키텍처 개요

### 0.1 시스템 구성도

```
[브라우저 / PWA]
    │
    ├── Cloudflare Pages (정적 프론트엔드 호스팅)
    │     └── React (Vite) + TailwindCSS
    │
    ├── Supabase (백엔드 올인원)
    │     ├── Auth          → 매직 링크 (Passwordless, 비밀번호 없음)
    │     ├── PostgreSQL     → 덱, 카드, 템플릿, 학습 로그, 통계
    │     ├── Storage        → 이미지 / 오디오 파일
    │     ├── Edge Functions → 간단한 서버 로직 (Deno)
    │     └── Realtime       → (향후) 실시간 동기화
    │
    ├── Python 백엔드 (필요시) — Railway / Fly.io
    │     ├── FastAPI         → Bulk Import API, 데이터 전처리
    │     ├── edge-tts        → 고품질 무료 TTS 음성 생성
    │     └── 확장 API        → 향후 복잡한 서버 로직
    │
    ├── Python 로컬 스크립트
    │     ├── bulk_import.py  → 대량 카드 밀어넣기
    │     ├── anki_convert.py → Anki 덱 변환
    │     └── data_tools.py   → 데이터 마이그레이션/정리
    │
    └── 외부 API (무료)
          └── Web Speech API (브라우저 내장 TTS)
```

### 0.2 기술 선택 근거

| 영역 | 선택 | 이유 |
|------|------|------|
| 프론트엔드 | React + Vite | 빠른 HMR, 생태계 풍부, SPA 적합 |
| 스타일링 | TailwindCSS | 유틸리티 기반, 빠른 프로토타이핑 |
| 호스팅 | Cloudflare Pages | 무료 티어 충분, 글로벌 CDN, Git 연동 자동 배포 |
| 백엔드 | Supabase | Auth·DB·Storage 일체형, 무료 티어로 1인 충분 |
| 서버 로직 | Python (FastAPI) | 본인이 아는 언어, 필요시에만 배포 |
| 상태 관리 | Zustand | 가볍고 보일러플레이트 적음 |
| 차트 | Recharts | React 네이티브, 히트맵·라인차트 지원 |
| TTS | Web Speech API + edge-tts | 둘 다 무료, 브라우저 기본 + 고품질 옵션 |

### 0.3 확장 경로

```
Phase 1 (v1.0): Supabase + React + Python 로컬 스크립트
  → 서버 없이 Supabase만으로 운영. Python은 로컬에서 bulk import용.

Phase 2 (v1.5): + Python FastAPI 서버 추가
  → edge-tts 고품질 TTS, 복잡한 데이터 처리, API 확장
  → Railway 무료 티어 또는 Fly.io 배포

Phase 3 (v2.0+): + 모바일 앱 / 멀티 유저
  → FastAPI가 중앙 API 서버 역할
  → React Native 또는 PWA 고도화
```

### 0.4 프로젝트 디렉토리 구조

```
reeecall-study/
├── src/                          # React 프론트엔드
│   ├── components/
│   │   ├── auth/                 # 매직 링크 로그인 UI
│   │   ├── deck/                 # 덱 목록, 덱 상세
│   │   ├── card/                 # 카드 편집기, 카드 뷰어
│   │   ├── template/             # 카드 템플릿 설정 UI
│   │   ├── study/                # 학습 모드 (4가지)
│   │   ├── dashboard/            # 통계, 히트맵, 그래프
│   │   └── common/               # Modal, Toast, ProgressBar 등
│   ├── hooks/                    # useAuth, useDeck, useStudy, useSRS 등
│   ├── lib/
│   │   ├── supabase.ts           # Supabase 클라이언트 초기화
│   │   ├── srs.ts                # SRS 알고리즘 순수 함수
│   │   ├── study-modes.ts        # 학습 모드 로직
│   │   └── tts.ts                # TTS 유틸리티
│   ├── pages/                    # 라우트별 페이지
│   ├── stores/                   # Zustand 스토어
│   ├── types/                    # TypeScript 타입 정의
│   └── utils/                    # 유틸리티 함수
├── public/
├── supabase/
│   ├── migrations/               # SQL 마이그레이션 파일
│   └── seed.sql                  # 테스트 데이터
├── scripts/                      # Python 유틸리티 스크립트
│   ├── bulk_import.py
│   ├── anki_convert.py
│   └── requirements.txt
├── backend/                      # Python FastAPI (Phase 2)
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── bulk_import.py
│   │   │   ├── tts.py
│   │   │   └── stats.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   └── database.py
│   │   └── services/
│   │       └── tts_engine.py
│   ├── requirements.txt
│   └── Dockerfile
├── package.json
├── vite.config.ts
└── wrangler.toml                 # Cloudflare 설정
```

---

## 1. 사용자 인증 (Passwordless)

> 비밀번호 없이 이메일만으로 로그인. 매직 링크(OTP) 방식.
> 1인 사용이므로 복잡한 권한 불필요. 단, RLS는 반드시 적용.

### 1.1 매직 링크 로그인

**동작 흐름:**

1. `/auth/login` 페이지에서 **이메일만** 입력
2. `supabase.auth.signInWithOtp({ email })` 호출
3. Supabase가 매직 링크 이메일 발송
4. 사용자가 메일의 링크 클릭 → 자동 로그인 + 세션 발급
5. 회원이 없으면 자동 가입 처리 (profiles 자동 생성)
6. 로그인 완료 → `/dashboard`로 리다이렉트

**상세 요구사항:**

- 비밀번호 입력 필드 **없음** — 이메일 한 칸 + "로그인 링크 보내기" 버튼
- 매직 링크 유효 시간: 1시간 (Supabase 기본)
- 링크 발송 후 안내 화면: "📧 이메일을 확인해주세요"
- 링크 클릭 후 콜백 URL: `{SITE_URL}/auth/callback`
- 비로그인 상태에서 보호 라우트 접근 시 → `/auth/login`으로 리다이렉트
- 이미 로그인된 상태에서 `/auth/login` 접근 시 → `/dashboard`로 리다이렉트

**UI 구성:**

```
┌─────────────────────────────────┐
│         ReeeCall Study          │
│                                 │
│   이메일로 간편 로그인            │
│                                 │
│   ┌───────────────────────┐     │
│   │ your@email.com        │     │
│   └───────────────────────┘     │
│                                 │
│   [ 🔗 로그인 링크 보내기 ]      │
│                                 │
│   비밀번호 없이 이메일 링크로     │
│   안전하게 로그인합니다.         │
│                                 │
└─────────────────────────────────┘
```

### 1.2 세션 관리

- Supabase JS 클라이언트의 자동 토큰 갱신(refresh) 활용
- `supabase.auth.onAuthStateChange()` 리스너로 로그인/로그아웃 상태 전역 관리
- JWT Access Token 만료: 1시간 (기본값)
- Refresh Token으로 자동 갱신 → 사용자는 재로그인 불필요
- 로그아웃: `supabase.auth.signOut()` → 로컬 스토리지 토큰 삭제 + `/auth/login` 이동

### 1.3 프로필 설정

**`profiles` 테이블 구조:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK, FK → auth.users) | 사용자 ID |
| `display_name` | text | 표시 이름 |
| `daily_new_limit` | integer, default 20 | SRS 모드 일일 신규 카드 한도 |
| `default_study_mode` | text, default 'srs' | 기본 학습 모드 |
| `timezone` | text, default 'Asia/Seoul' | 시간대 (하루 기준 판단용) |
| `theme` | text, default 'system' | 'light' / 'dark' / 'system' |
| `tts_enabled` | boolean, default true | 자동 TTS 재생 여부 |
| `tts_lang` | text, default 'zh-CN' | TTS 기본 언어 |
| `tts_provider` | text, default 'web_speech' | 'web_speech' 또는 'edge_tts' |
| `created_at` | timestamptz | 가입일 |
| `updated_at` | timestamptz | 수정일 |

**설정 화면:**

- 일일 신규 카드 한도 슬라이더 (5 ~ 200, 기본 20) — SRS 모드 전용
- 기본 학습 모드 선택 (SRS / 순차복습 / 랜덤 / 순서대로)
- TTS ON/OFF 토글 + 언어 선택 (zh-CN, en-US, ko-KR, ja-JP 등)
- TTS 엔진 선택 (Web Speech API / edge-tts)
- 타임존 선택 (일일 리셋 기준)

---

## 2. 카드 템플릿 시스템

> Anki의 Note Type과 유사한 개념. 사용자가 카드의 필드를 자유롭게 정의하고,
> 앞면/뒷면에 어떤 필드를 어떻게 보여줄지 설정할 수 있다.
> HTML 직접 편집은 아니고, 고정된 레이아웃 스타일 중에서 선택하는 방식.

### 2.1 개념

```
[ 카드 템플릿 ]
    │
    ├── 필드 정의 (최대 10개)
    │     ├── "한자"    (text)
    │     ├── "뜻"      (text)
    │     ├── "병음"    (text)
    │     ├── "예문"    (text)
    │     └── "이미지"  (image)
    │
    ├── 앞면 레이아웃 설정
    │     └── "한자" → primary 스타일
    │
    └── 뒷면 레이아웃 설정
          ├── "뜻"    → primary 스타일
          ├── "병음"  → secondary 스타일
          ├── "예문"  → detail 스타일
          └── "이미지" → media 스타일
```

- 하나의 템플릿을 여러 덱에서 공유 가능 (사용자 단위)
- 덱 생성 시 기본 템플릿 지정, 이후 개별 카드에서 변경 가능
- 기본 제공 템플릿 있음 (처음 사용자가 바로 시작 가능)

### 2.2 데이터 모델

**`card_templates` 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | 템플릿 ID |
| `user_id` | uuid (FK → auth.users) | 소유자 |
| `name` | text, NOT NULL | 템플릿 이름 (예: "중국어 단어") |
| `fields` | jsonb, NOT NULL | 필드 정의 배열 (최대 10개) |
| `front_layout` | jsonb, NOT NULL | 앞면 표시 설정 |
| `back_layout` | jsonb, NOT NULL | 뒷면 표시 설정 |
| `is_default` | boolean, default false | 기본 제공 템플릿 여부 |
| `created_at` | timestamptz | 생성일 |
| `updated_at` | timestamptz | 수정일 |

**`fields` JSONB 구조:**

```json
[
  { "key": "field_1", "name": "한자",   "type": "text",  "order": 0 },
  { "key": "field_2", "name": "뜻",     "type": "text",  "order": 1 },
  { "key": "field_3", "name": "병음",   "type": "text",  "order": 2 },
  { "key": "field_4", "name": "예문",   "type": "text",  "order": 3 },
  { "key": "field_5", "name": "이미지", "type": "image", "order": 4 },
  { "key": "field_6", "name": "오디오", "type": "audio", "order": 5 }
]
```

- `key`: 내부 식별자 (변경 불가, 데이터 참조용)
- `name`: 사용자에게 표시되는 필드 이름 (자유롭게 변경 가능)
- `type`: `"text"` | `"image"` | `"audio"`
- `order`: 편집 폼에서의 표시 순서
- **최대 10개** 필드

**`front_layout` / `back_layout` JSONB 구조:**

```json
[
  { "field_key": "field_1", "style": "primary" },
  { "field_key": "field_3", "style": "hint" }
]
```

### 2.3 표시 스타일 옵션

| 스타일 | 렌더링 | 용도 |
|--------|--------|------|
| `primary` | 2.5rem, bold, 중앙 정렬 | 메인 콘텐츠 (한자, 단어) |
| `secondary` | 1.5rem, normal, 중앙 정렬 | 보조 정보 (뜻, 번역) |
| `hint` | 1.2rem, 연한 색 (gray-400) | 힌트 (병음, 발음) |
| `detail` | 1rem, 연한 색 (gray-500), 좌측 정렬 | 예문, 메모 |
| `media` | 이미지: max 300px / 오디오: 재생 버튼 | 미디어 파일 |

**렌더링 예시 (앞면):**

```html
<!-- front_layout: [{"field_key":"field_1","style":"primary"}] -->
<div class="card-face card-front">
  <div class="field-primary">经济</div>
</div>
```

**렌더링 예시 (뒷면):**

```html
<!-- back_layout: 4개 필드 -->
<div class="card-face card-back">
  <div class="field-primary">경제</div>
  <div class="field-hint">jīngjì</div>
  <div class="field-detail">经济发展 - 경제 발전</div>
  <div class="field-media"><img src="..." /></div>
</div>
```

### 2.4 기본 제공 템플릿

시스템이 자동 생성하는 템플릿 (사용자가 바로 사용 가능):

**① 기본 (앞/뒤)**

```json
{
  "name": "기본 (앞/뒤)",
  "fields": [
    { "key": "field_1", "name": "앞면", "type": "text", "order": 0 },
    { "key": "field_2", "name": "뒷면", "type": "text", "order": 1 }
  ],
  "front_layout": [{ "field_key": "field_1", "style": "primary" }],
  "back_layout": [{ "field_key": "field_2", "style": "primary" }]
}
```

**② 중국어 단어**

```json
{
  "name": "중국어 단어",
  "fields": [
    { "key": "field_1", "name": "한자",   "type": "text",  "order": 0 },
    { "key": "field_2", "name": "뜻",     "type": "text",  "order": 1 },
    { "key": "field_3", "name": "병음",   "type": "text",  "order": 2 },
    { "key": "field_4", "name": "예문",   "type": "text",  "order": 3 },
    { "key": "field_5", "name": "오디오", "type": "audio", "order": 4 }
  ],
  "front_layout": [
    { "field_key": "field_1", "style": "primary" }
  ],
  "back_layout": [
    { "field_key": "field_2", "style": "primary" },
    { "field_key": "field_3", "style": "hint" },
    { "field_key": "field_4", "style": "detail" },
    { "field_key": "field_5", "style": "media" }
  ]
}
```

**③ 영어 단어**

```json
{
  "name": "영어 단어",
  "fields": [
    { "key": "field_1", "name": "Word",          "type": "text",  "order": 0 },
    { "key": "field_2", "name": "Meaning",       "type": "text",  "order": 1 },
    { "key": "field_3", "name": "Pronunciation", "type": "text",  "order": 2 },
    { "key": "field_4", "name": "Example",       "type": "text",  "order": 3 }
  ],
  "front_layout": [
    { "field_key": "field_1", "style": "primary" }
  ],
  "back_layout": [
    { "field_key": "field_2", "style": "primary" },
    { "field_key": "field_3", "style": "hint" },
    { "field_key": "field_4", "style": "detail" }
  ]
}
```

**④ 문장 학습**

```json
{
  "name": "문장 학습",
  "fields": [
    { "key": "field_1", "name": "원문",   "type": "text",  "order": 0 },
    { "key": "field_2", "name": "번역",   "type": "text",  "order": 1 },
    { "key": "field_3", "name": "메모",   "type": "text",  "order": 2 },
    { "key": "field_4", "name": "오디오", "type": "audio", "order": 3 }
  ],
  "front_layout": [
    { "field_key": "field_1", "style": "primary" }
  ],
  "back_layout": [
    { "field_key": "field_2", "style": "primary" },
    { "field_key": "field_3", "style": "detail" },
    { "field_key": "field_4", "style": "media" }
  ]
}
```

### 2.5 템플릿 설정 UI

**템플릿 편집 화면 구성:**

```
┌─────────────────────────────────────────────────────────┐
│  📋 템플릿 편집: "중국어 단어"                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [ 필드 관리 ] (최대 10개, 현재 5개)                      │
│  ┌─────────────────────────────────────────────┐        │
│  │ ☰ 1. 한자    [text ▼]   [이름 변경] [삭제]  │        │
│  │ ☰ 2. 뜻      [text ▼]   [이름 변경] [삭제]  │        │
│  │ ☰ 3. 병음    [text ▼]   [이름 변경] [삭제]  │        │
│  │ ☰ 4. 예문    [text ▼]   [이름 변경] [삭제]  │        │
│  │ ☰ 5. 오디오  [audio ▼]  [이름 변경] [삭제]  │        │
│  └─────────────────────────────────────────────┘        │
│  [ + 필드 추가 ]                                        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌── 앞면 설정 ──────┐    ┌── 뒷면 설정 ──────┐         │
│  │                    │    │                    │         │
│  │ [한자] primary  ☰  │    │ [뜻]   primary  ☰  │        │
│  │                    │    │ [병음] hint     ☰  │         │
│  │ [+ 필드 추가]      │    │ [예문] detail   ☰  │        │
│  │                    │    │ [오디오] media  ☰  │         │
│  │                    │    │                    │         │
│  │   ─── 미리보기 ──  │    │   ─── 미리보기 ──  │        │
│  │                    │    │                    │         │
│  │      经 济         │    │       경제         │         │
│  │                    │    │      jīngjì        │         │
│  │                    │    │  经济发展 - 경제..  │         │
│  │                    │    │     🔊 재생         │        │
│  └────────────────────┘    └────────────────────┘        │
│                                                         │
│                    [ 저장 ]                               │
└─────────────────────────────────────────────────────────┘
```

- 필드는 드래그(☰)로 순서 변경
- 앞면/뒷면 각각 필드를 추가하고 스타일 선택
- 실시간 미리보기로 결과 확인
- 필드 삭제 시: 해당 필드를 사용하는 카드가 있으면 경고

---

## 3. 덱(Deck) 관리

### 3.1 데이터 모델

**`decks` 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | 덱 ID |
| `user_id` | uuid (FK → auth.users) | 소유자 |
| `name` | text, NOT NULL | 덱 이름 (예: "HSK 5급") |
| `description` | text | 덱 설명 |
| `default_template_id` | uuid (FK → card_templates) | 기본 카드 템플릿 |
| `color` | text, default '#3B82F6' | 덱 라벨 색상 (HEX) |
| `icon` | text, default '📚' | 덱 아이콘 (이모지) |
| `is_archived` | boolean, default false | 보관 여부 |
| `sort_order` | integer, default 0 | 덱 정렬 순서 |
| `next_position` | integer, default 0 | 다음 카드에 부여할 sort_position |
| `created_at` | timestamptz | 생성일 |
| `updated_at` | timestamptz | 수정일 |

**RLS 정책:**

```sql
CREATE POLICY "Users can CRUD own decks" ON decks
  FOR ALL USING (auth.uid() = user_id);
```

### 3.2 덱 CRUD

**생성 (Create):**

- 모달에서 이름(필수), 설명(선택), 색상, 아이콘, 기본 템플릿 선택
- 템플릿 미선택 시 "기본 (앞/뒤)" 템플릿 자동 적용

**조회 (Read):**

- 대시보드에서 전체 덱 목록 카드 형태로 표시
- 각 덱 카드에 표시할 정보:
  - 덱 이름 + 아이콘
  - 총 카드 수
  - 사용 중인 템플릿 이름
  - 오늘 복습 예정 카드 수 (SRS 모드 기준)
  - 마지막 학습 일시
- 정렬: `sort_order` ASC → `created_at` DESC
- 보관된 덱은 기본 숨김, 토글로 표시 가능

**수정 (Update):**

- 덱 카드의 ... 메뉴 또는 덱 상세 페이지에서 편집
- 이름, 설명, 색상, 아이콘, 기본 템플릿 변경 가능

**삭제 (Delete):**

- 삭제 시 확인 다이얼로그: "이 덱과 모든 카드가 삭제됩니다. 되돌릴 수 없습니다."
- 소프트 삭제 옵션: `is_archived = true`

### 3.3 덱 통계 요약

```sql
SELECT
  d.id,
  d.name,
  COUNT(c.id) AS total_cards,
  COUNT(c.id) FILTER (WHERE c.srs_status = 'new') AS new_cards,
  COUNT(c.id) FILTER (
    WHERE c.srs_status = 'review' AND c.next_review_at <= NOW()
  ) AS due_review_cards,
  COUNT(c.id) FILTER (
    WHERE c.srs_status = 'learning' AND c.next_review_at <= NOW()
  ) AS relearn_cards,
  MAX(sl.studied_at) AS last_studied
FROM decks d
LEFT JOIN cards c ON c.deck_id = d.id
LEFT JOIN study_logs sl ON sl.card_id = c.id
WHERE d.user_id = auth.uid() AND d.is_archived = false
GROUP BY d.id;
```

### 3.4 가져오기 / 내보내기

**내보내기 (Export):**

- 포맷: JSON / CSV
- JSON에 템플릿 정보 포함:

```json
{
  "deck_name": "HSK 5급",
  "exported_at": "2026-02-14T12:00:00Z",
  "template": {
    "name": "중국어 단어",
    "fields": [
      { "key": "field_1", "name": "한자", "type": "text" },
      { "key": "field_2", "name": "뜻",   "type": "text" },
      { "key": "field_3", "name": "병음", "type": "text" }
    ],
    "front_layout": [{ "field_key": "field_1", "style": "primary" }],
    "back_layout": [
      { "field_key": "field_2", "style": "primary" },
      { "field_key": "field_3", "style": "hint" }
    ]
  },
  "cards": [
    {
      "field_values": { "field_1": "经济", "field_2": "경제", "field_3": "jīngjì" },
      "tags": ["HSK5", "명사"],
      "created_at": "2026-02-10T09:00:00Z"
    }
  ]
}
```

- CSV: 헤더가 필드 이름 → `한자,뜻,병음,tags`
- 브라우저에서 Blob 다운로드 (서버 불필요)

**가져오기 (Import):**

- 파일 업로드 (JSON/CSV)
- 미리보기: 처음 5개 카드 테이블로 표시
- CSV의 경우: 헤더를 템플릿 필드에 매핑하는 UI
- 중복 처리 옵션: "건너뛰기 / 덮어쓰기 / 새로 추가"
- 결과: "총 150개 중 148개 추가, 2개 건너뜀"

---

## 4. 카드(Card) 관리

### 4.1 데이터 모델

**`cards` 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | 카드 ID |
| `deck_id` | uuid (FK → decks, CASCADE) | 소속 덱 |
| `user_id` | uuid (FK → auth.users) | 소유자 |
| `template_id` | uuid (FK → card_templates) | 사용 중인 템플릿 |
| `field_values` | jsonb, NOT NULL | 필드 값 (동적) |
| `tags` | text[] | 태그 배열 |
| `sort_position` | integer, NOT NULL | 덱 내 순서 (삽입순) |
| `srs_status` | text, default 'new' | SRS 상태 |
| `ease_factor` | real, default 2.5 | 난이도 계수 |
| `interval_days` | integer, default 0 | 현재 간격 (일) |
| `repetitions` | integer, default 0 | 연속 정답 횟수 |
| `next_review_at` | timestamptz | 다음 복습 예정 |
| `last_reviewed_at` | timestamptz | 마지막 복습 |
| `created_at` | timestamptz | **업로드/생성 일시** |
| `updated_at` | timestamptz | 수정일 |

**`field_values` JSONB 구조:**

```json
{
  "field_1": "经济",
  "field_2": "경제",
  "field_3": "jīngjì",
  "field_4": "经济发展 - 경제 발전"
}
```

- key는 `card_templates.fields[].key`와 대응
- image/audio 타입 필드의 값은 Supabase Storage URL 문자열

**`srs_status` 값:**

- `'new'` — 아직 한 번도 학습하지 않은 카드
- `'learning'` — 학습 중 (Again 눌러서 재학습 큐에 있음)
- `'review'` — 정상 복습 사이클
- `'suspended'` — 일시 정지

**인덱스:**

```sql
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_user ON cards(user_id);
CREATE INDEX idx_cards_review ON cards(user_id, next_review_at)
  WHERE srs_status IN ('learning', 'review');
CREATE INDEX idx_cards_position ON cards(deck_id, sort_position);
CREATE INDEX idx_cards_created ON cards(deck_id, created_at);
```

### 4.2 카드 CRUD

**생성:**

- 덱 상세 페이지에서 "카드 추가" 버튼
- 편집 폼: 템플릿의 필드 정의에 따라 동적으로 입력 필드 생성
  - text 필드 → 텍스트 입력
  - image 필드 → 파일 업로드 / 드래그&드롭
  - audio 필드 → 파일 업로드
- `sort_position`은 `decks.next_position`에서 자동 부여 후 +1 증가
- 저장 시 `srs_status = 'new'`, SRS 초기값 설정

**조회:**

- 덱 상세 → 카드 목록 (테이블 뷰)
- 컬럼: 템플릿 필드 중 처음 2~3개 + 상태 + 다음 복습일 + 추가일
- 검색: `field_values` 전체에서 텍스트 검색 (JSONB 연산)
- 필터:
  - 상태별 (new / learning / review / suspended)
  - 태그별
  - **업로드 일자별** (날짜 범위 선택)
- 정렬: 생성일 / 순서(sort_position) / 다음 복습일

**수정:**

- 카드 클릭 → 편집 모달
- 모든 필드 수정 가능
- SRS 파라미터 수동 리셋 옵션 ("처음부터 다시 학습" 버튼)

**삭제:**

- 개별 삭제 (확인 다이얼로그)
- 다중 선택 삭제 (체크박스)

### 4.3 업로드 일자 추적 & 배치 관리

> 카드가 언제 추가되었는지 추적하고, 업로드 일자별로 학습할 수 있어야 한다.

**자동 추적:**

- `cards.created_at`이 업로드 시점을 기록
- Bulk Import 시 같은 시점에 들어온 카드는 동일한 `created_at` (초 단위 근사)

**업로드 일자별 카드 조회:**

```sql
-- 업로드 일자별 카드 수 집계
SELECT
  DATE(created_at AT TIME ZONE $timezone) AS upload_date,
  COUNT(*) AS card_count
FROM cards
WHERE deck_id = $1
GROUP BY upload_date
ORDER BY upload_date DESC;
```

**UI — 업로드 일자 필터:**

- 덱 상세 페이지에 "업로드 일자" 필터 드롭다운
- 캘린더 뷰 또는 날짜 범위 선택
- 선택한 날짜의 카드만 표시 → 해당 카드만 학습 시작 가능

### 4.4 Bulk Import (Python 스크립트)

> 핵심 기능. 외부 Python 스크립트에서 수백~수천 개 카드를 한 번에 밀어넣는 구조.

**Python 스크립트 (scripts/bulk_import.py):**

```python
"""
ReeeCall Study Bulk Import Script
Supabase Python 클라이언트로 대량 카드 삽입
"""
from supabase import create_client
import json
import csv
from pathlib import Path

SUPABASE_URL = "https://xxxxx.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGc..."  # Service Role Key

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def import_json(file_path: str, deck_id: str, user_id: str, template_id: str):
    """JSON 파일에서 카드 대량 삽입"""
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 현재 덱의 next_position 조회
    deck = supabase.table('decks').select('next_position').eq('id', deck_id).single().execute()
    position = deck.data['next_position']

    cards = []
    for item in data['cards']:
        cards.append({
            'deck_id': deck_id,
            'user_id': user_id,
            'template_id': template_id,
            'field_values': item['field_values'],
            'tags': item.get('tags', []),
            'sort_position': position,
            'srs_status': 'new',
            'ease_factor': 2.5,
            'interval_days': 0,
            'repetitions': 0,
        })
        position += 1

    # 1000개씩 배치 삽입
    batch_size = 1000
    inserted = 0
    for i in range(0, len(cards), batch_size):
        batch = cards[i:i + batch_size]
        result = supabase.table('cards').insert(batch).execute()
        inserted += len(result.data)
        print(f"  배치 {i//batch_size + 1}: {len(result.data)}개 삽입")

    # 덱의 next_position 업데이트
    supabase.table('decks').update({'next_position': position}).eq('id', deck_id).execute()

    print(f"완료: 총 {inserted}개 카드 삽입")
    return inserted


def import_csv(file_path: str, deck_id: str, user_id: str,
               template_id: str, field_mapping: dict):
    """
    CSV 파일에서 카드 대량 삽입
    field_mapping: {"CSV헤더이름": "field_key"} 매핑
    예: {"한자": "field_1", "뜻": "field_2", "병음": "field_3"}
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    deck = supabase.table('decks').select('next_position').eq('id', deck_id).single().execute()
    position = deck.data['next_position']

    cards = []
    for row in rows:
        field_values = {}
        for csv_col, field_key in field_mapping.items():
            if csv_col in row and row[csv_col].strip():
                field_values[field_key] = row[csv_col].strip()

        if not field_values:
            continue

        cards.append({
            'deck_id': deck_id,
            'user_id': user_id,
            'template_id': template_id,
            'field_values': field_values,
            'tags': [t.strip() for t in row.get('tags', '').split(',') if t.strip()],
            'sort_position': position,
            'srs_status': 'new',
        })
        position += 1

    # 배치 삽입 (동일)
    batch_size = 1000
    inserted = 0
    for i in range(0, len(cards), batch_size):
        batch = cards[i:i + batch_size]
        result = supabase.table('cards').insert(batch).execute()
        inserted += len(result.data)

    supabase.table('decks').update({'next_position': position}).eq('id', deck_id).execute()
    print(f"완료: 총 {inserted}개 카드 삽입 (CSV)")
    return inserted


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='ReeeCall Bulk Import')
    parser.add_argument('file', help='JSON 또는 CSV 파일 경로')
    parser.add_argument('--deck-id', required=True)
    parser.add_argument('--user-id', required=True)
    parser.add_argument('--template-id', required=True)
    args = parser.parse_args()

    file_path = Path(args.file)
    if file_path.suffix == '.json':
        import_json(str(file_path), args.deck_id, args.user_id, args.template_id)
    elif file_path.suffix == '.csv':
        # 기본 매핑 (CSV 헤더와 필드 키가 같다고 가정)
        print("CSV import: 헤더-필드 매핑을 코드에서 설정하세요")
```

**제한 및 안전장치:**

- 단일 배치 최대: 1,000장 (Supabase 제한)
- 중복 체크: `ON CONFLICT (deck_id, sort_position) DO NOTHING` 옵션
- UTF-8 인코딩 강제
- `sort_position` 자동 순번 부여로 삽입 순서 보장

### 4.5 이미지 / 오디오 업로드

**Supabase Storage 버킷:**

```sql
INSERT INTO storage.buckets (id, name, public) VALUES
  ('card-images', 'card-images', true),
  ('card-audio', 'card-audio', true);
```

**업로드 흐름:**

1. 카드 편집에서 image/audio 타입 필드에 파일 선택
2. `supabase.storage.from('card-images').upload(path, file)`
3. 반환된 공개 URL을 `field_values`의 해당 필드에 저장

**파일 경로 규칙:** `{user_id}/{deck_id}/{card_id}_{field_key}.{ext}`

**제한:**

- 이미지: 최대 5MB, jpg/png/webp
- 오디오: 최대 10MB, mp3/ogg/wav

---

## 5. 학습 모드 (4가지)

> 사용자가 덱 학습 시작할 때 4가지 모드 중 선택.
> 모든 모드에서 **업로드 일자별 필터**를 적용할 수 있다.

### 5.1 모드 개요 & 선택 UI

| 모드 | 이름 | 설명 |
|------|------|------|
| `srs` | SRS (간격 반복) | Anki처럼 잊을 때쯤 복습. Again/Hard/Good/Easy 평가 |
| `sequential_review` | 순차 복습 | 새 카드 배치 학습 → 기존 카드 처음부터 순차 복습 |
| `random` | 랜덤 | 덱에서 무작위로 카드 뽑아서 학습 |
| `sequential` | 순서대로 | sort_position 순서대로 학습 |

**모드 선택 UI (덱에서 "학습 시작" 클릭 시):**

```
┌─────────────────────────────────────┐
│  📖 학습 모드 선택                    │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 🧠 SRS (간격 반복)             │  │
│  │ 잊을 때쯤 알아서 복습          │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🔄 순차 복습                   │  │
│  │ 새 카드 + 처음부터 복습        │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🎲 랜덤                       │  │
│  │ 무작위로 섞어서 학습           │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ➡️ 순서대로                    │  │
│  │ 첫 카드부터 순서대로           │  │
│  └───────────────────────────────┘  │
│                                     │
│  ── 필터 (선택) ──                  │
│  📅 업로드 일자: [전체 ▼]           │
│  🔢 학습할 카드 수: [50 ▼]          │
│                                     │
│            [ 학습 시작 ]             │
└─────────────────────────────────────┘
```

### 5.2 SRS 모드 (간격 반복)

> Anki와 동일한 SM-2 변형. 자세한 알고리즘은 섹션 6 참고.

**세션 흐름:**

1. 복습 예정 카드(Relearn + Review) 먼저 가져오기
2. 신규 카드(New) 일일 한도(`daily_new_limit`)만큼 추가
3. 카드 앞면 표시 → 뒤집기 → Again/Hard/Good/Easy 선택
4. SRS 계산 → DB 업데이트 → 다음 카드
5. 모든 카드 완료 시 세션 종료

**SRS 모드 전용 설정:**

- 일일 신규 카드 한도 (profiles.daily_new_limit)
- 복습 카드 제한 없음

### 5.3 순차 복습 모드 (Sequential Review)

> 핵심 개념: 새로 추가된 카드를 배치로 학습한 뒤, 기존 카드를 처음부터 순차적으로 복습.
> 복습 위치를 기억해서 다음 세션에 이어서 복습.

**사용자가 설명한 예시:**

```
카드 1~1000이 있는 상태에서 1001~1100을 추가.

세션 1:
  Phase 1 (새 카드): 1001~1100 학습
  Phase 2 (복습):    1~150 복습

세션 2: (1101~1200이 추가되었다면)
  Phase 1 (새 카드): 1101~1200 학습
  Phase 2 (복습):    151~300 복습

세션 3: (새 카드 없음)
  Phase 2 (복습):    301~450 복습

... 복습이 끝까지 가면 다시 1부터 순환 ...
```

**상태 추적 — `deck_study_state` 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `deck_id` | uuid (FK) | |
| `new_start_pos` | integer, default 0 | 새 카드 시작 position |
| `review_start_pos` | integer, default 0 | 복습 시작 position |
| `new_batch_size` | integer, default 100 | 새 카드 배치 크기 |
| `review_batch_size` | integer, default 150 | 복습 배치 크기 |
| `updated_at` | timestamptz | |

**UNIQUE:** `(user_id, deck_id)` — 덱당 하나의 상태

**세션 로직 (클라이언트 측 TypeScript):**

```typescript
interface SeqReviewState {
  new_start_pos: number;
  review_start_pos: number;
  new_batch_size: number;
  review_batch_size: number;
}

async function getSequentialReviewCards(
  deckId: string,
  state: SeqReviewState
): Promise<{ newCards: Card[]; reviewCards: Card[] }> {

  // Phase 1: 새 카드 (new_start_pos 이후의 new 상태 카드)
  const { data: newCards } = await supabase
    .from('cards')
    .select('*')
    .eq('deck_id', deckId)
    .gte('sort_position', state.new_start_pos)
    .order('sort_position', { ascending: true })
    .limit(state.new_batch_size);

  // 새 카드의 최대 position 계산 → 다음 세션의 review 범위 업데이트
  const newMaxPos = newCards.length > 0
    ? Math.max(...newCards.map(c => c.sort_position)) + 1
    : state.new_start_pos;

  // Phase 2: 복습 (0 ~ new_start_pos 범위에서 review_start_pos부터)
  const reviewEnd = Math.min(
    state.review_start_pos + state.review_batch_size,
    state.new_start_pos  // 기존 카드 범위 내에서만
  );

  let reviewCards: Card[] = [];

  if (state.new_start_pos > 0) {
    const { data } = await supabase
      .from('cards')
      .select('*')
      .eq('deck_id', deckId)
      .gte('sort_position', state.review_start_pos)
      .lt('sort_position', reviewEnd)
      .order('sort_position', { ascending: true });

    reviewCards = data ?? [];
  }

  // 상태 업데이트
  let nextReviewPos = reviewEnd;
  if (nextReviewPos >= state.new_start_pos) {
    nextReviewPos = 0; // 끝까지 갔으면 처음부터 다시
  }

  await supabase
    .from('deck_study_state')
    .upsert({
      deck_id: deckId,
      user_id: currentUserId,
      new_start_pos: newMaxPos,
      review_start_pos: nextReviewPos,
    });

  return { newCards, reviewCards };
}
```

**사용자 설정:**

- 새 카드 배치 크기 (기본 100, 범위 10~500)
- 복습 배치 크기 (기본 150, 범위 10~500)
- 설정은 모드 선택 화면에서 조절 가능

### 5.4 랜덤 모드

> 덱의 카드를 무작위로 섞어서 학습. SRS 없이 단순 학습/확인용.

**세션 흐름:**

1. 덱에서 카드를 랜덤 추출 (사용자가 설정한 수만큼)
2. 카드 앞면 → 뒤집기 → "알고 있다 / 모르겠다" (2버튼)
3. 다음 카드
4. SRS 파라미터에는 영향 없음

**카드 쿼리:**

```sql
SELECT * FROM cards
WHERE deck_id = $1
  AND srs_status != 'suspended'
ORDER BY RANDOM()
LIMIT $card_count;
```

**업로드 일자 필터 적용 시:**

```sql
SELECT * FROM cards
WHERE deck_id = $1
  AND srs_status != 'suspended'
  AND DATE(created_at AT TIME ZONE $tz) BETWEEN $start_date AND $end_date
ORDER BY RANDOM()
LIMIT $card_count;
```

**사용자 설정:**

- 학습할 카드 수 (기본 50, 범위 10~500)

### 5.5 순서대로 모드

> 카드를 sort_position 순서대로 학습. 중단한 위치를 기억.

**세션 흐름:**

1. 마지막으로 학습한 위치(position)부터 이어서 시작
2. 카드 앞면 → 뒤집기 → "다음" (1버튼)
3. 끝까지 가면 처음부터 다시

**상태 추적:**

`deck_study_state` 테이블에 `sequential_pos` 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `sequential_pos` | integer, default 0 | 순서대로 모드 현재 위치 |

**카드 쿼리:**

```sql
SELECT * FROM cards
WHERE deck_id = $1
  AND sort_position >= $current_pos
  AND srs_status != 'suspended'
ORDER BY sort_position ASC
LIMIT $card_count;
```

**사용자 설정:**

- 한 세션에서 학습할 카드 수 (기본 50, 범위 10~500)

### 5.6 업로드 일자별 학습

> 모든 학습 모드에 공통으로 적용할 수 있는 필터.

**동작:**

1. 모드 선택 화면에서 "업로드 일자" 필터 선택
2. 달력 UI에서 날짜 또는 날짜 범위 선택
3. 해당 기간에 추가된 카드만 대상으로 선택한 모드 적용

**예시:**

- SRS 모드 + 2026-02-10 필터 → 2월 10일에 추가된 카드 중 복습 예정인 것만 학습
- 랜덤 모드 + 2026-02-01 ~ 02-14 필터 → 해당 기간 카드 중 랜덤 학습
- 순차 복습 모드에서는 필터 비활성 (순서 기반이므로 날짜 필터와 상충)

---

## 6. SRS 엔진 (간격 반복 알고리즘)

### 6.1 알고리즘 개요

SM-2 변형 기반. 순수 함수로 구현하여 프론트엔드에서 실행.

### 6.2 핵심 파라미터

| 파라미터 | 초기값 | 범위 | 설명 |
|----------|--------|------|------|
| `ease_factor` | 2.5 | 1.3 ~ 4.0 | 난이도 계수. 높을수록 쉬운 카드 |
| `interval_days` | 0 | 0 ~ ∞ | 현재 복습 간격 (일) |
| `repetitions` | 0 | 0 ~ ∞ | 연속 정답 횟수 |
| `srs_status` | 'new' | new/learning/review | 카드 상태 |

### 6.3 응답 등급 및 처리 로직

```typescript
type Rating = 'again' | 'hard' | 'good' | 'easy';

interface SRSResult {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  srs_status: CardStatus;
  next_review_at: Date;
}

function calculateSRS(
  card: CardSRSState,
  rating: Rating,
  now: Date
): SRSResult {
  let { ease_factor, interval_days, repetitions } = card;

  // === AGAIN (완전히 까먹음) ===
  if (rating === 'again') {
    repetitions = 0;
    interval_days = 0;
    ease_factor = Math.max(1.3, ease_factor - 0.20);
    return {
      ease_factor,
      interval_days,
      repetitions,
      srs_status: 'learning',
      next_review_at: addMinutes(now, 10),
    };
  }

  // === HARD (어렵게 기억함) ===
  if (rating === 'hard') {
    ease_factor = Math.max(1.3, ease_factor - 0.15);
    if (repetitions === 0) {
      interval_days = 1;
    } else {
      interval_days = Math.ceil(interval_days * 1.2);
    }
    repetitions += 1;
  }

  // === GOOD (적당히 기억함) ===
  if (rating === 'good') {
    if (repetitions === 0) {
      interval_days = 1;
    } else if (repetitions === 1) {
      interval_days = 3;
    } else {
      interval_days = Math.ceil(interval_days * ease_factor);
    }
    repetitions += 1;
  }

  // === EASY (완벽히 기억함) ===
  if (rating === 'easy') {
    ease_factor = Math.min(4.0, ease_factor + 0.15);
    if (repetitions === 0) {
      interval_days = 4;
    } else {
      interval_days = Math.ceil(interval_days * ease_factor * 1.3);
    }
    repetitions += 1;
  }

  return {
    ease_factor,
    interval_days,
    repetitions,
    srs_status: 'review',
    next_review_at: addDays(now, interval_days),
  };
}
```

### 6.4 학습 큐 우선순위 (SRS 모드 전용)

하나의 학습 세션에서 카드를 가져오는 순서:

1. **Relearn** (Again으로 돌아온 카드): `srs_status = 'learning' AND next_review_at <= NOW()`
2. **Review** (복습 예정 카드): `srs_status = 'review' AND next_review_at <= NOW()`
3. **New** (신규 카드): `srs_status = 'new'`, 일일 한도 적용

```sql
-- 1. 복습 예정 카드
SELECT * FROM cards
WHERE user_id = $1 AND deck_id = $2
  AND srs_status IN ('learning', 'review')
  AND next_review_at <= NOW()
ORDER BY next_review_at ASC;

-- 2. 신규 카드 (일일 한도)
SELECT * FROM cards
WHERE user_id = $1 AND deck_id = $2
  AND srs_status = 'new'
ORDER BY sort_position ASC
LIMIT $daily_new_limit;
```

### 6.5 SRS 상태 전이

```
[New] ──(학습 시작)──→ [Learning]
                          │
                   ┌──────┼──────┐
                   │      │      │
                 Again   Good   Easy
                   │      │      │
                   ↓      ↓      ↓
              [Learning] [Review] [Review]
                   │        │
                   │    (다음 복습일 도래)
                   │        │
                   │    ┌───┼───┐
                   │  Again Hard Good Easy
                   │    │    │    │    │
                   └────┘    └────┴────┘
                              [Review]
                              (간격 증가)
```

---

## 7. 학습 인터페이스

### 7.1 학습 세션 흐름 (공통)

```
[덱 선택] → [모드 선택 + 필터] → [세션 시작] → [카드 표시 (앞면)]
                                                     │
                                                [사용자 생각]
                                                     │
                                             [Space 또는 클릭]
                                                     │
                                              [카드 뒤집기 (뒷면)]
                                                     │
                                    ┌────────────────┴────────────────┐
                                    │                                  │
                              SRS 모드:                         기타 모드:
                         Again Hard Good Easy                 알겠다 / 모르겠다
                          (1)  (2)  (3)  (4)                    또는 다음
                                    │                                  │
                                    └────────────────┬─────────────────┘
                                                     │
                                              [다음 카드 또는 세션 완료]
```

### 7.2 카드 표시 (템플릿 기반 렌더링)

> 카드의 앞면/뒷면은 `card_templates`의 `front_layout`/`back_layout` 설정에 따라 동적으로 렌더링.

**렌더링 로직 (React 컴포넌트):**

```typescript
interface LayoutItem {
  field_key: string;
  style: 'primary' | 'secondary' | 'hint' | 'detail' | 'media';
}

function CardFace({ layout, fieldValues, fields }: {
  layout: LayoutItem[];
  fieldValues: Record<string, string>;
  fields: FieldDef[];
}) {
  return (
    <div className="card-face">
      {layout.map((item) => {
        const field = fields.find(f => f.key === item.field_key);
        const value = fieldValues[item.field_key];
        if (!value) return null;

        switch (item.style) {
          case 'primary':
            return <div className="text-4xl font-bold text-center">{value}</div>;
          case 'secondary':
            return <div className="text-2xl text-center">{value}</div>;
          case 'hint':
            return <div className="text-xl text-gray-400 text-center">{value}</div>;
          case 'detail':
            return <div className="text-base text-gray-500 mt-2">{value}</div>;
          case 'media':
            if (field?.type === 'image') {
              return <img src={value} className="max-w-xs mx-auto mt-2" />;
            }
            if (field?.type === 'audio') {
              return <AudioPlayer src={value} />;
            }
        }
      })}
    </div>
  );
}
```

**뒤집기 애니메이션:**

- CSS `transform: rotateY(180deg)` 3D 플립
- `transition: transform 0.4s ease`
- 또는 Fade In/Out (성능 우선)

### 7.3 키보드 단축키

| 키 | 동작 | 상태 |
|----|------|------|
| `Space` | 카드 뒤집기 | 앞면 보는 중 |
| `Enter` | 카드 뒤집기 | 앞면 보는 중 |
| `1` | Again (SRS 모드) | 뒷면 보는 중 |
| `2` | Hard (SRS 모드) | 뒷면 보는 중 |
| `3` | Good (SRS 모드) | 뒷면 보는 중 |
| `4` | Easy (SRS 모드) | 뒷면 보는 중 |
| `→` 또는 `Space` | 다음 카드 (비SRS 모드) | 뒷면 보는 중 |
| `E` | 현재 카드 편집 | 뒷면 보는 중 |
| `Esc` | 학습 세션 종료 | 항상 |

### 7.4 프로그레스 바

- 상단 고정 (sticky)
- 표시: `{done} / {total}` + 퍼센트 바 + 현재 모드 아이콘
- 색상 변화: 0~50% 빨강 → 50~80% 노랑 → 80~100% 초록
- 세션 완료 시 요약 화면:
  - SRS 모드: "Again: 5, Hard: 12, Good: 28, Easy: 5"
  - 순차 복습 모드: "새 카드 100개, 복습 150개 완료. 다음 복습 위치: 301"
  - 기타 모드: "50개 카드 학습 완료"

---

## 8. TTS (무료 음성 합성)

> 무료 TTS만 사용. 유료 API 없음.

### 8.1 Web Speech API (기본, Phase 1)

브라우저 내장 무료 TTS. 서버 불필요.

```typescript
function speak(text: string, lang: string = 'zh-CN') {
  if (!window.speechSynthesis) return;

  // 이전 발화 중단
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;  // 약간 느리게
  utterance.pitch = 1.0;
  speechSynthesis.speak(utterance);
}
```

**특징:**

- 완전 무료, 서버 불필요
- Chrome/Edge: 온라인 시 고품질, 오프라인 시 저품질
- Safari/Firefox: 오프라인 가능, 음성 제한적
- 중국어, 영어, 한국어, 일본어 등 기본 지원

### 8.2 edge-tts (고품질, Phase 2 — Python 백엔드)

Microsoft Edge의 무료 TTS API를 활용하는 Python 라이브러리.
Web Speech API보다 음질이 좋고 음성 종류가 많다.

**FastAPI 엔드포인트:**

```python
# backend/app/api/tts.py
from fastapi import APIRouter, Response
import edge_tts

router = APIRouter()

VOICE_MAP = {
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'en-US': 'en-US-JennyNeural',
    'ko-KR': 'ko-KR-SunHiNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
}

@router.get("/tts")
async def generate_tts(text: str, lang: str = 'zh-CN'):
    voice = VOICE_MAP.get(lang, 'zh-CN-XiaoxiaoNeural')
    communicate = edge_tts.Communicate(text, voice)

    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]

    return Response(
        content=audio_data,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"}
    )
```

**프론트엔드에서 호출:**

```typescript
async function speakWithEdgeTTS(text: string, lang: string) {
  const url = `${BACKEND_URL}/tts?text=${encodeURIComponent(text)}&lang=${lang}`;
  const audio = new Audio(url);
  audio.play();
}
```

**특징:**

- 완전 무료 (Microsoft Edge TTS 엔진 사용)
- 고품질 Neural 음성
- 서버 필요 (FastAPI)
- 캐싱 가능 (같은 텍스트 → 같은 오디오)

### 8.3 재생 타이밍 & 설정

- **재생 시점:** 카드 뒤집힐 때, 앞면의 텍스트 자동 재생
  - TTS 대상 필드: `front_layout`의 첫 번째 text 필드
- **사용자 설정:**
  - TTS ON/OFF (profiles.tts_enabled)
  - TTS 언어 (profiles.tts_lang)
  - TTS 엔진 (profiles.tts_provider): 'web_speech' 또는 'edge_tts'
- **우선순위:** 카드에 audio 필드 값이 있으면 TTS 대신 업로드된 오디오 재생

---

## 9. 학습 로그 (Study Logs)

### 9.1 데이터 모델

**`study_logs` 테이블:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid (PK) | 로그 ID |
| `user_id` | uuid (FK) | 사용자 |
| `card_id` | uuid (FK → cards, CASCADE) | 카드 |
| `deck_id` | uuid (FK → decks) | 덱 (비정규화) |
| `study_mode` | text | 'srs' / 'sequential_review' / 'random' / 'sequential' |
| `rating` | text | SRS: 'again'/'hard'/'good'/'easy', 기타: 'known'/'unknown'/'viewed' |
| `prev_interval` | integer | 이전 간격 (SRS만) |
| `new_interval` | integer | 새 간격 (SRS만) |
| `prev_ease` | real | 이전 ease (SRS만) |
| `new_ease` | real | 새 ease (SRS만) |
| `review_duration_ms` | integer | 카드 보는 데 걸린 시간 (ms) |
| `studied_at` | timestamptz | 학습 시각 |

### 9.2 로그 기록

- **SRS 모드:** Again/Hard/Good/Easy 선택 시마다 기록
- **순차 복습 모드:** "알겠다/모르겠다" 선택 시 기록 (known/unknown)
- **랜덤/순서대로 모드:** 카드를 넘길 때마다 기록 (viewed)
- `review_duration_ms`: 카드 앞면 표시 ~ 응답 선택까지의 시간

---

## 10. 시각화 및 대시보드

### 10.1 ReeeCall 잔디 (Heatmap)

- GitHub Contribution Graph 스타일 365일 격자
- 색상 강도: 학습한 카드 수에 비례 (0, 1~10, 11~30, 31~60, 61+)
- 마우스 오버: "2026-02-14: 45장 학습"

```sql
SELECT
  DATE(studied_at AT TIME ZONE $timezone) AS study_date,
  COUNT(*) AS cards_studied
FROM study_logs
WHERE user_id = $1
  AND studied_at >= NOW() - INTERVAL '365 days'
GROUP BY study_date
ORDER BY study_date;
```

### 10.2 학습 현황 그래프

**일별 학습량 (Bar Chart):** X축 최근 30일, Y축 카드 수, 일일 목표선 표시

**모드별 학습 비율 (Pie Chart):** SRS / 순차복습 / 랜덤 / 순서대로 비율

**누적 학습 카드 (Line Chart):** 시간에 따른 학습 완료 카드 수 추이

**등급 분포 (SRS 모드, Donut Chart):** Again / Hard / Good / Easy 비율

### 10.3 덱별 통계

- 카드 상태 분포 바 (New / Learning / Review / Suspended)
- 업로드 일자별 카드 수 바 차트
- 평균 난이도 (avg ease_factor)
- 가장 어려운 카드 Top 10
- 순차 복습 모드 진행 상황: "복습 위치: 450 / 1000 (45%)"

### 10.4 망각 예측

```typescript
const forecastDays = 7;
for (let d = 0; d < forecastDays; d++) {
  const targetDate = addDays(today, d);
  const count = cards.filter(c =>
    isSameDay(c.next_review_at, targetDate)
  ).length;
  forecast.push({ date: targetDate, count });
}
```

- "이번 주 복습 예정" 미니 바 차트
- 50장 이상 몰린 날 경고

---

## 11. 오프라인 / PWA 지원

### 11.1 Service Worker

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default {
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ReeeCall Study',
        short_name: 'ReeeCall',
        theme_color: '#3B82F6',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', expiration: { maxEntries: 50 } },
          },
        ],
      },
    }),
  ],
};
```

### 11.2 오프라인 학습

- 학습 세션 시작 시 카드 데이터를 IndexedDB에 캐싱
- 오프라인 학습 결과는 `pending_syncs`에 임시 저장
- 온라인 복귀 시 자동 동기화

```typescript
window.addEventListener('online', async () => {
  const pending = await localDB.getAll('pending_syncs');
  for (const item of pending) {
    await supabase.from('study_logs').insert(item.log);
    await supabase.from('cards').update(item.cardUpdate).eq('id', item.cardId);
    await localDB.delete('pending_syncs', item.id);
  }
});
```

---

## 12. 데이터베이스 전체 스키마

```sql
-- ========================================
-- 0. Extensions
-- ========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 1. Profiles
-- ========================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  daily_new_limit INTEGER NOT NULL DEFAULT 20,
  default_study_mode TEXT NOT NULL DEFAULT 'srs'
    CHECK (default_study_mode IN ('srs', 'sequential_review', 'random', 'sequential')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  theme TEXT NOT NULL DEFAULT 'system',
  tts_enabled BOOLEAN NOT NULL DEFAULT true,
  tts_lang TEXT NOT NULL DEFAULT 'zh-CN',
  tts_provider TEXT NOT NULL DEFAULT 'web_speech'
    CHECK (tts_provider IN ('web_speech', 'edge_tts')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auth 회원가입 시 자동 프로필 생성
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ========================================
-- 2. Card Templates
-- ========================================
CREATE TABLE card_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]',
  front_layout JSONB NOT NULL DEFAULT '[]',
  back_layout JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE card_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own templates" ON card_templates
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_templates_user ON card_templates(user_id);

-- 신규 사용자에게 기본 템플릿 자동 생성
CREATE OR REPLACE FUNCTION create_default_templates()
RETURNS TRIGGER AS $$
BEGIN
  -- 기본 (앞/뒤) 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"}]',
    true
  );

  -- 중국어 단어 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]',
    true
  );

  -- 영어 단어 템플릿
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    NEW.id,
    '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]',
    '[{"field_key":"field_1","style":"primary"}]',
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]',
    true
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created_templates
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_templates();

-- ========================================
-- 3. Decks
-- ========================================
CREATE TABLE decks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_template_id UUID REFERENCES card_templates ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  icon TEXT NOT NULL DEFAULT '📚',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  next_position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own decks" ON decks FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_decks_user ON decks(user_id);

-- ========================================
-- 4. Cards
-- ========================================
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES card_templates ON DELETE RESTRICT,
  field_values JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  sort_position INTEGER NOT NULL DEFAULT 0,
  srs_status TEXT NOT NULL DEFAULT 'new'
    CHECK (srs_status IN ('new', 'learning', 'review', 'suspended')),
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  next_review_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own cards" ON cards FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_user ON cards(user_id);
CREATE INDEX idx_cards_review ON cards(user_id, next_review_at)
  WHERE srs_status IN ('learning', 'review');
CREATE INDEX idx_cards_position ON cards(deck_id, sort_position);
CREATE INDEX idx_cards_created ON cards(deck_id, created_at);
CREATE INDEX idx_cards_status ON cards(deck_id, srs_status);

-- ========================================
-- 5. Deck Study State (순차 복습 / 순서대로 모드 상태)
-- ========================================
CREATE TABLE deck_study_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  -- 순차 복습 모드 상태
  new_start_pos INTEGER NOT NULL DEFAULT 0,
  review_start_pos INTEGER NOT NULL DEFAULT 0,
  new_batch_size INTEGER NOT NULL DEFAULT 100,
  review_batch_size INTEGER NOT NULL DEFAULT 150,
  -- 순서대로 모드 상태
  sequential_pos INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, deck_id)
);

ALTER TABLE deck_study_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own study state" ON deck_study_state
  FOR ALL USING (auth.uid() = user_id);

-- ========================================
-- 6. Study Logs
-- ========================================
CREATE TABLE study_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards ON DELETE CASCADE,
  deck_id UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  study_mode TEXT NOT NULL
    CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential')),
  rating TEXT NOT NULL
    CHECK (rating IN ('again', 'hard', 'good', 'easy', 'known', 'unknown', 'viewed')),
  prev_interval INTEGER,
  new_interval INTEGER,
  prev_ease REAL,
  new_ease REAL,
  review_duration_ms INTEGER,
  studied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE study_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own logs" ON study_logs FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_logs_user_date ON study_logs(user_id, studied_at);
CREATE INDEX idx_logs_card ON study_logs(card_id);
CREATE INDEX idx_logs_deck_date ON study_logs(deck_id, studied_at);
CREATE INDEX idx_logs_mode ON study_logs(user_id, study_mode, studied_at);

-- ========================================
-- 7. updated_at 자동 갱신 트리거
-- ========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON card_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON decks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deck_study_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 8. RPC: 덱 통계 함수
-- ========================================
CREATE OR REPLACE FUNCTION get_deck_stats(p_user_id UUID)
RETURNS TABLE (
  deck_id UUID,
  deck_name TEXT,
  total_cards BIGINT,
  new_cards BIGINT,
  review_cards BIGINT,
  learning_cards BIGINT,
  last_studied TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'new'),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'review' AND c.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'learning' AND c.next_review_at <= NOW()),
    MAX(sl.studied_at)
  FROM decks d
  LEFT JOIN cards c ON c.deck_id = d.id
  LEFT JOIN study_logs sl ON sl.card_id = c.id
  WHERE d.user_id = p_user_id AND d.is_archived = false
  GROUP BY d.id, d.name
  ORDER BY d.sort_order, d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 9. RPC: 업로드 일자별 카드 수
-- ========================================
CREATE OR REPLACE FUNCTION get_upload_dates(p_deck_id UUID, p_timezone TEXT DEFAULT 'Asia/Seoul')
RETURNS TABLE (
  upload_date DATE,
  card_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(c.created_at AT TIME ZONE p_timezone),
    COUNT(*)
  FROM cards c
  WHERE c.deck_id = p_deck_id
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 13. Cloudflare Pages 배포

### 13.1 배포 설정

**Git 연동 자동 배포:**

1. GitHub 리포지토리 연결
2. 빌드 설정:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Build output directory: `dist`
3. 환경 변수:
   - `VITE_SUPABASE_URL` = `https://xxxxx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJhbGc...`
   - `VITE_BACKEND_URL` = `https://reeecall-api.up.railway.app` (Phase 2)

### 13.2 빌드 최적화

- Vite 코드 스플리팅 (라우트별 Lazy Loading)
- 이미지: WebP 변환, Lazy Loading
- Cloudflare 자동 캐싱 + Brotli 압축

---

## 14. Python 백엔드 (Phase 2)

> Phase 1에서는 Python 로컬 스크립트만 사용.
> Phase 2에서 FastAPI 서버를 추가하여 edge-tts, 고급 데이터 처리 등 지원.

### 14.1 FastAPI 서버 구조

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import bulk_import, tts, stats

app = FastAPI(title="ReeeCall Study API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://reeecall.pages.dev", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tts.router, prefix="/api")
app.include_router(bulk_import.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
```

### 14.2 배포 (Railway)

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```
# backend/requirements.txt
fastapi==0.115.*
uvicorn==0.34.*
edge-tts==7.*
supabase==2.*
```

Railway 무료 티어: 월 500시간 → 1인 사용 충분

---

## 15. 개발 로드맵

### Phase 1: 기반 구축 (1~2주)

- [ ] Supabase 프로젝트 생성 + 전체 스키마 마이그레이션
- [ ] Cloudflare Pages + Vite + React + TailwindCSS 초기화
- [ ] Supabase Auth 연동 (매직 링크 Passwordless 로그인)
- [ ] 보호 라우트 (Protected Route) 구현
- [ ] 카드 템플릿 CRUD + 기본 템플릿 자동 생성
- [ ] 덱 CRUD (목록, 생성, 수정, 삭제)
- [ ] 카드 CRUD (동적 필드 기반)

### Phase 2: 학습 모드 + 핵심 기능 (1~2주)

- [ ] SRS 알고리즘 구현 + 단위 테스트
- [ ] SRS 학습 모드 (카드 플립 UI + 평가 버튼)
- [ ] 순차 복습 모드 (deck_study_state 연동)
- [ ] 랜덤 모드
- [ ] 순서대로 모드
- [ ] 업로드 일자별 필터
- [ ] 학습 로그 기록
- [ ] 키보드 단축키 + 프로그레스 바

### Phase 3: Import + TTS (1주)

- [ ] Python Bulk Import 스크립트 (scripts/bulk_import.py)
- [ ] 웹 UI Import (JSON/CSV 파일 업로드)
- [ ] Export (JSON/CSV)
- [ ] Web Speech API TTS 연동
- [ ] Storage 연동 (이미지/오디오 업로드)
- [ ] 카드 템플릿 설정 UI (앞면/뒷면 레이아웃 편집)

### Phase 4: 대시보드 + 마무리 (1주)

- [ ] 잔디 히트맵
- [ ] 학습 현황 그래프
- [ ] 덱별 통계 + 업로드 일자별 통계
- [ ] 망각 예측 알림
- [ ] PWA 설정 (Service Worker, manifest)
- [ ] 오프라인 캐싱 기본 구현
- [ ] 다크 모드

### Phase 5: Python 백엔드 + 고도화 (향후)

- [ ] FastAPI 서버 구축 + Railway 배포
- [ ] edge-tts 고품질 TTS API
- [ ] Anki .apkg 파일 변환 스크립트
- [ ] 고급 검색 (태그 필터, 날짜 범위, 전체 텍스트 검색)
- [ ] 카드 드래그&드롭 정렬
- [ ] 성능 최적화 (가상 스크롤, 쿼리 최적화)
