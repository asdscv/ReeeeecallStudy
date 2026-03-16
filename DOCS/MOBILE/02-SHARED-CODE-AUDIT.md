# 02. Shared Code Audit — 웹 코드 재사용 분석

> **Status**: Draft
> **Last Updated**: 2026-03-16

---

## Summary

| Category | Total Files | Reusable | Needs Adapter | Web-Only |
|----------|-------------|----------|---------------|----------|
| `src/types/` | 2 | 2 (100%) | 0 | 0 |
| `src/lib/` | ~65 | ~50 (77%) | ~10 (15%) | ~5 (8%) |
| `src/stores/` | 11 | 10 (91%) | 1 (9%) | 0 |
| `src/hooks/` | ~10 | ~3 (30%) | ~4 (40%) | ~3 (30%) |

---

## Browser API Dependencies (수정 필요 파일 5개)

| File | Browser API | RN Alternative | Effort |
|------|-------------|----------------|--------|
| `lib/device-id.ts` | `localStorage`, `navigator.userAgent` | MMKV + expo-device | S |
| `lib/ai/secure-storage/crypto/aes-gcm-crypto.ts` | `crypto.subtle` | expo-crypto | M |
| `stores/auth-store.ts` | `window.location.origin` | config constant | S |
| `lib/study-input-settings.ts` | `localStorage` | AsyncStorage | S |
| `lib/tts.ts` | `window.speechSynthesis`, `HTMLAudioElement` | expo-speech + expo-av | M |

---

## src/types/ — 100% Reusable

| File | Size | Status |
|------|------|--------|
| `database.ts` | 67KB | Fully portable |
| `content-blocks.ts` | 3KB | Fully portable |

---

## src/lib/ — Detailed Audit

### Fully Reusable (50+ files)

**SRS & Study Logic:**
- `srs.ts` — SRS 알고리즘 (SM-2 변형)
- `srs-access.ts` — 카드 진행 데이터 접근
- `study-queue.ts` — SrsQueueManager
- `study-history.ts` — 학습 이력
- `study-history-stats.ts` — 통계 계산
- `study-session-utils.ts` — 순차 복습, 배치 큐
- `study-exit-direction.ts` — 종료 방향 로직
- `study-summary-type.ts` — 요약 계산
- `cramming-queue.ts` — 벼락치기 큐
- `card-selection.ts` — 카드 선택/필터
- `card-utils.ts` — 카드 유틸리티
- `card-face-resolver.ts` — 앞/뒤 해석
- `rating-groups.ts` — SRS 등급 분류

**Validation & Business Rules:**
- `password-validation.ts`
- `api-key.ts` — API 키 생성/검증
- `api-validation.ts` — API 입력 검증
- `api-deck-validation.ts`
- `tier-config.ts` — 구독 티어
- `subscription-config.ts`
- `auth-errors.ts`
- `bot-detection.ts`

**Utilities:**
- `date-utils.ts`
- `time-period.ts`
- `stats.ts`
- `utils.ts`
- `locale-utils.ts`
- `sharing.ts`
- `invite.ts`
- `utm.ts`
- `referrer.ts`
- `marketplace.ts`

**AI Module:**
- `ai/ai-client.ts` — AI 호출 (fetch 기반, RN 호환)
- `ai/providers/*.ts` — 프로바이더 설정
- `ai/prompts.ts` — 프롬프트 빌더
- `ai/validators.ts` — 응답 검증
- `ai/types.ts` — AI 타입

**Admin:**
- `admin-stats.ts` — 통계 계산 (pure)

### Needs Adapter (10 files)

| File | Issue | Adapter |
|------|-------|---------|
| `device-id.ts` | localStorage, navigator | IStorage, IDevice |
| `analytics-session.ts` | sessionStorage | IStorage (memory mode) |
| `usage-quota.ts` | localStorage (has fallback) | IStorage |
| `study-input-settings.ts` | localStorage | IStorage |
| `tts.ts` | Web Speech, HTMLAudio | ITTS, IAudio |
| `ai/secure-storage/backends/local-storage.ts` | localStorage | IStorage |
| `ai/secure-storage/backends/session-storage.ts` | sessionStorage | IStorage |
| `ai/secure-storage/crypto/aes-gcm-crypto.ts` | crypto.subtle | ICrypto |
| `rate-limiter.ts` | Date.now() only (OK) | - |
| `supabase.ts` | env vars | Platform-specific init |

### Web-Only (5-8 files)

| File | Reason | Mobile Skip? |
|------|--------|-------------|
| `download-file.ts` | DOM (createObjectURL) | Use Share API |
| `scroll-depth.ts` | Window scroll events | Skip |
| `layout-styles.ts` | CSS utilities | Skip |
| `seo-config.ts` | Meta tags | Skip |
| `sitemap.ts` | Sitemap generation | Skip |
| `content-seo.ts` | SEO metadata | Skip |
| `marketplace-seo.ts` | SEO metadata | Skip |

---

## src/stores/ — Detailed Audit

| Store | Reusable | Notes |
|-------|----------|-------|
| `auth-store.ts` | Adapter needed | `window.location` → config |
| `deck-store.ts` | As-is | Pure Supabase RPC |
| `card-store.ts` | As-is | Pure Supabase RPC |
| `study-store.ts` | As-is | Pure SRS/session logic |
| `template-store.ts` | As-is | Pure Supabase RPC |
| `ai-generate-store.ts` | As-is | Uses AI client (fetch) |
| `marketplace-store.ts` | As-is | Pure Supabase RPC |
| `sharing-store.ts` | As-is | Pure Supabase RPC |
| `content-store.ts` | As-is | Pure Supabase RPC |
| `admin-store.ts` | As-is | Pure Supabase RPC |
| `subscription-store.ts` | As-is | Pure Supabase RPC |

---

## src/hooks/ — Detailed Audit

| Hook | Reusable | Notes |
|------|----------|-------|
| `useLocale.ts` | As-is | i18next (works in RN) |
| `useCountUp.ts` | As-is | Pure animation logic |
| `useTrackEvent.ts` | As-is | Analytics wrapper |
| `useKeyboardShortcuts.ts` | Logic only | Window events → RN Keyboard |
| `useContentViewTracking.ts` | Logic only | Browser APIs → RN adapters |
| `usePageTracking.ts` | Logic only | Router → Navigation |
| `useInfiniteScroll.ts` | Rebuild | IntersectionObserver → FlatList |
| `useSEO.ts` | Skip | Web-only (DOM) |
| `useScrollspy.ts` | Skip | Web-only (scroll) |
| `useScrollDepthTracking.ts` | Skip | Web-only (scroll) |
