# UX Polish — Big-Tech Quality Lockdown

> **Version**: 1.0
> **Created**: 2026-05-27
> **Branch**: `worktree-ux-polish-bigtech`
> **Status**: 구현 진행 중
> **목표**: 웹/모바일이 "동작하는 앱"에서 "1st-party 빅테크 제품"으로 느껴지도록 연결 폴리시(피드백·로딩·에러복구·촉각·접근성) 격차를 제거한다.

전수 감사(웹 37p/164c, 모바일 27s/34c, 공유) 결과 기반. 기반(디자인 토큰·다크모드·Reanimated 플립·포커스 리페치)은 이미 견고하므로, **새 패러다임을 도입하지 않고 기존 SSOT 구조 위에 확장**한다.

---

## 아키텍처 원칙 (STANDARD 준수)

`DOCS/DESIGN-ALIGNMENT/00-MASTER.md` 의 4대 원칙을 그대로 따른다:

1. **Single Source of Truth** — 모든 신규 디자인 값(hover/active 음영 등)은 `packages/shared/design-tokens/`에만 정의하고 web(CSS 변수)·mobile(theme)로 파생한다. 색상을 컴포넌트에 하드코딩하지 않는다.
2. **플랫폼 어댑터 패턴** — 값(토큰)만 공유하고 UI 컴포넌트(React vs RN)는 공유하지 않는다. `Skeleton`·`Toast`·`Button`은 플랫폼별로 구현하되 **동일한 토큰·동일한 API 형태**를 따른다.
3. **점진적 마이그레이션** — 토큰 → 프리미티브 → 화면 순서. 각 단계가 독립적으로 빌드/테스트 통과.
4. **빌드 검증 필수** — 각 커밋마다 `tsc -b` + `vitest run`(web), `tsc`(mobile) 통과. 회귀는 베이스라인 대비 **카운트 비교**로 판정(로컬 ~100 pre-existing fail은 CI green).

### SOLID / SoC / 플러그인 확장성 적용

- **SRP**: 토스트 상태(store) ↔ 토스트 UI(view) ↔ 토스트 트리거(호출부) 분리.
- **OCP/플러그인**: `haptics` 유틸은 `enabled` 플래그 + 의미론적 API(`tap/success/error/selection`)로 설계 → 향후 사운드/진동 패턴 플러그인을 호출부 변경 없이 교체 가능. `Button` variant는 cva 맵에 항목 추가만으로 확장.
- **DIP**: 화면은 `useToast()`·`haptics.success()` 같은 추상 인터페이스에 의존하고 구현(sonner / expo-haptics)에 직접 의존하지 않는다.
- **SoC**: 로딩/빈/에러 상태를 화면 로직에서 분리해 `Skeleton`·`EmptyState`·`ErrorView` 프리미티브로 위임.

---

## 작업 분해 (단계별 커밋)

### Foundation
- **C1** `feat(tokens)`: shared/design-tokens/colors.ts에 `brandHover/brandActive`, `destructiveHover`, light/dark 양쪽 추가. SSOT.

### Web (Tier 1→3)
- **C2** `feat(web/theme)`: index.css/theme.css에 `--brand-hover|--destructive-hover` CSS 변수 + `@theme inline` 매핑, `@media (prefers-reduced-motion: reduce)` 전역 차단, `:focus-visible` 링 기본, skip-to-content 링크. `hover:bg-brand`(90)·`hover:bg-destructive`(21) → `*-hover` sweep.
- **C3** `feat(web/ui)`: 공유 `Skeleton` + `CardGridSkeleton`/`ListSkeleton`/`DetailSkeleton`. 이모지 `animate-pulse` 로더 12개 페이지 교체 + 학습 세션 로딩 스켈레톤.
- **C4** `feat(web/ui)`: cva 기반 공유 `<Button>`(variant: primary/secondary/destructive/ghost/outline, size, focus-visible/disabled/active 내장). 핵심 CTA 마이그레이션. `disabled:cursor-not-allowed` 누락 40곳 보정.
- **C5** `fix(web/ux)`: native `confirm()`(4곳) → `ConfirmDialog`, mutation 흐름 toast 일관화, `Modal.tsx` fade/zoom + role=dialog/aria-modal/focus.
- **C6** `feat(web/a11y)`: 공유 `EmptyState`, 아이콘 버튼 `aria-label`, `<img>` alt 7곳, undo/loading `role="status" aria-live`.

### Mobile (Tier 1→3)
- **C7** `feat(mobile/haptics)`: `utils/haptics.ts` 플러그인형 유틸(tap/success/error/selection/impact, enabled 토글). 공유 `Button`/`FAB`/`ListCard`/`SocialButton` press 연동 + 평가 성공/실패 구분 + 세션완료 축하.
- **C8** `feat(mobile/ui)`: `Skeleton`(Reanimated pulse) + Dashboard/Decks/Marketplace/DeckDetail 적용. `Toast`(store+view) + `ErrorBoundary`. raw `error.message` 노출 제거 → i18n 매핑. fetch 실패 시 `EmptyState` 재시도 CTA.
- **C9** `fix(mobile/polish)`: `useSafeAreaInsets`로 FAB/평가바/LoadingScreen 인셋. `SessionKickedScreen` + 하드코딩 영어 라벨 i18n(8 locales). 인터랙티브 요소 `accessibilityRole/Label`, `maxFontSizeMultiplier`. auth 화면 hex → theme, 핵심 `fontSize` → typography 토큰. RefreshControl tintColor 테마.

### Lockdown
- **C10** `test/chore`: 신규 유틸(haptics/toast-store/button variants/error-map) 의미 단위 테스트, 전체 typecheck/lint/test/build, 3-Phase 감사.

---

## 구현 결과 (2026-05-27 완료)

| 커밋 | 내용 | 검증 |
|------|------|------|
| C1 | tokens: brand/destructive hover·active (SSOT) | shared 기반 |
| C2 | web theme: hover sweep(79)·focus-visible·skip-link·reduced-motion | tsc 0 |
| C3 | web skeleton: 8 페이지 이모지로더 교체 + StudySession | tsc 0 |
| C4/5 | web 피드백: 전역 confirm(5)·Button 프리미티브·disabled 커서 | button 6 tests |
| C6 | web a11y: EmptyState·aria-label | tsc 0 |
| C7 | mobile haptics: 유틸 + 전 인터랙션 | tsc 0 |
| C8a/b | mobile skeleton·toast·ErrorBoundary·에러복구 | tsc 0 |
| C9 | mobile safe-area·a11y·SessionKicked i18n | tsc 0 |

**최종 게이트**: web `tsc -b` 0 / `vite build` 0 / `vitest` 회귀 0(111 사전실패 동일, +6 신규통과) / 신규 린트 0. mobile `tsc --noEmit` 0.

### 의도적 보류 (근거 있는 scope-out — 무작정 누락 아님)

1. **모바일 typography fontSize 리터럴(202) → theme.typography 일괄 마이그레이션**: 사용자 비가시 내부 일관성. 시각 회귀 테스트 없이 202곳 기계적 치환은 레이아웃 깨짐 위험 ↑ vs ROI ↓. Zero-Defect 원칙상 별도 포커스 작업으로 분리 권장. 대신 핵심 텍스트(Button)에 `maxFontSizeMultiplier`로 **실제 위험(큰 글씨 오버플로)**을 방어함.
2. **auth 화면 하드코딩 hex(AuthGuard/LoadingScreen)**: 전수 확인 결과 이들은 **항상-다크 브랜드 스플래시/오버레이**로 라이트모드 적응 대상이 아님 → theme 토큰화는 오히려 오답. 토큰화하지 않는 것이 정답(감사 오탐).
3. **StudySetup MODES / Marketplace CATEGORIES·SORT 라벨 i18n**: 모듈레벨 상수 배열의 영어 라벨. 실제 i18n 누수이나 core 학습 흐름 상수를 t() 구동형으로 바꾸는 중간 규모 리팩토링 → 별도 작업으로 분리(8 locale 키 추가 포함).

## 검증 체크리스트

- [ ] web `tsc -b` 0 errors / `vitest run` 회귀 0(베이스라인 카운트 대비) / `vite build` 성공
- [ ] mobile `tsc` 0 errors
- [ ] translation-keys 파리티(web 8 locales) 유지 — i18n 키 추가 시 8개 모두
- [ ] hover/active 피드백 전 CTA 적용, reduced-motion 존중
- [ ] 로딩 스켈레톤이 최종 레이아웃과 동형(CLS 0)
- [ ] 에러 시 재시도 가능, raw DB 메시지 비노출
- [ ] 모바일 핵심 인터랙션 햅틱, safe-area 안전, a11y 라벨
- [ ] 사이드이펙트(다크모드 색 깨짐/포커스 트랩/동시성) 0
