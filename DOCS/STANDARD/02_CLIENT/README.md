# 02. 클라이언트 — 상태 · 캐시 · 데이터 접근

> 웹과 모바일이 **같은 스토어를 공유**하고 화면만 다르다는 것이 이 계층의 전제다.
> 그 전제가 깨지는 순간(사본이 갈라지는 순간)이 이 저장소가 가장 자주 다친 지점이다 → [`../01_ARCHITECTURE/modular_composition.md §1`](../01_ARCHITECTURE/modular_composition.md).

## 목차
- [1. 상태 — zustand, 미들웨어 없이](#1-상태--zustand-미들웨어-없이)
- [2. 캐시 — createStaleCache 하나로](#2-캐시--createstalecache-하나로)
- [3. 데이터 접근 — 읽기·쓰기·페이지네이션](#3-데이터-접근--읽기쓰기페이지네이션)
- [4. 낙관적 UI 와 되돌리기](#4-낙관적-ui-와-되돌리기)
- [5. 플랫폼 추상화](#5-플랫폼-추상화)
- [6. 에러를 화면까지 옮기는 규칙](#6-에러를-화면까지-옮기는-규칙)
- [7. 화면 계층 규약](#7-화면-계층-규약)
- [8. 함정](#8-함정)

---

## 1. 상태 — zustand, 미들웨어 없이

| 규칙 | 게이트 |
|---|---|
| 클라이언트 상태는 zustand v5 로만. `create<T>((set, get) => ({...}))` 비커리 형태 (커리 형태 `create<T>()(...)` 는 저장소에 0건) | 없음 (실측 29/29 준수) |
| `persist`/`devtools`/`immer`/`subscribeWithSelector` 미들웨어를 쓰지 않는다 | 없음 (실측 사용 0건) |
| 스토어 파일명은 `<name>-store.ts` (kebab-case) | 없음 |
| 진짜 스토어는 `packages/shared/stores` 에 산다. 웹 전용 상태만 `packages/web/src/stores` | `tools/check-arch.ts` (study 6경로만) |
| 영속화는 미들웨어가 아니라 명시적으로: 모바일 `local-prefs.ts`, 웹 `localStorage` 래퍼 | 없음 |

**웹 스토어의 3가지 형태와 그 의미**
- **re-export shim (11개)** — `export { X } from '@reeeeecall/shared/stores/...'`. 이것이 기본값이다.
- **웹 전용 (5개)** — `achievement`/`billing`/`confirm`/`onboarding`/`report`. shared 에 대응이 없으니 정상.
- **shared 와 별개 구현 (3개)** — `content`/`marketplace`/`subscription`. **부채다**(D5). 웹은 로컬을, 모바일은 shared 를 읽어서 이미 갈라졌다 — 예: 웹 `subscription-store` 는 shared 가 받은 `getDeviceId()` 버그 수정을 못 받았다.

> 새 스토어를 웹에 만들기 전에: 모바일도 언젠가 쓰나? → 예면 `packages/shared/stores` 에 만들고 웹에 shim 을 둔다.

## 2. 캐시 — `createStaleCache` 하나로

```ts
const deckCache = createStaleCache({ ttlMs: 5 * 60 * 1000 })   // TTL 은 전 저장소 5분
// fetch 진입부
if (!deckCache.shouldFetch('decks', opts)) return
// 성공 후
deckCache.markFetched('decks')
// 변경 액션에서
deckCache.invalidate('stats')
```

| 규칙 | 이유 | 게이트 |
|---|---|---|
| TTL 캐시는 `packages/shared/lib/cache/stale-cache.ts` 로만 만든다 | 무효화 지점을 한 곳에 모은다 | `stale-cache.test.ts` |
| **신선도(fetchedAt)를 zustand state 에 넣지 않는다** — 모듈 스코프에 둔다 | 렌더 상태가 아니다. state 에 넣으면 무효화가 `setState` 로 흩어진다 | 구조적(캐시 Map 이 모듈 클로저 안) |
| 무효화는 스토어 액션(`invalidate`/`forceRefresh`)으로만 | | `card-store-cache.test.ts` |
| 재요청 강제는 `opts?: { force?: boolean }` 시그니처로 통일 | pull-to-refresh=force, 화면 포커스=force 없음 | `marketplace-listings-cache.test.ts` |
| **실패는 무효화하지 않는다.** 성공(그리고 `wasNew`)일 때만 무효화 | 실패/멱등 재시도가 캐시를 흔들면 안 된다 | `marketplace-acquire-atomic.test.ts` |
| 시간은 주입한다(`now`) — 테스트에서 `Date` 를 가짜로 만들지 않는다 | | — |

**예외 2건(부채)**: `deck-store.ts:28-29`(모듈 스코프 타임스탬프) + `:126,136`(2초 판정)의 2초 수동 dedupe, `mobile/src/services/prefetch.ts:164` 의 `profileCache`.

## 3. 데이터 접근 — 읽기·쓰기·페이지네이션

| 규칙 | 현재 상태 |
|---|---|
| **쓰기는 `SECURITY DEFINER` RPC 로.** 스토어는 `supabase.rpc()` 를 부른다 | RPC 179회 vs 직접 DML 42회(22파일) — **aspirational** |
| 사용자 소유 콘텐츠 테이블(`cards`·`decks`·`card_templates`·`profiles`·`deck_shares`·`marketplace_listings`·`deck_study_state`·`onboarding_progress`·`user_sessions`)의 직접 DML 은 **인정된 예외** | mig 136 이 statement-level 트리거로 백스톱을 놨다 |
| 새 도메인(learning·quiz·admin·reviews·publisher·official·sync·version)은 **직접 쓰기 0건**을 유지한다 | ✅ 실측 0건 |
| 1000행을 넘을 수 있는 전체 조회는 `fetchAllRows()` 로 페이지네이션 | PostgREST `max_rows=1000`. `card-store.fetchCards` 만 미적용(부채) |
| 멱등 키가 필요한 RPC 는 `newPersistenceId()` 로 UUID 생성 | `apply_study_rating`·`finalize_study_session`·`undo_study_rating`·quiz |
| 쓰기 전 `guard.check(action, resource)`, 성공 후 `guard.recordSuccess()` | card/deck/template/study/storage 만 사용 |
| 서버 권한 프리플라이트는 **fail-open** — 값을 모르면 막지 않는다 | `useCardLimit.ts` |

**RPC 이름·인자에는 타입 안전망이 없다.** `createClient` 가 `<Database>` 제네릭 없이 호출되고
(`packages/shared/lib/supabase.ts:9`), `Functions` 타입에는 4개만 선언돼 있는데 실제 호출 RPC 는 139개다.
→ **RPC 이름을 바꾸면 컴파일러가 아무것도 잡지 못한다.** 이름 변경은 마이그레이션과 클라이언트를 같은 PR 로 묶고, 승격 전 프로덕션 적용을 지킨다([`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md)).

**순서 보장이 필요한 영속화는 Promise 체인으로 직렬화한다.**
`study-store` 의 `persistenceChain` — apply → undo → finalize 순서가 뒤집히면 서버가 P0002/PT409 로 거절한다. 체인은 절대 reject 되지 않게 catch 로 삼키고, 실패는 `persistenceError` 로 화면에 표면화한다.

## 4. 낙관적 UI 와 되돌리기

- **낙관적 갱신**: DB 쓰기 전에 `set()` 하고, 실패는 자동 롤백이 아니라 `persistenceError` 로 **보이게** 한다.
- **undo 는 서버 보상이 성공한 뒤에만 로컬 롤백한다.** 반대로 하면 화면은 취소됐다고 하고 DB 에는 평가가 남아, 다시 평가하면 두 번 기록된다.
- `reviews-store` 처럼 `// Optimistically update` 주석을 달고 실제로는 RPC 성공 후 `set()` 하는 곳이 있다 — **주석을 사실에 맞춘다.**

## 5. 플랫폼 추상화

- 플랫폼 의존 기능은 `packages/shared/adapters` 의 포트로 선언하고 앱 부팅 시 `initAdapters()` 로 주입한다.
- **구현을 화면에서 직접 `new` 하지 않는다.** 현재 위반: `StudySessionScreen.tsx:30` 의 `new RNTTS()`.
- **shared 코드에서 `window.*` 를 쓰지 않는다.** RN 에는 없다. 현재 위반: `auth-store.ts:153,167,178` 의 `window.location.origin`(포트 `getOrigin()` 이 이미 있다).
- 포트를 새로 만들 때의 비용은 6파일 → [`../01_ARCHITECTURE/extension_points.md §8`](../01_ARCHITECTURE/extension_points.md).

⚠️ `packages/shared` 는 `lib: ["ES2022"]`(DOM 없음)을 선언하지만 **그 tsconfig 를 실행하는 CI 스텝이 없다.**
실제 타입체크는 웹 `tsconfig.app.json`(DOM 포함)이 흡수해서 하므로, shared 에 DOM 전용 코드가 들어가도 **웹 CI 는 초록이고 모바일 런타임에서만 터진다.** 현재 `window` 전역을 참조하는 shared 파일은 2개다 — `stores/auth-store.ts`(153·167·178줄의 `window.location.origin`, DOM 없이는 컴파일 불가)와 `stores/subscription-store.ts:192`(`typeof window !== 'undefined'` 개발용 가드). `document`/`localStorage` 전역 참조는 0건이다.

## 6. 에러를 화면까지 옮기는 규칙

| 규칙 | 근거 |
|---|---|
| **`const { data } = await rpc(...)` 로 에러를 삼키지 않는다.** 실패와 "데이터 없음"이 화면에서 같아 보인다 | 빈 차트와 고장난 차트가 똑같이 생겨서, 권한 거부 → statement timeout 2단 원인이 출시 내내 안 보였다(`d3d5af15`) |
| 엣지 함수 실패는 `{ error, code }` 로 오고 **클라이언트는 `code` 로만 분기**한다. 문구는 클라이언트가 고른다 | `packages/shared/lib/ai/refusal.ts` |
| supabase-js 는 non-2xx 바디를 `error.context` 에 숨긴다 — 거기서 읽는다 | `packages/shared/lib/ai/server-client.ts:59-81` |
| 스토어의 `error` 필드에는 **i18n 키**(`'errors:<ns>.<key>'`)를 넣는다 | 현재 i18n 키 6건 vs 원시 `error.message` 32건 — **aspirational**, 새 코드는 키로 |
| 사용자 알림은 웹 `sonner` toast, 모바일 `Alert.alert` | 두 벌인 것은 플랫폼 차이라 인정. 문구는 i18n 키에서 |

**에러 리포팅(Sentry 등)은 아직 없다.** `analytics-logger.ts` 에 자리만 있다. 그러므로 **삼킨 에러는 영원히 보이지 않는다** — 위 첫 줄 규칙의 무게가 그만큼 크다.

## 7. 화면 계층 규약

| | 웹 | 모바일 |
|---|---|---|
| 데이터 접근 | 페이지가 스토어·supabase 를 직접 호출 (모바일 같은 도메인 래퍼 훅 레이어는 없고, `src/hooks/` 14개는 횡단 관심사용) | `packages/mobile/src/hooks/{useDecks,useCards,useStudy,...}` 래퍼 훅 경유가 **목표**이나 실측은 절반 — 30개 화면 중 14개만 래퍼 훅 경유, 14개가 shared 스토어를 직접 구독하고 13개가 `getMobileSupabase()` 를 직접 호출한다(부채) |
| 갱신 트리거 | `useEffect` | **`useFocusEffect`** 가 **지향점** — 다른 화면에서 수정하고 돌아왔을 때 stale 방지. 실사용은 `hooks/useDecks.ts`·`hooks/useCards.ts`·`StudySetupScreen.tsx` 3곳뿐이고 나머지 화면은 `useEffect` 를 쓴다. 새 화면은 훅 경유 + `useFocusEffect` 로 만든다 |
| 라우팅 | react-router, `App.tsx` 에 `<Route>` 56개(`path` 지정 52 · `lazy()` 20) | React Navigation 스택 파일 8개 + Drawer |
| 파일명 | `PascalCase.tsx` (`ui/` 의 shadcn 프리미티브만 소문자) | `PascalCase.tsx` |

- 모바일에서 새 화면을 만들면 **스택 화면은 한 번만 마운트된다**는 것을 기억한다 — `route.params` 를 `useState` 초기값으로 읽으면 두 번째 진입에서 갱신되지 않는다(실제 사고: 마법사가 첫 모드에 머무름). → [`../12_MOBILE`](../12_MOBILE/README.md)
- 목록은 모바일에서 `FlatList`/`SectionList` 를 쓴다(실측 14화면). 웹에는 가상화 라이브러리가 없다 — 큰 목록을 새로 만들 때는 서버 페이지네이션을 먼저 고려한다.

## 8. 함정

- **웹에 supabase 클라이언트가 2개 산다.** `packages/web/src/lib/supabase.ts` 가 자체 `createClient` 를 export 하면서 `initSupabase()` 도 부르고, `adapters/index.ts` 도 `initSupabase()` 를 부른다. `initSupabase` 는 호출할 때마다 새 클라이언트로 **교체**한다 → 웹 UI 41파일과 shared 스토어 18개가 서로 다른 GoTrue 인스턴스를 쓸 수 있다. (부채 D6)
- **테스트에서 supabase mock 경로를 잘못 고르면 mock 이 안 먹는다.** 웹 로컬 모듈을 mock 해도 shared 스토어는 shared 모듈을 import 한다. 현재 `vi.mock('@reeeeecall/shared/lib/supabase')` 23건 / 웹 로컬 경로 mock 19건(`'../../lib/supabase'` 17 · `'../../../lib/supabase'` 1 · `'../lib/supabase'` 1)이 공존한다.
- **모바일은 `useAuthStore.initialize()` 를 부르지 않는다**(호출은 웹 `App.tsx:166` 한 곳). 모바일 인증은 `useAuthState.ts` 가 따로 관리하므로 shared auth-store 의 `user` 는 모바일에서 영원히 null 이다 — 모바일 화면에서 `useAuthStore(s => s.user?.id)` 를 읽으면 그 분기는 절대 실행되지 않는다(`LearningGoalsScreen.tsx:65,91` 가 그 상태).
- **`createCards` 진입 시 `set({ error: null })`**(`card-store.ts:207`)은 이전 실패의 잔여 error 가 이번 호출의 결과로 오인되지 않게 한다 — 이 초기화가 없어 성공한 재시도가 캐시 무효화를 건너뛰고 새 덱 카드 수가 0에 고정된 사고가 있었다. (현재 무효화 게이트는 `if (!get().error)` 가 아니라 `if (totalInserted > 0)`(`:263`)로 바뀌어 부분 성공도 반영한다.)
- **`packages/shared` 소스 디렉터리의 컴파일 `.js`/`.d.ts` 트윈(현재 29개)** — 커밋 금지이고, 소스 스캔 테스트는 `.js` 를 제외해야 한다.

## 관련 문서
[`../01_ARCHITECTURE/modular_composition.md`](../01_ARCHITECTURE/modular_composition.md) · [`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) · [`../10_I18N`](../10_I18N/README.md) · [`../12_MOBILE`](../12_MOBILE/README.md)
