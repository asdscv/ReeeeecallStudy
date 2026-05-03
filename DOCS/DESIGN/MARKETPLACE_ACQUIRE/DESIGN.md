# Marketplace Acquire Flow — Hardening Design

브랜치: `fix/marketplace-acquire-hardening`
작성일: 2026-05-03
표준 준거: `/DOCS/STANDARD/01_ARCHITECTURE`, `/04_DATABASE`, `/06_RESILIENCE`, `/07_TESTING` (rictax repo)

---

## 1. 문제 정의 (Problem Statement)

마켓플레이스에서 사용자가 deck을 acquire할 때 다음 결함이 존재한다.

| # | 결함 | 표준 위반 | 영향 |
|---|---|---|---|
| D1 | `deck_shares (recipient_id, deck_id, share_mode)` UNIQUE 부재 | DB 무결성 (04_DATABASE) | 중복 acquire 시 share 행 N개 / copy 모드는 deck N개 복사 |
| D2 | acquireDeck이 4개 호출(`select listing` + `insert share` 또는 `rpc copy` + `insert share` + `rpc init_progress` + `rpc increment_count`)을 atomic하지 않게 실행 | 트랜잭션 경계 (06_RESILIENCE) | 중간 실패 시 partial state — share 없는 deck, progress 없는 share 등 |
| D3 | 일부 RPC(`init_subscriber_progress`, `increment_acquire_count`) 결과의 error 무시 | 에러 핸들링 (07_TESTING resilience) | 사용자에 'Success' 알림 후 학습 시 카드 0건 |
| D4 | UI: `hasAcquired=true`여도 Get Deck 버튼이 활성 | UX 가드 | 사용자 빠른 더블탭 → 중복 호출 |
| D5 | 캐시 무효화는 store에서 처리하지만 web 화면(`MarketplaceDetailPage`)은 force refetch 없음 | UI 일관성 | 웹에서 My Decks 진입 시 5분 stale window 동안 누락 가능 |

---

## 2. 설계 원칙 (적용 표준)

### 2.1 헥사고날 4-Layer (01_ARCHITECTURE)

| Layer | 위치 | 책임 |
|---|---|---|
| L1 — Port + Adapter | `packages/shared/lib/supabase.ts` | Supabase client (단일 외부 의존) |
| L2 — Domain Policy | DB function `acquire_listing(...)` SECURITY DEFINER | 멱등성 + atomicity 정책. 비즈니스 invariant 캡슐화 |
| L3 — Use Case | `marketplace-store.ts :: acquireDeck()` | 단일 RPC 호출 + 캐시 무효화. 부수효과 최소화 |
| L4 — Inbound Adapter | `MarketplaceDetailScreen.tsx` (mobile) / `MarketplaceDetailPage.tsx` (web) | 사용자 인터랙션, 가드, navigation |

### 2.2 DDD 패턴

- **Atomic Aggregate**: `acquire_listing` RPC는 `(deck_shares INSERT) + (cards/progress 초기화) + (acquire_count UPDATE)` 를 단일 트랜잭션으로 처리. PostgreSQL function은 자동 트랜잭션이며 예외 발생 시 전체 롤백.
- **Idempotency**: partial unique index `deck_shares (recipient_id, deck_id, share_mode) WHERE status='active'` + RPC 내부 `INSERT ... ON CONFLICT DO NOTHING` + already-acquired 시 기존 deck_id 반환.
- **Domain Exception → HTTP Status**: PostgREST는 `RAISE EXCEPTION USING ERRCODE` 코드를 HTTP status로 매핑. 본 RPC는 `P0001`(business rule), `P0002`(not found) 사용 → 클라이언트는 error.code 분기.

### 2.3 Resilience (06_RESILIENCE)

- 모든 외부 호출(여기선 supabase RPC) 실패 시 명시적 error 반환 — silent swallow 금지
- 클라이언트는 error 발생 시 절대 success UI 노출 안 함 (`if (result == null) return`)

### 2.4 Testing (07_TESTING)

- **Unit (Vitest)**: store mock 기반 — 5개 invariant
- **Integration (Real Docker)**: supabase local + 실 RPC 실행 — atomicity, unique 제약, 멱등성 검증
- **Architecture guard**: import-linter 등가물 — domain 모듈이 supabase를 직접 import하지 않음

---

## 3. Target Architecture

### 3.1 데이터 흐름 (Subscribe / Copy / Snapshot 통합)

```
사용자 클릭
    │
    ▼
MarketplaceDetailScreen.handleAcquire()
    │  (button disabled if hasAcquired || acquiring)
    ▼
useMarketplaceStore.acquireDeck(listingId)
    │  (단일 호출)
    ▼
supabase.rpc('acquire_listing', { p_listing_id })
    │
    ├── BEGIN TX (자동)
    │
    │   1. listing 조회 + 검증 (active, not own)
    │   2. share_mode 분기:
    │      - subscribe: deck_id 그대로 사용
    │      - copy/snapshot: copy_deck_for_user 호출 (내부 호출)
    │   3. deck_shares INSERT ... ON CONFLICT DO NOTHING
    │      (이미 있으면 기존 row 그대로 사용 — 멱등)
    │   4. user_card_progress 초기화 (subscribe 모드만)
    │   5. acquire_count++ (단, 신규 acquire 시에만)
    │
    ├── COMMIT (정상)  ▶ {deck_id, was_new: bool} 반환
    │
    └── ROLLBACK (예외) ▶ error 반환
    │
    ▼
useMarketplaceStore: result null이면 종료 / 아니면 cache invalidate
    │
    ▼
UI: hasAcquired=true, navigate back, Toast/Alert
```

### 3.2 Layer 책임 매트릭스

| 책임 | 위치 | 위치 외 절대 금지 |
|---|---|---|
| 멱등성 보장 | DB UNIQUE INDEX + RPC | 클라이언트에서 사전 SELECT로 체크 X |
| Atomicity | DB function (단일 TX) | 클라이언트에서 다단계 호출 X |
| 검증 (own deck, active) | RPC 내부 RAISE | 클라이언트 단독 검증 X (이중은 허용) |
| 캐시 무효화 | use-case (store) | UI에서 직접 deck-store 접근 X |
| Navigation, Toast | UI | store/RPC가 알지 못함 |

---

## 4. 변경 명세

### 4.1 DB (`supabase/migrations/081_marketplace_acquire_atomic.sql`)

1. **partial unique index** (active subscribe/copy/snapshot 중복 방지)
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uniq_ds_recipient_deck_active
   ON deck_shares (recipient_id, deck_id, share_mode)
   WHERE status = 'active';
   ```
2. **acquire_listing RPC** — 단일 atomic 호출 (SECURITY DEFINER)
3. **error code 표준**:
   - `P0002` — listing not found / inactive
   - `P0001` — own listing acquire 시도

### 4.2 Shared store (`packages/shared/stores/marketplace-store.ts`)
- `acquireDeck`: 4개 supabase 호출 → 1개 RPC로 단순화
- 반환 타입: `Promise<{ deckId: string; wasNew: boolean } | null>`
- 캐시 무효화는 wasNew=true일 때만 수행 (불필요한 re-fetch 방지)

### 4.3 Web store (`packages/web/src/stores/marketplace-store.ts`)
- shared와 동일 변경. 과거 web fork 이력 때문에 별도 파일 유지.

### 4.4 Mobile UI (`packages/mobile/src/screens/MarketplaceDetailScreen.tsx`)
- `<Button disabled={hasAcquired || acquiring}>` — 중복 클릭 가드
- 이미 보유 시 버튼 라벨: `t('detail.alreadyAcquired')`

### 4.5 Web UI (`packages/web/src/pages/MarketplaceDetailPage.tsx`)
- 동등 적용 + `useDeckStore.fetchDecks({ force: true })` 호출

### 4.6 Architecture guard
- `tools/check-arch.ts` — domain (`packages/shared/lib/`) 모듈이 supabase를 import하지 않음을 검증 (현재는 store만 supabase import 허용)

---

## 5. Test Plan (TDD Red → Green)

### 5.1 Unit (Vitest, mock supabase)

`packages/web/src/stores/__tests__/marketplace-acquire-atomic.test.ts`

| # | 시나리오 | 기대 |
|---|---|---|
| T1 | 신규 acquire (subscribe) | RPC 1회 호출, result.wasNew=true, cache invalidated |
| T2 | 신규 acquire (copy) | RPC 1회 호출, result.deckId === newDeckId |
| T3 | 중복 acquire (이미 보유) | RPC 1회, result.wasNew=false, cache 유지 |
| T4 | RPC error (P0001 own listing) | result null, cache 유지, error 메시지 |
| T5 | RPC error (P0002 not found) | result null, cache 유지 |
| T6 | RPC network error | result null, cache 유지 |
| T7 | 동시 더블탭 (Promise.all 2회) | RPC 2회 호출되더라도 DB UNIQUE가 보장 — store 입장에선 둘 다 정상 result |

### 5.2 Integration (Real Supabase via Docker)

`tests/integration/marketplace-acquire.spec.ts`

| # | 시나리오 | 기대 |
|---|---|---|
| I1 | 실 RPC 호출, 신규 subscribe | deck_shares 1행, user_card_progress 카드 수만큼 |
| I2 | 같은 사용자 2회 호출 | deck_shares 여전히 1행 (UNIQUE 작동) |
| I3 | copy 모드 2회 호출 | deck 1개만 복사 (UNIQUE on share + 내부 가드) |
| I4 | own listing 시도 | P0001 RAISE, deck_shares 변동 없음 |
| I5 | acquire 직후 deck-store fetchDecks → 신규 deck 즉시 표시 |
| I6 | RPC 내부 일부 실패 (cards INSERT 실패 강제 주입) | TX rollback → deck_shares 0행 |

### 5.3 Architecture (`tests/architecture/test_no_supabase_in_lib.spec.ts`)
- `packages/shared/lib/` 하의 모든 .ts 가 `from .../supabase` import 없음

---

## 6. 마이그레이션 안전성

- 기존 데이터에 중복 active share 가 존재할 가능성 검사: 마이그레이션 첫 단계에서 중복 row 정리 (`DELETE` keep latest)
- pre-commit / CI에서 `pg_dump --schema-only` 비교 등은 스코프 외

---

## 7. CI/CD (09_DEPLOYMENT)

`.github/workflows/ci.yml`

1. **lint+typecheck**: `pnpm tsc --noEmit` (web/mobile/shared)
2. **unit**: `pnpm test` (vitest)
3. **integration**: docker-compose up supabase + `supabase db reset` + vitest integration
4. **architecture**: `pnpm tsx tools/check-arch.ts`
5. **EAS build dry-run**: `eas build --platform all --profile preview --non-interactive --no-wait` (PR label 시에만)

`.github/workflows/release.yml`

- main push 시 `eas update --branch production --auto` 자동 OTA 배포 (네이티브 변경 없을 때)
- 네이티브 변경 감지(`packages/mobile/{android,ios,app.json}` 변경) 시 OTA 차단 + 빌드 라벨링 알림

---

## 7.5. Out-of-scope follow-ups (별도 PR)

스코프 외로 식별 — 이번 PR에서는 처리하지 않음:

| FU# | 항목 | 우선순위 |
|---|---|---|
| FU1 | `packages/web/src/lib` 의 supabase 직접 의존 분리 (storage.ts, stats.ts, tts.ts) — 헥사고날 위반이나 기존 부채 | P2 |
| FU2 | Mobile theme-store typecheck 에러 정리 | P2 |
| FU3 | Sentry/observability 연동 — 클라이언트 acquire 에러 telemetry | P3 |
| FU4 | acquire RPC retry policy (transient network 실패 시 자동 재시도) — 현재는 사용자 재시도 시 idempotent | P3 |
| FU5 | Integration test cleanup hook (afterEach: 생성한 user/listing 삭제) | P3 |
| FU6 | shared 패키지의 컴파일 산출물(.js/.d.ts) 자동 정리 — 현재는 .gitignore + metro `sourceExts` 명시로 가드. 빌드 파이프라인 정리 필요 | P2 |

---

## 8. Definition of Done (Gap Closure Criteria)

- [ ] D1~D5 결함 모두 코드/스키마/UI에서 폐쇄
- [ ] T1~T7 unit 테스트 green
- [ ] I1~I6 integration 테스트 green (실 docker supabase)
- [ ] Architecture guard green
- [ ] CI 워크플로 green
- [ ] 표준 문서 cross-ref 완비
- [ ] 갭 검증 루프에서 새로운 갭 0건
