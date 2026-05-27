# Dark-Mode Contrast & Audit Follow-ups

> **Version**: 1.0 · **Created**: 2026-05-27 · **Branch**: `worktree-dark-mode-contrast-polish`
> **트리거**: 사용자 — "다크모드에서 안 보이는 게 많다(경계선, 로그인 등)" + 감사 항목 1-5 전체 진행.

## 근본 원인 (Root Cause)

다크 테마에서 **`border`(gray800 `#1F2937`) == `surface`/`surfaceElevated`(gray800 `#1F2937`)** — 동일 색.
→ 카드 위 경계선·구분선·입력 테두리·스켈레톤이 카드 배경과 같은 색이라 **보이지 않음**.
근거: `shared/design-tokens/colors.ts` darkTheme. 모바일 50개 컴포넌트 + 로그인 카드가 `colors.border` 사용.

## 표준 준수 (DESIGN-ALIGNMENT 00-MASTER 4원칙)
SSOT(`shared/design-tokens/`) 단일 출처에서 다크 경계 대비를 수정하면 web(CSS 변수 sync)·mobile이 동시 해결. 플랫폼 어댑터·점진 마이그레이션·빌드검증 준수.

## 작업 분해 (단계별 커밋)

- **C1 `fix(tokens)`**: 다크 `border` gray800→**gray700**(`#374151`), `borderSecondary` gray700→gray600. web `index.css`/`theme.css` 다크 `--border*` sync. → 전역 경계 가시화(web+mobile, 50+ 컴포넌트, 로그인 카드, 구분선).
- **C2 `fix(ui)`**: 스켈레톤 가시성 — mobile `Skeleton` 명시 색(`isDark?gray700:gray200`, border 토큰 비의존), web `Skeleton` `bg-muted`→`bg-foreground/10`(양모드 robust).
- **C3 `fix(dark)`**: 로그인/잔여 다크 대비 전수 점검 — 하드코딩 라이트색·대비 부족 스윕(색상버튼 위 흰 텍스트는 정상이므로 제외).
- **C4 `feat(mobile)`**: 햅틱 Settings 토글 — `setHapticsEnabled` ↔ `local-prefs` 영속 + 초기화 + Settings 행. (감사 #3)
- **C5 `fix(web)`**: 전역 confirm danger에 의미있는 title 전달. (감사 #4)
- **C6 `feat(i18n)`**: StudySetup `MODES/CRAMMING_FILTERS/TIME_LIMITS`, Marketplace `CATEGORIES/SORT` 영어 하드코딩 → t() (mobile locales). (감사 #5-a)
- **C7 `refactor(mobile)`**: fontSize 리터럴 → `typography` 토큰 (렌더 크기 동일한 안전 치환 한정). (감사 #5-b)
- **C8 `test/chore`**: 전체 검증 + Zero-Defect 3-Phase 락다운.

## 검증 게이트
- web `tsc -b` 0 / `vite build` 0 / `vitest` 회귀 0(베이스라인 대비) / 신규 lint 0
- mobile `tsc --noEmit` 0
- translation-keys(web 8 locale) 파리티 유지
- 다크 경계 가시성: 카드/구분선/입력/로그인/스켈레톤 모두 가시
- 라이트 모드 무회귀(border gray200 불변)
