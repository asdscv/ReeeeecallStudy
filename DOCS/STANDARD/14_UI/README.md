# 14. UI — 토큰 · 테마 · 접근성 · UX 프리미티브 · 성능

> 앞의 13개 카테고리는 서버·DB·CI·확장점을 덮지만 **화면이 실제로 어떻게 생기는지**에 대한 규칙이 없었다.
> 이 영역의 특징은 **게이트가 거의 전부 없다**는 것이다 — ci.yml 7개 잡 중 접근성·번들 크기·다크모드·토큰
> 동기화를 검사하는 잡은 하나도 없고, playwright(모바일 뷰포트 프로젝트 포함)를 도는 잡 자체가 없다.
> 그래서 이 문서의 규칙은 **사람이 지키는 규칙**이고, 어긴 흔적이 이미 여럿 남아 있다.
>
> 실측 기준 2026-08-16.

## 목차
- [1. 색과 토큰 — 지금 진실원이 셋이다](#1-색과-토큰--지금-진실원이-셋이다)
- [2. 테마(라이트/다크)](#2-테마라이트다크)
- [3. 반응형](#3-반응형)
- [4. 접근성](#4-접근성)
- [5. UX 프리미티브 — 토스트 · 확인 · 폼](#5-ux-프리미티브--토스트--확인--폼)
- [6. 라우팅](#6-라우팅)
- [7. 성능 — 스플리팅 · 목록 · 오프라인](#7-성능--스플리팅--목록--오프라인)
- [8. 함정](#8-함정)

---

## 1. 색과 토큰 — 지금 진실원이 셋이다

`packages/shared/design-tokens/` 헤더는 스스로를 *"Single source of truth for Web & Mobile"* 이라고 적어 두었다.
**웹에 관해서는 사실이 아니다.**

| 소비자 | design-tokens 를 어떻게 쓰나 |
|---|---|
| 모바일 | 실제로 import 한다 — 10개 파일 |
| 웹 | **import 0건.** 같은 값을 `packages/web/src/index.css` 에 hex 로 손으로 복사하고 `/* ── Synced with shared/design-tokens ── */` 주석만 붙였다(`index.css:8`, `:61`, `styles/theme.css:52`) |

동기화 장치가 **주석 세 줄**이므로, 실제로 이미 어긋나 있다:

- `packages/shared/design-tokens/colors.ts:186` — `hard: palette.yellow[500]` 에 `// #EAB308 (web uses amber, unified to yellow-500)` 이라고 **통일이 끝난 것처럼** 적혀 있다.
- 그런데 `packages/web/src/lib/rating-groups.ts:24` 는 여전히 `hard: '#f97316'`(orange-500)다.
- 결과: **같은 SRS 평가 버튼이 웹과 모바일에서 다른 색이다.** 검사하는 테스트는 없다.

**규칙**

| 규칙 | 게이트 |
|---|---|
| 새 색/치수 값은 `packages/shared/design-tokens/` 에 먼저 넣는다 | 없음 |
| 모바일은 `useTheme()` 이 돌려주는 `theme.colors.*` 로만 쓴다 | 없음 (실측 1,275회 사용, 하드코딩 hex 99회 잔존 — 대부분 `#FFFFFF` 선택상태 글자색과 덱 색상 팔레트) |
| 웹은 **semantic 토큰 Tailwind 클래스**로 쓴다 (`bg-background`·`text-muted-foreground`·`bg-brand`·`text-destructive`) | 없음 (실측 semantic 약 2,970회 vs raw 팔레트 약 270회) |
| 웹에서 값을 바꿨으면 `design-tokens` 도 같은 PR 에서 바꾼다(그 반대도) | 없음 — **여기가 지금 새는 곳이다** |

> **왜 raw 팔레트 클래스(`bg-blue-500`)를 쓰면 안 되나**: 다크모드가 `.dark` 클래스로 **CSS 변수를 갈아끼우는** 방식이라, 변수를 거치지 않는 raw 팔레트는 **다크에서 뒤집히지 않는다.** 현재 남아 있는 270여 곳은 랜딩 섹션과 study 평가 버튼에 몰려 있다.

## 2. 테마(라이트/다크)

값은 `light` / `dark` / `system` 3개이고 `profiles.theme` 컬럼에 저장한다.

| | 웹 | 모바일 |
|---|---|---|
| 해석 순서 | `localStorage('reeeeecall-theme')` → 프로필 → `matchMedia` | zustand `theme-store.userTheme` → `useColorScheme()` |
| 적용 | `<html>` 에 `.dark` 클래스 + `style.colorScheme` | `Appearance.setColorScheme(...)` |
| 게이트 | `packages/web/src/hooks/__tests__/useTheme.test.ts` (CI `Unit Tests`) | 없음 |

- **모바일에서 `Appearance.setColorScheme` 에는 `'unspecified'` 를 보낸다.** `null` 이 아니다.
- 웹은 첫 페인트 전에 테마를 정해야 깜빡이지 않으므로 `localStorage` 캐시를 프로필보다 **먼저** 읽는다. 이 순서를 뒤집지 않는다.

## 3. 반응형

- **Tailwind mobile-first 브레이크포인트만** 쓴다 — 실측 `sm:` 713회 · `md:` 77회 · `lg:` 51회.
- `useMediaQuery` / `useIsMobile` 같은 **JS 브레이크포인트 훅은 존재하지 않는다.** 새로 만들지 않는다 — 레이아웃 분기가 CSS 와 JS 두 곳으로 갈라진다.
- `matchMedia` 는 **테마**와 **prefers-reduced-motion** 두 용도로만 쓴다.
- 모션은 OS 설정을 존중한다: `packages/web/src/index.css:250` 의 `@media (prefers-reduced-motion: reduce)` 블록이 전역으로 duration 을 0.001ms 로 누른다(WCAG 2.3.3).

**게이트**: 없음. `packages/web/playwright.config.ts` 에 `mobile-chrome`(Pixel 5) 프로젝트가 정의돼 있지만 **playwright 를 도는 CI 잡이 없다** → [`../07_TESTING/GATES.md §3`](../07_TESTING/GATES.md).

## 4. 접근성

### 웹

JSX 속성으로만 한다 — `aria-label` 40회, `role=` 38회, `<img>` 31개에 `alt` 사실상 전부, `aria-live` 7회, skip link 1개.

- ⚠️ `packages/web/src/lib/a11y.ts` 는 **프로덕션 소비자가 0** 이다(자기 테스트만 import). 유틸을 쓸 거면 쓰고, 아니면 지운다 → 제1원칙 §5.
- ⚠️ `eslint-plugin-jsx-a11y` 가 `packages/web/eslint.config.js` 에 **없다.** 접근성 회귀를 잡는 자동 장치가 하나도 없다.

### 모바일

식별자는 `packages/mobile/src/utils/testProps.ts:16` 의 `testProps(id, isContainer)` 헬퍼로 붙인다(실측 31개 파일).

```tsx
<View {...testProps('deck-list', true)}>      // 컨테이너
  <Pressable {...testProps('deck-card')} />   // 리프
</View>
```

**두 가지가 헬퍼 안에 이유와 함께 들어 있다**:
1. `accessibilityLabel` 을 `testID` 와 **함께** 세팅한다 — Android 에서 Appium 의 `~` 셀렉터가 보는 것은 `content-description` 이다. `testID` 만 붙이면 iOS 에서만 잡힌다.
2. 컨테이너는 `accessible={false}` 여야 **자식이 개별적으로 접근 가능**해진다. 안 그러면 스크린리더와 자동화가 자식을 못 본다.

- id 는 kebab-case, 화면 루트는 `<name>-screen`.
- 사용자에게 보이는 라벨은 `common:a11y.*` 키에서 가져오고 `accessibilityRole` 을 명시한다(실측 role 54회, label 28회, `hitSlop` 26회).
- **게이트 없음** — Appium wdio 스펙 14개를 도는 CI 잡이 없다.

## 5. UX 프리미티브 — 토스트 · 확인 · 폼

| | 웹 | 모바일 |
|---|---|---|
| 토스트 | `sonner`. `<Toaster richColors position="top-right" />` 를 `App.tsx:215` 에 **한 번만** 마운트 | 자체 구현(`components/ui/Toast.tsx` + zustand). API 3개(`success`/`error`/`info`)를 웹과 **같은 이름**으로 맞췄다 |
| 확인 | Promise 기반 imperative `confirm({ title, message, danger })` + `GlobalConfirmDialog` 싱글턴 | `Alert.alert` (23개 파일 98회) |

- **`window.confirm` 을 새로 쓰지 않는다.** `packages/web/src/stores/confirm-store.ts` 가 그 대체품이고 헤더에 그렇게 적혀 있다.
  현재 위반 2곳: `packages/web/src/pages/quiz/QuizHomePage.tsx:53`, `packages/web/src/pages/quiz/QuizSetDetailPage.tsx:78`.
- 토스트/다이얼로그 문구는 **i18n 키**에서 온다 → [`../10_I18N`](../10_I18N/README.md).

### 폼·입력 검증

**스키마 라이브러리를 쓰지 않는다.** `zod`·`react-hook-form`·`yup`·`formik` 이 어느 `package.json` 에도 없다(실측 0). 검증은 순수 함수이고 시그니처가 고정이다:

```ts
{ valid: boolean, errors: string[] }
```

표본: `packages/web/src/lib/api-validation.ts:12` · `api-deck-validation.ts:20` · `password-validation.ts:2`.
**게이트**: `api-validation.test.ts` · `api-deck-validation.test.ts` (CI `Unit Tests`).

> 새 검증을 추가할 때 스키마 라이브러리를 들이지 않는다 — 번들에 들어가고, 두 플랫폼에서 다르게 동작하며, 지금 방식은 shared 로 올리기가 쉽다.

## 6. 라우팅

| | 웹 | 모바일 |
|---|---|---|
| 정의 | `packages/web/src/App.tsx` 한 파일의 `<Route>` **56개**(`path` 지정 52 · `lazy()` 20) | 스택 파일 8개 + `navigation/types.ts` 의 `ParamList` |
| 타입 안전 | **없음** — 라우트 상수 모듈이 없고 화면이 문자열을 직접 `navigate()` 에 넘긴다 | 있음 — `ParamList` 로 화면명·파라미터가 타입 검사된다 |

- 웹 라우트 문자열의 오타는 **컴파일도 테스트도 잡지 못한다.** 유일한 예외가 AI 허브로, `ai-hub-catalog.test.ts` 가 카탈로그의 `webPath` 가 `App.tsx` 에 실재하는지 검사한다.
- 새 라우트를 레지스트리에서 파생시킬 수 있으면 그렇게 한다 → [`../01_ARCHITECTURE/extension_points.md`](../01_ARCHITECTURE/extension_points.md).

## 7. 성능 — 스플리팅 · 목록 · 오프라인

| 규칙 | 실측 |
|---|---|
| 코드 스플리팅은 **포커스 화면 + 관리자**만 `React.lazy` 로 자른다 | `App.tsx` 20개(quiz run/result/mistakes/set, study session, marketplace, AI generate/hub, deck edit, achievements, admin 계열) |
| `<Suspense>` 는 라우터 전체를 **한 번** 감싸고 fallback 은 `LoadingFallback` 하나 | 1개 |
| 오프스크린 섹션은 `content-visibility: auto` + `contain-intrinsic-size` | 전역 셀렉터(`section[class*="py-"]`, `footer`, `aside`) |
| **큰 목록은 가상화하지 않고 서버 페이지네이션으로 자른다** | `content-store` `PAGE_SIZE = 12`, `admin-store` page/pageSize, 전체 조회는 `fetchAllRows` |

- 가상화 라이브러리(`react-window`·`react-virtual`·`flash-list`)는 **의존성에 없다.** 큰 목록을 새로 만들면 먼저 서버 페이지네이션을 설계한다.
- **번들 크기 예산이 없다.** 새 의존성을 넣을 때는 사람이 판단한다.

### 오프라인 — 다루지 않는다(명시적 결정)

오프라인 감지·요청 큐잉·서비스워커·자동 재시도가 **전부 없다**(`netinfo`·`navigator.onLine`·`vite-plugin-pwa`·`workbox` 모두 부재).
실패는 스토어 `error` 로 표면화하고 **사용자가 직접 다시 누른다.**

유일한 예외가 study 영속화 체인이다 — `persistenceChain` 이 순서를 직렬화하되 절대 reject 되지 않게 catch 로 삼키고,
특정 SQLSTATE(`PT409`·`22023`·`42501`·`55000`)는 **재시도하지 않는다**고 코드에 못 박혀 있다 → [`../06_RESILIENCE`](../06_RESILIENCE/README.md).

**새 기능에 오프라인 동작을 넣으려면** 그것은 이 문서를 고치는 결정이다. 한 화면만 몰래 큐잉을 갖게 하지 않는다.

## 8. 함정

- **`packages/web/index.html` 이 `<html lang="en">` 하드코딩이다.** 나머지 7개 로케일은 런타임에 JS 가 덮어쓰므로, **봇 프리렌더와 첫 페인트 시점에는 여전히 `en`** 이다. 덮어쓰는 곳도 `useSEO.ts`(마운트/언마운트로 되돌림)와 `useLocale.ts` 두 군데로 갈려 있다.
- **웹에 CSS 변수 체계가 두 벌 있고 같은 개념에 다른 값을 준다.** `index.css` 의 `--card`(dark `#1E293B`) vs `styles/theme.css` 의 `--bg-card`(dark `#1F2937`). `theme.css` 는 `index.css:3` 이 항상 `@import` 하지만 실소비자는 `ThemeToggle.tsx` 뿐이다. **어느 쪽을 고쳐야 하는지 코드만 봐서는 알 수 없다** — 새 변수는 `index.css` 에 넣는다.
- **`DEFAULT_FONT_SIZES` 가 세 벌이다**: `packages/web/src/lib/layout-styles.ts` · `packages/shared/lib/layout-styles.ts` · `packages/mobile/src/screens/StudySessionScreen.tsx`(손으로 타이핑, `// matches web layout-styles.ts` 주석만). 지금은 값이 우연히 같다. 한 곳만 바꾸면 같은 덱이 두 플랫폼에서 다른 크기로 렌더된다.
- **모바일에 `toLocaleDateString`/`toLocaleString` 호출이 10곳(9파일) 남아 있다** — 같은 저장소에 "Hermes 는 ICU 없이 빌드되므로 쓰면 안 된다"는 주석이 4곳 있는데도. → [`../10_I18N`](../10_I18N/README.md)
- **모바일 프로덕션 코드에 `__DEV__` 가드 없는 `console.log` 가 남아 있다**(30회 중 가드된 것 1회). `no-console` eslint 규칙이 없고 모바일에는 **eslint 설정 파일 자체가 없다.**
- **원격 크래시 리포팅이 없다.** `ErrorBoundary` 가 렌더 크래시를 잡아 fallback 을 보여주지만 원인은 `console.error('[ErrorBoundary]', …)` 로만 남는다. Sentry/Bugsnag/Datadog 어느 것도 저장소에 없고 `analytics-logger.ts` 에 자리만 있다 — **사용자 기기에서 터진 것은 아무도 모른다.**

## 이 문서의 부채

| id | 부채 | 규모(2026-08-16 실측) | 해소 방향 |
|---|---|---|---|
| U1 | 웹이 `design-tokens` 를 import 하지 않고 hex 를 복사 | 주석 3줄이 유일한 동기화 장치. `ratingColors.hard` 이미 불일치 | 웹 `index.css` 를 토큰에서 생성하거나, 최소한 값 일치 테스트를 만든다 |
| U2 | 웹 CSS 변수 체계 2벌 | `--card` vs `--bg-card`, 다크 값 다름 | `theme.css` 를 흡수하고 `ThemeToggle` 을 semantic 클래스로 |
| U3 | `DEFAULT_FONT_SIZES` 3벌 | 3파일 | shared 단일화 + `SINGLE_SOURCE_ONLY` 등록 |
| U4 | 접근성 게이트 전무 | `jsx-a11y` 없음, Appium 14스펙 미실행, `a11y.ts` 소비자 0 | `eslint-plugin-jsx-a11y` 도입이 가장 싸다 |
| U5 | 웹 라우트 문자열에 타입 안전망 없음 | `App.tsx` 48개 리터럴 | 라우트 상수 모듈 + `navigate()` 래퍼 |
| U6 | `window.confirm` 잔존 | 2곳(`QuizHomePage.tsx:53`·`QuizSetDetailPage.tsx:78`) | `confirm-store` 로 교체 |
| U7 | 모바일 `toLocaleDate*` 잔존 | 10곳 / 9파일 | `calendarParts()` / `dateLine` 포매터로 |

전체 부채 목록 → [`../01_ARCHITECTURE/modular_composition.md §7`](../01_ARCHITECTURE/modular_composition.md#7-지금-어긋나-있는-것-부채-목록--늘어나면-안-되고-줄어들기만-한다)

## 관련 문서
[`../02_CLIENT`](../02_CLIENT/README.md) · [`../10_I18N`](../10_I18N/README.md) · [`../12_MOBILE`](../12_MOBILE/README.md) · [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md)
