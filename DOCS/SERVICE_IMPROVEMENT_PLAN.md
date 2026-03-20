# Service Improvement Plan

> 빅테크 엔터프라이즈급 서비스 개선 마스터 플랜
> 최종 업데이트: 2026-03-20

---

## Phase 1: Foundation (즉시) — 성능 + 안정성

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 1.1 | 코드 스플리팅 — 어드민/무거운 페이지 lazy load | App.tsx | ⬜ |
| 1.2 | 에러 바운더리 — 학습 세션 + 전역 | ErrorBoundary.tsx | ⬜ |
| 1.3 | DB 인덱스 추가 — 시계열 쿼리 최적화 | 063_performance_indexes.sql | ⬜ |
| 1.4 | 에러 핸들링 강화 — silent catch 제거 | stores/*.ts | ⬜ |

## Phase 2: UX Core (1주) — 유저 경험 핵심

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 2.1 | 다크 모드 | theme system | ⬜ |
| 2.2 | 학습 세션 일시정지/재개 | StudySessionPage | ⬜ |
| 2.3 | 카드 평가 실행취소 (Undo) | study-store | ⬜ |
| 2.4 | 키보드 단축키 도움말 | StudySessionPage | ⬜ |

## Phase 3: Growth (2주) — 유저 성장/유지

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 3.1 | 온보딩 플로우 (3단계 위저드) | OnboardingWizard | ⬜ |
| 3.2 | 일일 목표 + 스트릭 보상 | DashboardPage | ⬜ |
| 3.3 | 학습 리마인더 (이메일) | worker-modules | ⬜ |
| 3.4 | 마켓 검색 개선 — 난이도 필터 | MarketplacePage | ⬜ |

## Phase 4: Enterprise (이후) — 확장성

| # | 항목 | 파일 | 상태 |
|---|------|------|------|
| 4.1 | 오프라인 학습 (Service Worker) | sw.ts | ⬜ |
| 4.2 | 접근성 (a11y) — ARIA + 키보드 | 전체 | ⬜ |
| 4.3 | 에러 모니터링 (Sentry) | index.ts | ⬜ |
| 4.4 | 유저 학습 통계 내보내기 | SettingsPage | ⬜ |

---

## 완료 기준

- [ ] 모든 항목에 대해 테스트 작성 (TDD)
- [ ] TypeScript strict 통과
- [ ] Vite 빌드 성공
- [ ] Playwright E2E 통과 (web)
- [ ] 모바일 빌드 확인 (iOS/Android)

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-03-20 | 초안 작성 |
