# Phase 5: Design Alignment — 디자인 프로토타입 맞추기

> **Version**: 1.0
> **Created**: 2026-02-15
> **Status**: 계획 완료, 구현 대기
> **기반**: `Reklue Study UI_UX Design/` 디자인 프로토타입 vs 현재 구현 비교

---

## 변경 사항 요약

| # | 항목 | 결정 | 난이도 |
|---|------|------|--------|
| 1 | 카드 플립 3D 애니메이션 | 해결 (motion/react 사용) | ★★★ |
| 2 | 카드 테이블 페이지네이션 | 추가 (클라이언트 사이드) | ★★ |
| 3 | 덱 카드 왼쪽 컬러 바 | 디자인 반영 | ★ |
| 4 | 날짜별 학습 모드 (5번째 모드) | 학습모드 추가 | ★★★ |
| 5 | 학습 세션 라이트 테마 | 디자인 반영 (dark→light) | ★★ |
| 6 | 프로그레스 바 그라디언트 | 디자인 반영 (red→amber→green) | ★ |
| 7 | shadcn/ui 컴포넌트 도입 | 디자인 반영 (Dialog 등) | ★★★ |
| 8 | 스와이프 제스처 설정 | 디자인 반영 (설정 페이지에 추가) | ★★ |

> 9-12 (대시보드 차트, TTS 설정, 템플릿 기능, Import/Export) → **현재 구현 유지**

---

## Step 1: shadcn/ui 기반 컴포넌트 도입

### 1-1. 패키지 설치

```bash
npm install motion           # Framer Motion (motion/react)
npm install @radix-ui/react-dialog @radix-ui/react-slot
npm install class-variance-authority clsx tailwind-merge
npm install sonner            # Toast 라이브러리
npm install lucide-react      # 아이콘 (기존 이모지 대체)
```

### 1-2. 유틸리티: `src/lib/utils.ts`

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 1-3. shadcn/ui Dialog 컴포넌트: `src/components/ui/dialog.tsx`

디자인 프로토타입의 `dialog.tsx` 기반으로 Radix UI Dialog 래퍼 생성:
- `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`
- `DialogOverlay` — 백드롭 + fade 애니메이션
- `DialogContent` — 중앙 모달 + zoom 애니메이션 + close 버튼
- `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`

### 1-4. 기존 모달 마이그레이션

현재 커스텀 모달 패턴을 shadcn/ui Dialog로 교체:

| 파일 | 변경 |
|------|------|
| `CardFormModal.tsx` | `{open && <div>...` → `<Dialog open={open}>` |
| `DeckFormModal.tsx` | 동일 |
| `TemplateFormModal.tsx` | 동일 |
| `ConfirmDialog.tsx` | 동일 |
| `ImportModal.tsx` | 동일 |
| `ExportModal.tsx` | 동일 |

### 1-5. Sonner Toast 통합

디자인은 sonner를 사용. 현재 구현은 toast 없음 (alert/console만).

- `src/App.tsx`에 `<Toaster />` 추가
- 기존 `alert()`, `console.error()` 호출 → `toast.success()`, `toast.error()` 로 교체
- 대상 파일: `CardFormModal`, `DeckFormModal`, `ImportModal`, `ExportModal`, `SettingsPage`

---

## Step 2: 카드 플립 3D 애니메이션

### 현재 상태

`StudyCard.tsx`: `isFlipped` 상태에 따라 front/back 레이아웃을 즉시 전환. 애니메이션 없음.

### 목표 (디자인 프로토타입 참고)

디자인은 `motion/react` (Framer Motion)의 `rotateY` 3D 플립 사용:

```
perspective: 1000px 컨테이너
  └ motion.div (rotateY: flipped ? 180 : 0, duration: 0.4s)
    └ transformStyle: 'preserve-3d'
    └ Front: backfaceVisibility: 'hidden', display: flipped ? 'none' : 'flex'
    └ Back: backfaceVisibility: 'hidden', transform: rotateY(180deg), display: flipped ? 'flex' : 'none'
```

### 수정: `src/components/study/StudyCard.tsx`

1. `motion` import from `motion/react`
2. `AnimatePresence` + `motion.div` 래퍼 추가
3. 외부 컨테이너: `style={{ perspective: '1000px' }}`
4. 내부 카드: `motion.div` with `animate={{ rotateY: isFlipped ? 180 : 0 }}`
5. Front face: `backfaceVisibility: 'hidden'`
6. Back face: `backfaceVisibility: 'hidden'`, `transform: 'rotateY(180deg)'`
7. `AnimatePresence mode="wait"` — 카드 전환 시 fade in/out

### 카드 영역 스타일 (디자인 기반)

```
- 카드: bg-white rounded-2xl shadow-lg border border-gray-200 min-h-[400px]
- Front 텍스트: text-5xl font-bold text-gray-900
- Back 작은 라벨: text-xl text-gray-400
- Back 메인 텍스트: text-4xl font-bold text-gray-900
```

---

## Step 3: 학습 세션 라이트 테마 + 프로그레스 바 그라디언트

### 현재 상태

`StudySessionPage.tsx`: `bg-gray-900` (다크 배경), 텍스트 `text-gray-400/500`, 버튼 `bg-gray-700`

### 목표 (디자인 기반)

디자인은 라이트 테마 `bg-gray-50`:

| 요소 | 현재 | 디자인 |
|------|------|--------|
| 배경 | `bg-gray-900` | `bg-gray-50` |
| 프로그레스 바 배경 | `bg-gray-700` | `bg-gray-200` |
| 프로그레스 바 fill | `bg-blue-500` | `bg-gradient-to-r from-red-500 via-amber-500 to-green-500` |
| 종료 버튼 | `text-gray-400` | X 아이콘 (`lucide-react`) `text-gray-500` |
| 카운트 텍스트 | `text-gray-400` | `text-gray-700 font-medium` |
| 플립 힌트 | `text-gray-400` | `text-gray-400 text-sm` |
| 카드 뒤집기 버튼 | `bg-gray-700` | 없음 (카드 클릭으로 뒤집기) |
| 레이팅 버튼 | 현재 스타일 유지 | 디자인: `py-4`, Again=red, Hard=amber, Good=blue, Easy=green |
| 노카드 화면 | `bg-gray-900` | `bg-gray-50` |
| 로딩 화면 | `bg-gray-900` | `bg-gray-50` |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `StudySessionPage.tsx` | 배경색, 텍스트 색상, 레이아웃 구조 변경 |
| `StudyProgressBar.tsx` | 그라디언트 fill, 라이트 배경 |
| `SrsRatingButtons.tsx` | 색상 매핑: Again=red, Hard=amber, Good=blue, Easy=green |
| `StudyCard.tsx` | 카드 스타일링: white card, shadow, rounded-2xl |
| `StudySummary.tsx` | 라이트 배경 적용 |

### 수정: `src/components/study/StudyProgressBar.tsx`

```
현재: h-2 bg-gray-700 → fill bg-blue-500
목표: h-1 bg-gray-200 → fill bg-gradient-to-r from-red-500 via-amber-500 to-green-500
```

---

## Step 4: 덱 카드 왼쪽 컬러 바

### 현재 상태

`DeckListPage.tsx`의 덱 카드: 아이콘 + 이름 + 설명. 컬러 바 없음.

### 목표 (디자인 기반)

```
┌──────────────────────────────┐
│█│ 📚 영어 단어                │
│█│ 영어 단어 학습              │
│█│ 생성일: 2026-02-14          │
│█│                             │
│█│ ─────────────────────────── │
│█│ [학습 시작]                  │
└──────────────────────────────┘
 ↑ deck.color 컬러바 (4px)
```

### 수정: `src/pages/DeckListPage.tsx` (DeckCard 컴포넌트)

- 카드 `<Link>` 래퍼에 `relative overflow-hidden` 추가
- 왼쪽에 `absolute left-0 top-0 bottom-0 w-1 rounded-l-xl` div 추가
- `style={{ backgroundColor: deck.color }}` 적용

---

## Step 5: 카드 테이블 클라이언트 사이드 페이지네이션

### 현재 상태

`DeckDetailPage.tsx`: 필터링된 전체 카드를 한 번에 렌더링. 페이지네이션 없음.

### 목표 (디자인 기반)

디자인의 페이지네이션:
- 페이지당 카드 수 선택: 10 | 20 | 30 | 50 | 100
- 페이지 네비게이션: ← 1 2 3 ... 10 →
- "1~20 / 총 300장" 표시

### 구현 방식: 클라이언트 사이드 (1인용 앱, 카드 수 제한적)

### 수정: `src/pages/DeckDetailPage.tsx`

상태 추가:
```ts
const [currentPage, setCurrentPage] = useState(1)
const [cardsPerPage, setCardsPerPage] = useState(20)
```

로직:
```ts
const totalPages = Math.ceil(filteredCards.length / cardsPerPage)
const startIdx = (currentPage - 1) * cardsPerPage
const endIdx = startIdx + cardsPerPage
const paginatedCards = filteredCards.slice(startIdx, endIdx)
```

UI 요소:
1. 테이블 아래에 페이지네이션 바 추가
2. "페이지당" 드롭다운 (10/20/30/50/100)
3. 이전/다음 버튼
4. 페이지 번호 버튼 (ellipsis 포함)
5. "N~M / 총 X장" 텍스트

필터/검색 변경 시 `setCurrentPage(1)` 리셋

---

## Step 6: 날짜별 학습 모드 (5번째 모드)

### 현재 상태

4개 학습 모드: `srs`, `sequential_review`, `random`, `sequential`
`random` 모드에 `dateStart`/`dateEnd` 필터가 있지만 별도 모드는 아님.

### 목표 (디자인 기반)

디자인에는 5번째 모드 **📅 날짜별 학습**이 존재:
- 달력 UI (DatePicker) → 날짜 선택
- 선택한 날짜에 추가된 카드만 학습
- 해당 날짜에 카드가 있는 날 표시 (dot/highlight)
- 선택 날짜의 카드 수 표시

### 타입 변경: `src/types/database.ts`

```ts
// StudyMode에 'by_date' 추가
export type StudyMode = 'srs' | 'sequential_review' | 'random' | 'sequential' | 'by_date'
```

### 수정: `src/pages/StudySetupPage.tsx`

1. `modeOptions`에 5번째 추가:
   ```ts
   { value: 'by_date', label: '📅 날짜별', desc: '특정 날짜에 추가된 카드만 학습합니다' }
   ```

2. `mode === 'by_date'` 일 때 DatePicker 컴포넌트 표시:
   - 달력 UI (커스텀 구현, 디자인 프로토타입 참고)
   - 월 이동 (이전/다음)
   - 카드가 있는 날짜 하이라이트
   - 선택된 날짜 파란 배경
   - 오늘 날짜 링 표시
   - 선택 날짜의 카드 수 표시

3. 학습 시작 시:
   ```ts
   // dateStart = 선택 날짜 시작 (00:00:00)
   // dateEnd = 선택 날짜 끝 (23:59:59)
   params.set('dateStart', selectedDate + 'T00:00:00')
   params.set('dateEnd', selectedDate + 'T23:59:59')
   ```

### 새 컴포넌트: `src/components/study/DatePicker.tsx`

디자인 프로토타입의 DatePicker 기반:
- Props: `selectedDate`, `onSelectDate`, `availableDates` (카드가 있는 날짜들)
- 월 단위 네비게이션
- 7열 그리드 (일~토)
- 카드 있는 날: 도트 또는 하이라이트
- 오늘: 테두리 링
- 선택된 날: 파란 배경

### 수정: `src/stores/study-store.ts`

`initSession`에 `by_date` case 추가:
```ts
case 'by_date': {
  let query = supabase
    .from('cards')
    .select('*')
    .eq('deck_id', config.deckId)
    .neq('srs_status', 'suspended')

  if (config.uploadDateStart) {
    query = query.gte('created_at', config.uploadDateStart)
  }
  if (config.uploadDateEnd) {
    query = query.lte('created_at', config.uploadDateEnd)
  }

  const { data } = await query.order('sort_position', { ascending: true })
  cards = (data ?? []) as Card[]
  break
}
```

### StudySetupPage에서 카드 날짜 통계 fetch

월 변경 시 해당 월의 카드 수 쿼리:
```ts
const { data } = await supabase
  .from('cards')
  .select('created_at')
  .eq('deck_id', deckId)
  .gte('created_at', monthStart)
  .lte('created_at', monthEnd)
```

→ 날짜별 카드 수 맵 생성 → DatePicker에 전달

---

## Step 7: 스와이프 제스처 설정

### 현재 상태

`SettingsPage.tsx`: 프로필, 학습 설정, TTS만 있음. 스와이프 설정 없음.

### 목표 (디자인 기반)

설정 페이지에 스와이프 제스처 섹션 추가:
- 스와이프 활성화 토글
- 4방향 액션 매핑:
  - ← 왼쪽: Again/Hard/Good/Easy 중 선택
  - → 오른쪽: Again/Hard/Good/Easy 중 선택
  - ↑ 위: Again/Hard/Good/Easy 중 선택
  - ↓ 아래: Again/Hard/Good/Easy 중 선택
- 추천 설정 안내: "왼쪽=Again, 오른쪽=Good"

### 데이터 저장

디자인은 localStorage 사용. 현재 구현은 Supabase profiles 테이블 사용.

→ profiles 테이블에 `swipe_settings jsonb` 컬럼 추가 (또는 localStorage로 간단히 처리)

**선택: localStorage 사용** (스와이프 설정은 디바이스 고유 → 서버 동기화 불필요)

```ts
interface SwipeSettings {
  enabled: boolean
  left: 'again' | 'hard' | 'good' | 'easy'
  right: 'again' | 'hard' | 'good' | 'easy'
  up: 'again' | 'hard' | 'good' | 'easy'
  down: 'again' | 'hard' | 'good' | 'easy'
}
```

### 수정: `src/pages/SettingsPage.tsx`

새 섹션 추가 (TTS 아래):
- 스와이프 활성화 체크박스
- 4방향 드롭다운 (again/hard/good/easy)
- 방향별 화살표 아이콘 (lucide-react)
- localStorage에 저장 (`reeecall-swipe-settings`)

### 수정: `src/pages/StudySessionPage.tsx` + `src/components/study/StudyCard.tsx`

- StudyCard에 touch 이벤트 핸들러 추가 (touchStart, touchMove, touchEnd)
- swipe threshold: 100px
- 방향 감지 후 해당 rating 실행
- 스와이프 중 시각적 피드백 (카드 기울기/이동)

디자인 프로토타입의 스와이프 로직 참고:
```ts
SWIPE_THRESHOLD = 100
수평 > 수직 → left/right 판단
수직 > 수평 → up/down 판단
```

---

## Step 8: Lucide-react 아이콘 마이그레이션

### 현재 상태

이모지 아이콘: 📚, ⚙️, 📊, ✕, 🔊 등

### 목표 (디자인 기반)

lucide-react 아이콘: `X`, `Volume2`, `BookOpen`, `Plus`, `MoreVertical`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`

### 수정 대상

| 파일 | 변경 |
|------|------|
| `Layout.tsx` | 네비게이션 이모지 → lucide 아이콘 |
| `StudySessionPage.tsx` | ✕ → `<X />`, 🔊 → `<Volume2 />` |
| `DeckDetailPage.tsx` | ← → `<ArrowLeft />` |
| `StudySetupPage.tsx` | ← → `<ArrowLeft />` |
| `DeckListPage.tsx` | + 버튼 → `<Plus />` |

---

## 파일 요약

### 새로 생성 (5개)

| # | 파일 | 역할 |
|---|------|------|
| 1 | `src/lib/utils.ts` | cn() 유틸리티 (clsx + twMerge) |
| 2 | `src/components/ui/dialog.tsx` | shadcn/ui Dialog (Radix 기반) |
| 3 | `src/components/study/DatePicker.tsx` | 날짜별 학습 달력 UI |
| 4 | `src/components/study/FlipCard.tsx` | (선택) 별도 분리 시 |
| 5 | — | — |

### 수정 (14개)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `package.json` | motion, @radix-ui, sonner, lucide-react, clsx, tailwind-merge 추가 |
| 2 | `src/App.tsx` | `<Toaster />` 추가 |
| 3 | `src/types/database.ts` | `StudyMode`에 `'by_date'` 추가 |
| 4 | `src/components/study/StudyCard.tsx` | 3D 플립 애니메이션 (motion/react) |
| 5 | `src/components/study/StudyProgressBar.tsx` | 그라디언트 fill + 라이트 배경 |
| 6 | `src/components/study/SrsRatingButtons.tsx` | 디자인 색상 매핑 |
| 7 | `src/pages/StudySessionPage.tsx` | 라이트 테마, 스와이프, lucide 아이콘 |
| 8 | `src/pages/StudySetupPage.tsx` | by_date 모드 + DatePicker |
| 9 | `src/pages/DeckDetailPage.tsx` | 페이지네이션 추가 |
| 10 | `src/pages/DeckListPage.tsx` | 덱 카드 컬러 바 |
| 11 | `src/pages/SettingsPage.tsx` | 스와이프 제스처 설정 섹션 |
| 12 | `src/stores/study-store.ts` | by_date case 추가 |
| 13 | `src/components/common/Layout.tsx` | lucide 아이콘 |
| 14 | 모달 6개 (CardForm, DeckForm, TemplateForm, Confirm, Import, Export) | shadcn/ui Dialog로 교체 |

---

## 구현 순서 (의존성 기반)

```
Step 1: shadcn/ui + Sonner + lucide-react 설치 + 기본 설정
  ↓
Step 2: 카드 플립 3D 애니메이션 (motion/react)
Step 3: 학습 세션 라이트 테마 + 프로그레스 바 그라디언트
Step 4: 덱 카드 컬러 바
  ↓ (위 3개 병렬 가능)
Step 5: 페이지네이션
Step 6: 날짜별 학습 모드 + DatePicker
  ↓ (위 2개 병렬 가능)
Step 7: 스와이프 제스처 설정
Step 8: Lucide 아이콘 마이그레이션
  ↓
Step 9: 기존 모달 → shadcn/ui Dialog 마이그레이션
  ↓
Step 10: npm run test && npm run build → 오류 0 될 때까지 반복
```

---

## 검증 체크리스트

1. `npm run test` — 모든 기존 테스트 통과 (66개)
2. `npm run build` — TypeScript + Vite 빌드 성공
3. 학습 화면: 카드 클릭 시 3D 플립 애니메이션 동작
4. 학습 화면: 라이트 배경 (bg-gray-50) + 그라디언트 프로그레스 바
5. 학습 설정: 5개 학습 모드 표시 (by_date 포함)
6. 학습 설정: 날짜별 모드에서 달력 표시 + 날짜 선택 + 카드 수 표시
7. 덱 목록: 각 덱 카드 왼쪽에 deck.color 컬러 바
8. 덱 상세: 카드 테이블 하단에 페이지네이션 컨트롤
9. 설정: 스와이프 제스처 4방향 매핑 UI + 활성화 토글
10. 학습 중 스와이프 제스처로 레이팅 동작
11. 모든 모달이 shadcn/ui Dialog 사용
12. Toast 알림 동작 (sonner)
13. lucide-react 아이콘으로 교체
