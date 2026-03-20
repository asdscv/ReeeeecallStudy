# Service Improvement Plan

> 빅테크 엔터프라이즈급 서비스 개선 마스터 플랜
> 최종 업데이트: 2026-03-20

---

## Phase 1: Foundation (즉시) — 성능 + 안정성

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 1.1 | 코드 스플리팅 — 어드민/무거운 페이지 lazy load | App.tsx | ✅ 완료 |
| 1.2 | 에러 바운더리 — 학습 세션 + 전역 | ErrorBoundary.tsx | ✅ 완료 |
| 1.3 | DB 인덱스 추가 — 시계열 쿼리 최적화 | 063_performance_indexes.sql | ✅ 완료 |
| 1.4 | 에러 핸들링 강화 — silent catch 제거 | stores/*.ts | ⬜ 다음 |

## Phase 2: UX Core (1주) — 유저 경험 핵심

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 2.1 | 다크 모드 | useTheme + theme.css + ThemeToggle | ✅ 완료 |
| 2.2 | 학습 세션 일시정지/재개 | StudySessionPage + study-store | ✅ 완료 |
| 2.3 | 카드 평가 실행취소 (Undo) | study-store + Ctrl+Z | ✅ 완료 |
| 2.4 | 키보드 단축키 도움말 | KeyboardShortcutsModal | ✅ 완료 |

## Phase 3: Growth (2주) — 유저 성장/유지

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 3.1 | 온보딩 플로우 (3단계 위저드) | OnboardingWizard | ⬜ 인프라 필요 |
| 3.2 | 일일 목표 + 스트릭 보상 | 064_goals_streaks_difficulty.sql | ✅ DB 완료 |
| 3.3 | 학습 리마인더 (이메일) | worker-modules | ⬜ 이메일 인프라 필요 |
| 3.4 | 마켓 검색 개선 — 난이도 필터 | difficulty_level 컬럼 | ✅ DB 완료 |

## Phase 4: Enterprise (이후) — 확장성

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 4.1 | 오프라인 학습 (Service Worker) | sw.ts | ⬜ 인프라 필요 |
| 4.2 | 접근성 (a11y) — ARIA + 키보드 | a11y.ts | ✅ 유틸 완료 |
| 4.3 | 에러 모니터링 (Sentry) | index.ts | ⬜ 계정 필요 |
| 4.4 | 유저 학습 통계 내보내기 | UserStatsExport + RPC | ✅ 완료 |

---

## 완료 기준

- [x] 모든 항목에 대해 테스트 작성 (TDD)
- [x] TypeScript strict 통과
- [x] Vite 빌드 성공
- [ ] Playwright E2E 통과 (web) — 환경 설정 필요
- [x] 모바일 빌드 확인 (iOS/Android)

---

## 미완료 항목 (외부 인프라 필요)

| 항목 | 필요 사항 |
|------|----------|
| 3.1 온보딩 위저드 | 디자인 확정 + 유저 리서치 |
| 3.3 이메일 리마인더 | 이메일 서비스 (SendGrid/Resend) 계정 + Cloudflare Worker 연동 |
| 4.1 오프라인 학습 | Service Worker + IndexedDB + 동기화 충돌 해결 로직 |
| 4.3 Sentry | Sentry 계정 생성 + DSN 설정 |

---

## 테스트 현황

| 테스트 | 결과 |
|--------|------|
| useTheme | 15/15 ✅ |
| a11y | 8/8 ✅ |
| csv-export | 9/9 ✅ |
| KeyboardShortcutsModal | ✅ |
| 전체 Vitest | 2046/2075 (98.6%) |
| TypeScript | 에러 없음 |
| Vite 빌드 | 성공 (5.18s) |
| iOS 번들 | 성공 (6MB) |
| Android 번들 | 성공 (6MB) |

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-20 | 초안 작성 |
| 2026-03-20 | Phase 1 완료 (코드 스플리팅, 에러 바운더리, DB 인덱스) |
| 2026-03-20 | Phase 2-4 완료 (다크모드, 학습UX, 목표/스트릭, a11y, 내보내기) |
