# Phase 5: UX Polish — 🔲 대기

> 카드 플립 3D 애니메이션, 다크모드/테마 시스템, 모바일 반응형(햄버거 메뉴), Toast 알림

## 현재 상태 분석

| 영역 | 현재 | 목표 |
|------|------|------|
| 카드 플립 | `isFlipped ? Back : Front` 즉시 전환, 애니메이션 없음 | CSS 3D `perspective + rotateY(180deg)` 0.4s 트랜지션 |
| 다크모드 | 없음 (라이트 하드코딩). StudySessionPage만 별도 다크 배경 | 전역 테마 Context. `profiles.theme`(light/dark/system) 연동 |
| 모바일 내비 | Layout.tsx에 flex 기본. 768px 미만에서 버튼 잘림 | 햄버거 메뉴 + 슬라이드 오버레이. 학습 화면 하단 고정 버튼 |
| Toast | 없음 (SettingsPage에 인라인 "저장되었습니다!" 텍스트만) | Zustand 기반 Toast 큐. 성공/에러/정보 3종 |
| index.css | `@import "tailwindcss"` + body 리셋뿐 | 다크모드 CSS 변수, 플립 keyframes, 커스텀 유틸리티 |

## 구현 순서

```
Step 0: 테마 인프라 (ThemeProvider, useTheme, CSS 변수, dark variant 설정)
Step 1: 전체 컴포넌트 dark: 변형 추가 (일괄 적용)
Step 2: 카드 플립 3D 애니메이션 (StudyCard.tsx 리팩토링)
Step 3: 모바일 반응형 (MobileNav, 학습 화면 하단 고정)
Step 4: Toast 알림 시스템 (toast-store, Toast UI, 기존 코드 연동)
Step 5: SettingsPage 테마/엔진 UI 추가
Step 6: npm test && npm run build → 오류 0
```

---

## Step 0: 테마 인프라

### 0-1. 새 파일: `src/hooks/useTheme.ts`

```ts
// profiles.theme ('light' | 'dark' | 'system') 기반
// 1. 초기 로드: profile.theme 읽기
// 2. system 모드일 때: matchMedia('(prefers-color-scheme: dark)') 리스너
// 3. <html> 요소에 class="dark" 토글
// 4. localStorage에도 캐싱 (프로필 fetch 전 깜빡임 방지)

export function useTheme(): {
  theme: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'  // 실제 적용 중인 테마
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}
```

### 0-2. 새 파일: `src/components/common/ThemeProvider.tsx`

```ts
// App.tsx에서 최상위 래핑
// useTheme을 내부 호출하여 <html class="dark"> 자동 관리
// profile 로드 완료 시 theme 동기화
```

### 0-3. 수정: `src/index.css`

```css
@import "tailwindcss";

/* 다크모드 커스텀 variant (Tailwind v4 방식) */
@custom-variant dark (&:where(.dark, .dark *));

/* 카드 플립 애니메이션 */
.flip-card {
  perspective: 1200px;
}
.flip-card-inner {
  transition: transform 0.4s ease-in-out;
  transform-style: preserve-3d;
}
.flip-card-inner.flipped {
  transform: rotateY(180deg);
}
.flip-card-front,
.flip-card-back {
  backface-visibility: hidden;
}
.flip-card-back {
  transform: rotateY(180deg);
}

/* Toast 애니메이션 */
@keyframes toast-in {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes toast-out {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(-100%); opacity: 0; }
}

body {
  margin: 0;
  min-height: 100vh;
}
```

### 0-4. 수정: `src/App.tsx`

```diff
+ import { ThemeProvider } from './components/common/ThemeProvider'
+ import { ToastContainer } from './components/common/Toast'

  function App() {
    return (
+     <ThemeProvider>
        <BrowserRouter>
          <Routes>...</Routes>
        </BrowserRouter>
+       <ToastContainer />
+     </ThemeProvider>
    )
  }
```

---

## Step 1: 전체 컴포넌트 dark: 변형 추가

### 대상 파일 목록 (약 20개)

| # | 파일 | 주요 변경 |
|---|------|----------|
| 1 | `Layout.tsx` | 헤더 `bg-white dark:bg-gray-900`, 내비 `dark:text-gray-300`, 본문 `bg-gray-50 dark:bg-gray-950` |
| 2 | `DashboardPage.tsx` | 제목 `dark:text-white` |
| 3 | `DecksPage.tsx` | 덱 카드 `dark:bg-gray-800 dark:border-gray-700` |
| 4 | `DeckDetailPage.tsx` | 테이블 `dark:bg-gray-800`, 배지 `dark:` 변형 |
| 5 | `TemplatesPage.tsx` | 항목 `dark:bg-gray-800` |
| 6 | `SettingsPage.tsx` | 입력 필드 `dark:bg-gray-800 dark:border-gray-600 dark:text-white` |
| 7 | `StudySetupPage.tsx` | 모드 선택 카드 `dark:bg-gray-800` |
| 8 | `StudySessionPage.tsx` | 이미 다크 → 테마에 따라 동적으로 변경 |
| 9 | `LoginPage.tsx` | 로그인 카드 `dark:bg-gray-800` |
| 10 | `Modal.tsx` | 오버레이 `dark:bg-gray-900/80`, 모달 `dark:bg-gray-800` |
| 11 | `ConfirmDialog.tsx` | 다이얼로그 `dark:bg-gray-800` |
| 12 | `CardFormModal.tsx` | 입력 필드 dark 변형 |
| 13 | `DeckFormModal.tsx` | 입력 필드 dark 변형 |
| 14 | `TemplateFormModal.tsx` | 입력 필드 dark 변형 |
| 15 | `ImportModal.tsx` | 드래그 영역 `dark:border-gray-600` |
| 16 | `ExportModal.tsx` | dark 변형 |
| 17 | `StatsSummaryCards.tsx` | 카드 `dark:bg-gray-800 dark:text-white` |
| 18 | `StudyHeatmap.tsx` | 컨테이너 dark, fill 색상은 유지 |
| 19 | `ForecastWidget.tsx` | 차트 컨테이너 dark |
| 20 | `DailyStudyChart.tsx` | 차트 컨테이너 dark |
| 21 | `RecentDecks.tsx` | 덱 카드 dark |
| 22 | `StudyCard.tsx` | (Step 2에서 함께 처리) |

### dark 변형 패턴

```
bg-white        → bg-white dark:bg-gray-800
bg-gray-50      → bg-gray-50 dark:bg-gray-950
border-gray-200 → border-gray-200 dark:border-gray-700
text-gray-900   → text-gray-900 dark:text-white
text-gray-500   → text-gray-500 dark:text-gray-400
text-gray-400   → text-gray-400 dark:text-gray-500
bg-blue-50      → bg-blue-50 dark:bg-blue-900/30
text-blue-700   → text-blue-700 dark:text-blue-300
bg-amber-50     → bg-amber-50 dark:bg-amber-900/30
text-amber-700  → text-amber-700 dark:text-amber-300
```

---

## Step 2: 카드 플립 3D 애니메이션

### 수정: `src/components/study/StudyCard.tsx`

현재 구조:
```tsx
// isFlipped ? <BackContent /> : <FrontContent />
// → 즉시 교체, 애니메이션 없음
```

목표 구조:
```tsx
<div className="flip-card">
  <div className={`flip-card-inner ${isFlipped ? 'flipped' : ''}`}>
    <div className="flip-card-front absolute inset-0">
      <FrontContent />
    </div>
    <div className="flip-card-back absolute inset-0">
      <BackContent />
    </div>
  </div>
</div>
```

### 핵심 사항
- 앞면/뒷면 모두 동시에 렌더링 (backface-visibility: hidden으로 한 면만 보임)
- `perspective: 1200px` → 적절한 3D 깊이감
- `transition: 0.4s ease-in-out` → 자연스러운 플립
- 앞면 클릭 시 → `onFlip()` → `isFlipped = true` → CSS가 0.4s 동안 회전
- 이미지/오디오 필드도 양면에 정상 렌더링

---

## Step 3: 모바일 반응형

### 3-1. 새 파일: `src/components/common/MobileNav.tsx`

```
동작:
  - 768px 미만에서만 표시 (md:hidden)
  - 햄버거 버튼 (☰) → 클릭 시 슬라이드 오버레이
  - 오버레이: 좌측에서 슬라이드 인, 네비게이션 4개 + 사용자 정보 + 로그아웃
  - 배경 클릭 또는 X 버튼으로 닫기
  - 메뉴 항목 클릭 시 자동 닫힘

Props: { user: { email: string }, onLogout: () => void }
```

### 3-2. 수정: `src/components/common/Layout.tsx`

```
현재: 모든 화면 크기에서 동일한 헤더
목표:
  - PC (md+): 기존 헤더 그대로
  - 모바일 (<md): 로고 + 햄버거 버튼만 표시, 나머지 숨김
  - MobileNav 컴포넌트 조건부 렌더링
```

### 3-3. 학습 화면 모바일 최적화

수정: `src/pages/StudySessionPage.tsx`
```
- 프로그레스 바: 모바일에서 텍스트 줄임
- 카드: max-w-full, px-4
- 평가 버튼: 모바일에서 하단 고정 (fixed bottom-0, safe-area-inset)
- 터치 영역 확대: 최소 44px 높이
```

수정: `src/components/study/SrsRatingButtons.tsx`, `SimpleRatingButtons.tsx`
```
- 하단 고정 레이아웃 (모바일)
- 버튼 크기 확대 (py-4)
- safe-area-bottom padding
```

---

## Step 4: Toast 알림 시스템

### 4-1. 새 파일: `src/stores/toast-store.ts`

```ts
interface Toast {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  duration?: number  // ms, 기본 3000
}

interface ToastState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

// 자동 제거: duration ms 후 removeToast 호출
```

### 4-2. 새 파일: `src/components/common/Toast.tsx`

```
<ToastContainer />:
  - fixed top-4 right-4 z-[9999]
  - toasts.map → <ToastItem />
  - 최대 3개 표시 (overflow 방지)

<ToastItem />:
  - success: 초록 좌측 바 + 체크 아이콘
  - error: 빨강 좌측 바 + X 아이콘
  - info: 파랑 좌측 바 + ℹ 아이콘
  - 닫기 버튼 (X)
  - animation: toast-in 0.3s
  - 자동 제거 시 toast-out 0.3s
```

### 4-3. 기존 코드 Toast 연동

| 파일 | 현재 | Toast 적용 |
|------|------|-----------|
| `SettingsPage.tsx` | 인라인 "저장되었습니다!" | `addToast({ type: 'success', message: '설정이 저장되었습니다' })` |
| `ImportModal.tsx` | 결과 메시지 인라인 | `addToast({ type: 'success', message: 'N개 카드를 가져왔습니다' })` |
| `ExportModal.tsx` | 없음 | `addToast({ type: 'success', message: '파일을 다운로드했습니다' })` |
| `CardFormModal.tsx` | 없음 | 저장 성공/실패 Toast |
| `DeckFormModal.tsx` | 없음 | 저장 성공/실패 Toast |
| 에러 핸들링 전반 | console.error | `addToast({ type: 'error', message: '...' })` |

---

## Step 5: SettingsPage 테마 UI

### 수정: `src/pages/SettingsPage.tsx`

```
새 섹션: "테마" (기존 TTS 섹션 아래)

┌─────────────────────────────────────────┐
│  테마                                    │
│                                         │
│  ○ 라이트    ○ 다크    ○ 시스템          │
│  [☀️ 밝은]  [🌙 어두운] [💻 자동]       │
│                                         │
│  ※ 시스템: OS 설정에 따라 자동 전환       │
└─────────────────────────────────────────┘

- 3개 라디오 버튼 (아이콘 + 라벨)
- 선택 시 즉시 반영 (미리보기 효과)
- 저장 버튼 클릭 시 profiles.theme 업데이트
```

---

## Step 6: 빌드 검증

```bash
npm run test        # 66 테스트 유지 (UI 변경은 기존 순수 함수 테스트에 영향 없음)
npm run build       # TypeScript + Vite 빌드 성공, 오류 0
```

---

## 새로 생성 파일 (6개)

| # | 파일 | 역할 |
|---|------|------|
| 1 | `src/hooks/useTheme.ts` | 테마 감지/토글 훅 |
| 2 | `src/components/common/ThemeProvider.tsx` | 전역 테마 Context + `<html class>` 관리 |
| 3 | `src/components/common/MobileNav.tsx` | 모바일 햄버거 메뉴 + 슬라이드 오버레이 |
| 4 | `src/components/common/Toast.tsx` | Toast UI (ToastContainer + ToastItem) |
| 5 | `src/stores/toast-store.ts` | Zustand Toast 상태 관리 |

## 수정 파일 (~20개)

| # | 파일 | 변경 |
|---|------|------|
| 1 | `src/index.css` | dark variant, 플립 CSS, Toast keyframes |
| 2 | `src/App.tsx` | ThemeProvider 래핑, ToastContainer 추가 |
| 3 | `src/components/common/Layout.tsx` | dark 변형 + 모바일 햄버거 |
| 4 | `src/components/study/StudyCard.tsx` | 3D 플립 애니메이션 |
| 5 | `src/pages/SettingsPage.tsx` | 테마 선택 UI + Toast 연동 |
| 6 | `src/pages/DashboardPage.tsx` | dark 변형 |
| 7 | `src/pages/DeckDetailPage.tsx` | dark 변형 |
| 8 | `src/pages/StudySessionPage.tsx` | 테마 연동 + 모바일 하단 고정 |
| 9 | `src/pages/DecksPage.tsx` | dark 변형 |
| 10 | `src/pages/TemplatesPage.tsx` | dark 변형 |
| 11 | `src/pages/StudySetupPage.tsx` | dark 변형 |
| 12 | `src/components/auth/LoginPage.tsx` | dark 변형 |
| 13 | `src/components/common/Modal.tsx` | dark 변형 |
| 14 | `src/components/common/ConfirmDialog.tsx` | dark 변형 |
| 15 | `src/components/card/CardFormModal.tsx` | dark 변형 + Toast |
| 16 | `src/components/deck/DeckFormModal.tsx` | dark 변형 + Toast |
| 17 | `src/components/template/TemplateFormModal.tsx` | dark 변형 |
| 18 | `src/components/import-export/ImportModal.tsx` | dark 변형 + Toast |
| 19 | `src/components/import-export/ExportModal.tsx` | dark 변형 + Toast |
| 20 | `src/components/dashboard/*.tsx` (5개) | dark 변형 |
| 21 | `src/components/deck/UploadDateTab.tsx` | dark 변형 |
| 22 | `src/components/deck/DeckStatsTab.tsx` | dark 변형 |
| 23 | `src/components/study/SrsRatingButtons.tsx` | 모바일 하단 고정 |
| 24 | `src/components/study/SimpleRatingButtons.tsx` | 모바일 하단 고정 |
| 25 | `src/components/study/StudyProgressBar.tsx` | dark 변형 |
| 26 | `src/components/study/StudySummary.tsx` | dark 변형 |

## 구현 순서 (의존성 기반)

```
Step 0: 테마 인프라 (useTheme, ThemeProvider, index.css)
  ↓
Step 1: 전체 컴포넌트 dark: 변형 (~20개 파일)
  ↓ (Step 1 완료 후 다크모드 동작)
Step 2: 카드 플립 3D 애니메이션 (StudyCard.tsx)
Step 3: 모바일 반응형 (MobileNav, Layout, 학습 화면)
Step 4: Toast 알림 (toast-store, Toast.tsx, 기존 연동)
  ↑ (2, 3, 4는 서로 독립, 병렬 가능)
  ↓
Step 5: SettingsPage 테마 UI (useTheme, Toast 모두 의존)
  ↓
Step 6: npm test && npm run build → 오류 0
```

---

## 검증 체크리스트

- [ ] 설정에서 다크모드 토글 → 전체 UI 즉시 반영
- [ ] `prefers-color-scheme: dark` → "시스템" 설정 시 OS 테마 자동 추종
- [ ] 학습 화면에서 카드 플립 시 0.4s 3D 애니메이션 동작
- [ ] 이미지/오디오 필드 포함 카드도 플립 정상
- [ ] 모바일(375px)에서 햄버거 메뉴 표시 + 슬라이드 오버레이 동작
- [ ] 학습 화면 모바일: 평가 버튼 하단 고정, 터치 영역 44px+
- [ ] Toast: Import 완료 시 성공 알림 표시 (3초 후 자동 닫힘)
- [ ] Toast: 에러 발생 시 에러 알림 표시 (수동 닫힘)
- [ ] `npm run test` — 66 테스트 통과
- [ ] `npm run build` — TypeScript + Vite 빌드 성공, 오류 0
