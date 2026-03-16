# ReeeeecallStudy Mobile App — Master Plan

> **Version**: 1.0
> **Created**: 2026-03-16
> **Status**: Planning
> **Stack**: React Native (Expo) + TypeScript
> **Target**: iOS + Android (cross-platform)

---

## Document Index

| # | Document | Description | Status |
|---|----------|-------------|--------|
| 01 | [ARCHITECTURE.md](./01-ARCHITECTURE.md) | Monorepo 구조, shared/web/mobile 패키지 설계 | Draft |
| 02 | [SHARED-CODE-AUDIT.md](./02-SHARED-CODE-AUDIT.md) | 웹 코드 재사용 분석 — 파일별 호환성 판정 | Draft |
| 03 | [SCREEN-MAP.md](./03-SCREEN-MAP.md) | 앱 화면 구조, Navigation 설계 | Draft |
| 04 | [PHASE-1-SETUP.md](./04-PHASE-1-SETUP.md) | Expo 초기화, 공유 패키지 분리, CI/CD | Draft |
| 05 | [PHASE-2-AUTH.md](./05-PHASE-2-AUTH.md) | Supabase 인증 (소셜 로그인, 딥링크) | Draft |
| 06 | [PHASE-3-CORE.md](./06-PHASE-3-CORE.md) | 덱/카드 CRUD, 홈 화면, 목록 | Draft |
| 07 | [PHASE-4-STUDY.md](./07-PHASE-4-STUDY.md) | 학습 화면 (플립, 스와이프, SRS, TTS) | Draft |
| 08 | [PHASE-5-FEATURES.md](./08-PHASE-5-FEATURES.md) | AI 생성, 마켓플레이스, 설정 | Draft |
| 09 | [PHASE-6-MONETIZATION.md](./09-PHASE-6-MONETIZATION.md) | 인앱 결제, Pro 구독, 무료 제한 | Draft |
| 10 | [PHASE-7-RELEASE.md](./10-PHASE-7-RELEASE.md) | 스토어 출시, TestFlight, 심사 | Draft |
| 11 | [PLATFORM-ADAPTERS.md](./11-PLATFORM-ADAPTERS.md) | 브라우저 API → RN 대체 가이드 | Draft |
| 12 | [SECURITY.md](./12-SECURITY.md) | 모바일 보안 (키 저장, 인증, 통신) | Draft |
| 13 | [TESTING.md](./13-TESTING.md) | Appium E2E 테스트 (iOS + Android) | Draft |

---

## Tech Stack
₩
| Layer | Web (현재) | Mobile (계획) |
|-------|-----------|---------------|
| Framework | React + Vite | React Native + Expo |
| Language | TypeScript | TypeScript (동일) |
| State | Zustand | Zustand (동일) |
| Backend | Supabase | Supabase (동일) |
| Auth | Supabase Auth | Supabase Auth + Expo AuthSession |
| Storage | localStorage | expo-secure-store / MMKV |
| Crypto | Web Crypto API | expo-crypto |
| TTS | Web Speech API | expo-speech |
| Navigation | react-router-dom | React Navigation |
| Styling | Tailwind CSS | StyleSheet / NativeWind |
| Unit Testing | Vitest | Jest |
| E2E Testing | Playwright | Appium + WebDriverIO (iOS + Android) |
| CI/CD | Cloudflare Pages | EAS Build + Submit |
| Payment | N/A | RevenueCat (Apple/Google IAP) |

---

## Code Reuse Summary

```
src/types/      → 100% reuse (pure TypeScript interfaces)
src/lib/        → ~85% reuse (50+ files, 5 need adapters)
src/stores/     → ~95% reuse (11 Zustand stores)
src/hooks/      → ~30% reuse (logic only, UI hooks rebuilt)
src/pages/      →   0% reuse (screens rebuilt from scratch)
src/components/ →   0% reuse (RN components from scratch)
```

---

## Phase Overview

```
Phase 1: Setup        (1주)   Expo 초기화, monorepo, shared 패키지 분리
Phase 2: Auth         (1주)   로그인/회원가입, 소셜 로그인, 세션 관리
Phase 3: Core         (2주)   홈, 덱 목록, 카드 CRUD, 기본 UI
Phase 4: Study        (3주)   카드 플립, 스와이프, SRS, TTS, 학습 요약
Phase 5: Features     (2주)   AI 생성, 마켓플레이스, 설정, 대시보드
Phase 6: Monetization (1주)   인앱 결제, Pro 구독, 무료 제한
Phase 7: Release      (1주)   스토어 출시, 심사, 스크린샷
                      ─────
                      ~11주 (풀타임 기준)
```

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-03-16 | React Native + Expo 선택 | 웹 코드 85%+ 재사용, TypeScript 동일, 팀 학습비용 최소 |
| 2026-03-16 | Monorepo (packages/) 구조 | shared 코드 단일 소스, 웹/앱 동시 유지보수 |
| 2026-03-16 | RevenueCat for IAP | Apple/Google 결제 통합, receipt validation 자동화 |
| 2026-03-16 | 웹은 무료 유지, 앱에서만 Pro 결제 | PG사 불필요, 인앱 결제만으로 수익화 |
| 2026-03-16 | E2E 테스트 Appium 선택 (Detox 대신) | 업계 표준, 실제 디바이스 클라우드 지원, iOS+Android 동일 API |
