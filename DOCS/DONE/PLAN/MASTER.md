# Reklue Study — Master Implementation Plan

> **Version**: 3.0
> **Created**: 2026-02-15
> **Status**: Phase 1–4 완료, Phase 5부터 진행 예정
> **Methodology**: TDD (Test → Implement → Build Verify)

---

## Phase Summary

| Phase | 이름 | 핵심 내용 | 상태 |
|-------|------|-----------|------|
| 1 | Foundation | Auth, Templates, Decks, Cards CRUD | ✅ 완료 |
| 2 | Study Modes | SRS, 순차복습, 랜덤, 순서대로 학습 4종 | ✅ 완료 |
| 3 | Import/Export + Storage + TTS | JSON/CSV 가져오기/내보내기, 파일 업로드, TTS 프로필 | ✅ 완료 |
| 4 | Dashboard Analytics | 잔디 히트맵, 차트, 예측 위젯, 덱별 통계 | ✅ 완료 |
| **5** | **Design Alignment** | 디자인 프로토타입 맞추기: 3D 플립, shadcn/ui, 라이트 테마, 페이지네이션, 날짜별 학습, 스와이프 | 🔲 다음 |
| 6 | Python Backend (FastAPI) | edge-tts 고품질 TTS, Anki 변환, Bulk API | 🔲 대기 |
| 7 | PWA + Offline | Service Worker, IndexedDB 캐싱, 오프라인 학습 | 🔲 대기 |
| 8 | Deploy + Ops | Cloudflare Pages 배포, CI/CD, 모니터링 | 🔲 대기 |

---

## 현재 구현 상태 Audit

### ✅ 구현 완료

| 기능 | 파일 |
|------|------|
| 매직 링크 인증 | `auth-store.ts`, `LoginPage.tsx`, `AuthCallback.tsx` |
| 프로필 설정 (일일 한도, TTS, 학습 모드) | `SettingsPage.tsx` |
| 템플릿 CRUD + 레이아웃 에디터 | `TemplateFormModal.tsx`, `template-store.ts` |
| 덱 CRUD + 통계 배지 | `DeckFormModal.tsx`, `deck-store.ts` |
| 카드 CRUD + 태그 | `CardFormModal.tsx`, `card-store.ts` |
| 카드 검색/필터/정렬 테이블 | `DeckDetailPage.tsx` |
| SRS 알고리즘 (SM-2 변형) | `srs.ts` (47 단위 테스트) |
| 학습 모드 4종 (SRS, 순차복습, 랜덤, 순서대로) | `study-store.ts`, `StudySessionPage.tsx` |
| 키보드 단축키 (Space, 1-4, Esc) | `useKeyboardShortcuts.ts` |
| 학습 요약 화면 | `StudySummary.tsx` |
| JSON/CSV Import/Export | `import-export.ts` (14 테스트), `ImportModal.tsx`, `ExportModal.tsx` |
| 이미지/오디오 Storage 업로드 | `storage.ts` (14 테스트), `CardFormModal.tsx` |
| TTS 프로필 연동 (Web Speech API) | `tts.ts` (6 테스트), `StudySessionPage.tsx` |
| Python Bulk Import CLI | `scripts/bulk_import.py` |

### ⚠️ 미구현 / Placeholder

| 기능 | 상태 | Phase |
|------|------|-------|
| 대시보드 히트맵 (react-calendar-heatmap 미사용) | 패키지만 설치됨 | 4 |
| 대시보드 차트 (recharts 미사용) | 패키지만 설치됨 | 4 |
| 이번 주 복습 예측 위젯 | 없음 | 4 |
| 덱별 상세 통계 탭 | 없음 | 4 |
| 업로드 일자 탭 (DeckDetailPage) | 없음 | 4 |
| 카드 플립 3D 애니메이션 | 상태 전환만, 애니메이션 없음 | 5 |
| 다크모드 / 테마 시스템 | 없음, 라이트 하드코딩 | 5 |
| 모바일 반응형 (햄버거 메뉴, 스와이프) | 부분적 | 5 |
| edge-tts 고품질 TTS | Web Speech만 지원 | 6 |
| FastAPI 백엔드 | 없음 | 6 |
| Anki 덱 변환기 (anki_convert.py) | 없음 | 6 |
| PWA manifest + Service Worker | 없음 | 7 |
| IndexedDB 오프라인 캐싱 | 없음 | 7 |
| Cloudflare Pages 배포 | 없음 | 8 |
| CI/CD 파이프라인 | 없음 | 8 |

---

## Phase 4: Dashboard Analytics

> **목표**: 학습 동기부여를 위한 시각화. 잔디 히트맵, 학습량 차트, 복습 예측, 덱별 통계.
> **의존 패키지**: react-calendar-heatmap (이미 설치), recharts (이미 설치)

### Step 4-0: 통계 데이터 레이어

#### 새 파일: `src/lib/stats.ts`

순수 함수 + Supabase 쿼리 헬퍼:

```
getHeatmapData(userId, timezone, days=365)
  → { date: string; count: number }[]

getDailyStudyCounts(userId, timezone, days=30)
  → { date: string; count: number; mode: StudyMode }[]

getModeDistribution(userId, days=30)
  → { mode: string; count: number }[]

getRatingDistribution(userId, deckId?, days=30)
  → { rating: string; count: number }[]

getForecastReviews(cards[], days=7)
  → { date: string; count: number }[]

getDeckStats(deckId)
  → { new, learning, review, suspended, avgEase, totalCards }

getHardestCards(deckId, limit=10)
  → Card[] (ease_factor ASC)

getUploadDateGroups(deckId)
  → { date: string; count: number }[]
```

#### 테스트 파일: `src/lib/__tests__/stats.test.ts`

| 테스트 | 설명 |
|--------|------|
| `getForecastReviews` 7일 예측 정확성 | next_review_at 기반 그룹핑 |
| `getRatingDistribution` 비율 계산 | again/hard/good/easy 집계 |
| `getUploadDateGroups` 날짜 그룹핑 | created_at → DATE 변환 |

### Step 4-1: 대시보드 리팩토링

#### 수정: `src/pages/DashboardPage.tsx`

현재 기본 카드 리스트 → 풀 대시보드로 교체:

```
┌─────────────────────────────────────────────────────┐
│  📊 대시보드                                         │
│                                                     │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│  │ 45   │ │ 1,234│ │ 89   │ │ 12일 │               │
│  │오늘   │ │전체   │ │복습   │ │연속   │              │
│  └──────┘ └──────┘ └──────┘ └──────┘               │
│                                                     │
│  ┌─ 잔디 히트맵 (365일) ─────────────────────────┐  │
│  │ ■ ■ ■ □ □ ■ ■ ■ ■ □ □ ■ ■ ...              │  │
│  │ ■ ■ □ □ □ ■ ■ ■ □ □ □ ■ ■ ...              │  │
│  │ 적음 ■ ■ ■ ■ 많음                             │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ 이번 주 복습 예정 ──┐ ┌─ 일별 학습량 (30일) ──┐ │
│  │ 월 ██████ 23       │ │ ▐█▐█▐█▐█▐█▐█▐█...   │ │
│  │ 화 ████ 15         │ │                       │ │
│  │ 수 ████████ 34     │ │                       │ │
│  │ ...                │ │                       │ │
│  └────────────────────┘ └───────────────────────┘ │
│                                                     │
│  ┌─ 최근 덱 바로가기 ───────────────────────────────┐│
│  │ 📚 HSK 5급  복습 34개  [학습 시작]               ││
│  │ 📖 영어     복습 12개  [학습 시작]               ││
│  └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

#### 새 컴포넌트:

| 파일 | 역할 |
|------|------|
| `src/components/dashboard/StatsSummaryCards.tsx` | 상단 4개 요약 카드 |
| `src/components/dashboard/StudyHeatmap.tsx` | 잔디 히트맵 (react-calendar-heatmap) |
| `src/components/dashboard/ForecastWidget.tsx` | 이번 주 복습 예측 바 차트 (recharts) |
| `src/components/dashboard/DailyStudyChart.tsx` | 일별 학습량 바 차트 (recharts) |
| `src/components/dashboard/RecentDecks.tsx` | 최근 학습 덱 바로가기 |

### Step 4-2: 덱 상세 통계 탭

#### 수정: `src/pages/DeckDetailPage.tsx`

카드 목록 위에 탭 추가:

```
[카드 목록] [업로드 일자] [통계]
```

#### 새 컴포넌트:

| 파일 | 역할 |
|------|------|
| `src/components/deck/UploadDateTab.tsx` | 업로드 일자별 그룹 + "이 날짜 카드만 학습" 버튼 |
| `src/components/deck/DeckStatsTab.tsx` | 카드 상태 분포, ease 분포, 어려운 카드 Top 10 |

### Step 4-3: 빌드 검증

```bash
npm run test        # 기존 47 + 신규 통계 테스트
npm run build       # TypeScript + Vite 빌드 성공
```

### 파일 요약 (Phase 4)

| 구분 | 파일 | 역할 |
|------|------|------|
| 새로 | `src/lib/stats.ts` | 통계 쿼리 + 순수 함수 |
| 새로 | `src/lib/__tests__/stats.test.ts` | 통계 단위 테스트 |
| 새로 | `src/components/dashboard/StatsSummaryCards.tsx` | 요약 카드 4종 |
| 새로 | `src/components/dashboard/StudyHeatmap.tsx` | 잔디 히트맵 |
| 새로 | `src/components/dashboard/ForecastWidget.tsx` | 복습 예측 |
| 새로 | `src/components/dashboard/DailyStudyChart.tsx` | 일별 학습량 |
| 새로 | `src/components/dashboard/RecentDecks.tsx` | 최근 덱 바로가기 |
| 새로 | `src/components/deck/UploadDateTab.tsx` | 업로드 일자 탭 |
| 새로 | `src/components/deck/DeckStatsTab.tsx` | 덱 통계 탭 |
| 수정 | `src/pages/DashboardPage.tsx` | 풀 대시보드 리팩토링 |
| 수정 | `src/pages/DeckDetailPage.tsx` | 탭 시스템 + 통계/업로드일자 |

---

## Phase 5: UX Polish

> **목표**: 카드 플립 애니메이션, 다크모드, 반응형 개선, Toast 알림 등 사용성 강화.

### Step 5-1: 카드 플립 3D 애니메이션

#### 수정: `src/components/study/StudyCard.tsx`

```
현재: isFlipped ? BackFace : FrontFace (즉시 전환)
목표: CSS perspective + rotateY(180deg) 3D 플립
```

- `perspective: 1000px` 컨테이너
- `.card-inner` → `transition: transform 0.5s`
- `.flipped .card-inner` → `transform: rotateY(180deg)`
- `.card-front` → `backface-visibility: hidden`
- `.card-back` → `backface-visibility: hidden; transform: rotateY(180deg)`

#### 새 파일: `src/components/study/FlipCard.css` (또는 Tailwind 커스텀)

### Step 5-2: 다크모드 / 테마 시스템

#### 아키텍처:

```
profiles.theme → 'light' | 'dark' | 'system'
                      ↓
ThemeProvider (Context)
                      ↓
<html class="dark"> 또는 <html class="light">
                      ↓
Tailwind dark: 변형 사용
```

#### 새 파일:

| 파일 | 역할 |
|------|------|
| `src/hooks/useTheme.ts` | 테마 감지 + 토글 훅 |
| `src/components/common/ThemeProvider.tsx` | 전역 테마 Context |

#### 수정 파일:

| 파일 | 변경 |
|------|------|
| `src/index.css` | Tailwind `@custom-variant dark` 또는 `darkMode: 'class'` |
| `src/pages/SettingsPage.tsx` | 테마 3종 선택 UI 추가 |
| 전체 컴포넌트 | `bg-white` → `bg-white dark:bg-gray-900` 등 dark 변형 추가 |

### Step 5-3: 반응형 강화

#### 수정: `src/components/common/Layout.tsx`

```
PC (1024px+):    상단 네비게이션 전체 표시
태블릿 (768px):  아이콘만 + 라벨 숨김
모바일 (<768px): 햄버거 메뉴 → 슬라이드 오버레이
```

#### 새 컴포넌트:

| 파일 | 역할 |
|------|------|
| `src/components/common/MobileNav.tsx` | 모바일 햄버거 + 슬라이드 메뉴 |

#### 학습 화면 모바일 최적화:

- 카드: `max-w-full` + `px-4`
- 버튼: 하단 고정 (`fixed bottom-0`)
- 스와이프 제스처 (선택): `touch-action` + pointer events

### Step 5-4: Toast 알림 시스템

#### 새 파일:

| 파일 | 역할 |
|------|------|
| `src/components/common/Toast.tsx` | 토스트 UI 컴포넌트 |
| `src/stores/toast-store.ts` | Zustand 토스트 상태 관리 |

- 성공: 초록 배경, 2초 자동 닫힘
- 에러: 빨강 배경, 수동 닫힘
- 사용: Import 완료, 카드 저장, 에러 발생 등

### 파일 요약 (Phase 5)

| 구분 | 파일 수 | 핵심 |
|------|---------|------|
| 새로 | ~6개 | FlipCard CSS, useTheme, ThemeProvider, MobileNav, Toast, toast-store |
| 수정 | ~15개+ | 전체 컴포넌트 dark 변형 추가, Layout 반응형, StudyCard 애니메이션 |

---

## Phase 6: Python Backend (FastAPI)

> **목표**: edge-tts 고품질 TTS, Anki 변환 API, 서버사이드 Bulk Import API.
> **배포**: Railway 무료 티어 또는 Fly.io.

### Step 6-1: FastAPI 프로젝트 초기화

#### 새 디렉토리: `backend/`

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py             # FastAPI app, CORS, lifespan
│   ├── core/
│   │   ├── config.py       # Settings (pydantic-settings)
│   │   └── database.py     # Supabase client (service key)
│   ├── api/
│   │   ├── __init__.py
│   │   ├── tts.py          # edge-tts 엔드포인트
│   │   ├── bulk_import.py  # 서버사이드 Bulk Import
│   │   └── anki.py         # Anki 덱 변환
│   └── services/
│       ├── tts_engine.py   # edge-tts 래퍼 + 캐싱
│       └── anki_parser.py  # .apkg 파싱 로직
├── tests/
│   ├── test_tts.py
│   ├── test_bulk_import.py
│   └── test_anki.py
├── requirements.txt
├── Dockerfile
└── railway.toml (또는 fly.toml)
```

### Step 6-2: edge-tts 고품질 TTS

#### `backend/app/api/tts.py`

```
GET /api/tts?text={text}&lang={lang}
  → audio/mpeg 스트리밍 응답

음성 매핑:
  zh-CN → zh-CN-XiaoxiaoNeural
  en-US → en-US-JennyNeural
  ko-KR → ko-KR-SunHiNeural
  ja-JP → ja-JP-NanamiNeural

캐싱: hash(text + lang) → 파일 캐시 (24h TTL)
```

#### 프론트엔드 연동:

```
수정: src/lib/tts.ts
  - speakWithEdgeTTS(text, lang) 추가
  - profile.tts_provider === 'edge_tts' → 백엔드 API 호출

수정: src/pages/SettingsPage.tsx
  - TTS 엔진 선택: Web Speech API / edge-tts 라디오 버튼
```

### Step 6-3: Anki 덱 변환

#### `backend/app/api/anki.py`

```
POST /api/anki/convert
  Body: multipart/form-data (file: .apkg)
  → JSON { cards: [...], fields: [...] }

내부 로직:
  1. .apkg = ZIP 파일 → collection.anki2 (SQLite DB) 추출
  2. SQLite에서 notes, cards, fields 쿼리
  3. HTML 태그 strip → 순수 텍스트
  4. media/ 폴더 내 이미지/오디오 → Supabase Storage 업로드
  5. 변환된 JSON 응답
```

#### `scripts/anki_convert.py` (로컬 CLI 버전)

```
python anki_convert.py my_deck.apkg --deck-id X --user-id Y --template-id Z
  → 1. .apkg 파싱
  → 2. Supabase에 카드 삽입
  → 3. 미디어 파일 Storage 업로드
```

### Step 6-4: 서버사이드 Bulk Import API

#### `backend/app/api/bulk_import.py`

```
POST /api/bulk-import
  Body: { deck_id, template_id, cards: [...] }
  Headers: Authorization: Bearer {supabase_jwt}
  → { inserted: N, skipped: M }

장점: 브라우저 Import보다 대량 (10,000+) 처리에 유리
```

### 파일 요약 (Phase 6)

| 구분 | 파일 수 | 핵심 |
|------|---------|------|
| 새로 | ~15개 | backend/ 전체 디렉토리 |
| 새로 | 1개 | `scripts/anki_convert.py` |
| 수정 | 2개 | `tts.ts` (edge-tts 추가), `SettingsPage.tsx` (엔진 선택) |

### 의존성

```
# backend/requirements.txt
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
edge-tts>=7.0.0
supabase>=2.0.0
python-dotenv>=1.0.0
python-multipart>=0.0.20
aiofiles>=24.0.0
```

---

## Phase 7: PWA + Offline

> **목표**: 오프라인에서도 학습 가능. Service Worker로 앱 캐싱, IndexedDB로 학습 데이터 로컬 저장.

### Step 7-1: PWA 기본 설정

#### 패키지 설치

```bash
npm install -D vite-plugin-pwa
```

#### 수정: `vite.config.ts`

```ts
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Reklue Study',
        short_name: 'Reklue',
        description: '플래시카드 학습 앱',
        theme_color: '#3B82F6',
        background_color: '#F9FAFB',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'media-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 * 7 },
            },
          },
        ],
      },
    }),
  ],
})
```

#### 새 파일: `public/icon-192.png`, `public/icon-512.png`

### Step 7-2: IndexedDB 오프라인 데이터

#### 패키지 설치

```bash
npm install idb
```

#### 새 파일: `src/lib/offline-db.ts`

```
스키마:
  cards: { id, deck_id, template_id, field_values, tags, srs_* }
  pending_syncs: { id, type, payload, created_at }

함수:
  cacheStudySession(cards[]) → IndexedDB에 카드 저장
  savePendingSync(type, payload) → 오프라인 학습 결과 임시 저장
  syncPending() → 온라인 복귀 시 Supabase에 동기화
  clearCache(deckId) → 캐시 정리
```

#### 수정: `src/stores/study-store.ts`

```
initSession() 시:
  1. Supabase에서 카드 fetch
  2. IndexedDB에 캐싱 (cacheStudySession)
  3. 오프라인 감지 시 IndexedDB에서 로드

rateCard() 시:
  - 온라인: 기존 Supabase 직접 업데이트
  - 오프라인: savePendingSync()로 임시 저장
```

#### 새 파일: `src/hooks/useOnlineStatus.ts`

```ts
// navigator.onLine + 이벤트 리스너로 온/오프라인 감지
// 온라인 복귀 시 자동 동기화 트리거
```

### Step 7-3: 오프라인 UX

#### 새 컴포넌트:

| 파일 | 역할 |
|------|------|
| `src/components/common/OfflineBanner.tsx` | 상단 경고 배너 "오프라인 모드" |
| `src/components/common/SyncIndicator.tsx` | 동기화 상태 아이콘 (✓ / ↻ / ⚠️) |

### 파일 요약 (Phase 7)

| 구분 | 파일 수 | 핵심 |
|------|---------|------|
| 새로 | ~7개 | offline-db, useOnlineStatus, OfflineBanner, SyncIndicator, 아이콘 |
| 수정 | ~4개 | vite.config.ts, study-store.ts, index.html, Layout.tsx |

---

## Phase 8: Deploy + Ops

> **목표**: Cloudflare Pages 배포, CI/CD 자동화, 모니터링.

### Step 8-1: Cloudflare Pages 설정

#### 새 파일: `wrangler.toml`

```toml
name = "reeecall-study"
compatibility_date = "2026-02-15"

[site]
bucket = "./dist"
```

#### GitHub Actions CI/CD

#### 새 파일: `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run test
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          command: pages deploy dist --project-name=reeecall-study
```

### Step 8-2: Python Backend 배포 (Phase 6 이후)

#### Railway 배포

```
# backend/railway.toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
```

#### 또는 Fly.io

```
# backend/fly.toml
app = "reeecall-api"

[http_service]
  internal_port = 8000
  auto_stop_machines = true
```

### Step 8-3: 환경 변수 / 시크릿 관리

```
# Frontend (.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_BACKEND_URL=          # Phase 6 이후

# Backend (.env)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
CORS_ORIGINS=
```

### Step 8-4: 모니터링

- **Cloudflare Analytics**: 페이지 뷰, 에러율
- **Supabase Dashboard**: DB 쿼리 성능, Storage 사용량
- **Sentry (선택)**: 프론트엔드 에러 트래킹

### 파일 요약 (Phase 8)

| 구분 | 파일 수 | 핵심 |
|------|---------|------|
| 새로 | ~4개 | wrangler.toml, deploy.yml, railway.toml, .env.example 업데이트 |

---

## 구현 순서 의존성 그래프

```
Phase 4 (Dashboard Analytics)
  ↓ — 독립, 바로 시작 가능
Phase 5 (UX Polish)
  ↓ — Phase 4와 병렬 가능
Phase 6 (Python Backend)
  ↓ — Phase 5 다크모드 후가 이상적 (설정 UI에 엔진 선택 통합)
Phase 7 (PWA + Offline)
  ↓ — Phase 5 이후 (다크모드 포함된 상태에서 캐싱)
Phase 8 (Deploy)
  ↓ — 언제든 가능, Phase 6 이후 백엔드 배포 추가
```

**추천 실행 순서**:

```
Phase 4 ━━━━━━━━━━━━━━━┓
Phase 5 ━━━━━━━━━━━━━━━━╋━ 병렬 가능 ━━▶ Phase 6 ━━▶ Phase 7 ━━▶ Phase 8
                        ┃
                        ┗━ Phase 8-1 (CF 배포)만 먼저 가능
```

---

## 검증 체크리스트 (Phase별)

### Phase 4

- [ ] `npm test` — 통계 순수 함수 테스트 통과
- [ ] `npm run build` — 빌드 성공
- [ ] 대시보드에 잔디 히트맵 365일 표시
- [ ] 대시보드에 이번 주 복습 예측 바 차트 표시
- [ ] 대시보드에 일별 학습량 30일 바 차트 표시
- [ ] 덱 상세 → 업로드 일자 탭 → 날짜별 카드 수 + "이 날짜만 학습" 버튼
- [ ] 덱 상세 → 통계 탭 → 상태 분포, 어려운 카드 Top 10

### Phase 5

- [ ] 학습 화면에서 카드 플립 시 3D 애니메이션 동작
- [ ] 설정에서 다크모드 토글 → 전체 UI 즉시 반영
- [ ] `prefers-color-scheme: dark` → 시스템 설정 자동 추종
- [ ] 모바일(375px)에서 햄버거 메뉴 동작
- [ ] 학습 화면 모바일: 버튼 하단 고정, 풀스크린
- [ ] Toast 알림 동작 (Import 완료, 에러 등)

### Phase 6

- [ ] `python -m pytest backend/tests` — 백엔드 테스트 통과
- [ ] `GET /api/tts?text=你好&lang=zh-CN` → MP3 응답
- [ ] 프론트에서 edge-tts 선택 → 고품질 음성 재생
- [ ] `POST /api/anki/convert` → .apkg 파일 변환 성공
- [ ] `scripts/anki_convert.py` → 로컬 CLI 변환 성공

### Phase 7

- [ ] 브라우저에서 "앱으로 추가" 프롬프트 표시
- [ ] 오프라인 전환 후 학습 세션 정상 동작
- [ ] 온라인 복귀 시 pending_syncs 자동 동기화
- [ ] Storage 미디어 오프라인 캐시에서 로드

### Phase 8

- [ ] `git push main` → CI 테스트 → 빌드 → Cloudflare 자동 배포
- [ ] Production URL에서 전체 기능 정상 동작
- [ ] HTTPS, CDN, 글로벌 접근 확인

---

## 참고 문서

| 문서 | 경로 |
|------|------|
| 기능 명세서 | `Reklue_Feature_Spec.md` |
| 디자인 프롬프트 | `design-prompt.md` |
| 환경 변수 예시 | `.env.example` |
| DB 마이그레이션 | `supabase/migrations/` |
| Phase 3 구현 테스트 | `src/lib/__tests__/` (47 테스트) |
