# 확장점 인벤토리 — "이걸 추가하려면 어디를 고치나"

> 이 저장소에 **실재하는** 확장점 전부와, 항목 하나를 추가할 때 실제로 손대는 파일 수.
> 새 기능을 붙이기 전에 여기서 해당 축을 찾는다. 축이 없으면 [`modular_composition.md §8`](modular_composition.md#8-확장-메커니즘-5종--쪼갠다를-어떤-형태로-하나) 의 선택 기준표로 새로 만든다.
>
> 소비자 수는 2026-08-16 실측(프로덕션 코드 기준, 테스트 전용은 별도 표기).

## 한눈에 — 건강한 확장점 vs 이름만 확장점

| 확장점 | 메커니즘 | 소비자 | 항목 1개 추가 비용 | 상태 |
|---|---|---|---|---|
| AI 학습 허브 카탈로그 | 레지스트리 | 12 | 코드 5 + 로케일 16 | ✅ 건강 |
| `aiHubBus` | 이벤트 버스 | 16 | 1파일 | ✅ 건강 |
| `LOCALE_REGISTRY`(worker) | 레지스트리 | 8 | 1파일 | ✅ 건강 |
| DB 정책 테이블(무료·가격·난이도) | 데이터 레지스트리 | 3~5 | **SQL 1행, 코드 배포 0**(마이그레이션 수동 적용은 필요) | ✅ 건강 |
| `PROVIDERS` (AI 제공자) | 레지스트리 | 2 | 2파일 + 가격 마이그레이션 | ✅ 건강 |
| `createStaleCache` | 커널 | 6 | 스토어 안 1블록 | ✅ 건강 |
| `is_admin()` / `_check_deck_access()` | DB 커널 | 78 / 5 | 호출 1줄 | ✅ 건강 |
| 학습 도메인 카탈로그 | 레지스트리 | 3 | 2파일 | ⚠️ 소비자 얇음 |
| `Registry<T>` / `EventBus<E>` 커널 | 커널 | 2 / 1 | 1파일 | ⚠️ 실사용 1기능 |
| 플랫폼 포트(`initAdapters`) | 포트&어댑터 | 2 (포트 7 중 **5개 소비자 0**) | **6파일** | ⚠️ 값 미회수 |
| 결제 프로바이더 | 포트&어댑터 | 3 | 2파일 | ⚠️ 선택이 하드코딩 |
| 지식(knowledge) 기준 카탈로그 | 레지스트리 | 0 (테스트만) | 2파일 | ❌ 프로덕션 소비자 0 |
| `PAID_ACTIONS` | 레지스트리 | 2 (`refusalFallbackKey` 경유 — 웹·모바일 `AiRefusalNotice.tsx`) | 1파일 | ⚠️ 직접 import 는 테스트뿐, 읽히는 필드는 `freeFallbackKey` 하나 |
| `ci.yml` SQL 스위트 목록 | 수동 목록 | 51 | **손으로 1줄** | ⚠️ 빠뜨리면 무음 |
| 봇 라우트(`PAGE_ROUTES`+`BOT_HANDLERS`) | 레지스트리 2분할 | 1 | 3파일 | ⚠️ 패턴만 넣으면 무음 SPA 셸, 핸들러만 넣으면 무음 404 |

**❌/⚠️ 를 새로 만들지 않는 법** → 제1원칙 §5("읽는 사람 없는 것은 없는 것과 같다") + R5(우회 가드).

---

## 1. AI 학습 기능 추가

**등록**: `packages/shared/lib/ai/hub/catalog.ts` 에 `.register({...})` 1줄

**같이 고칠 것 (총 20곳 — 위 등록 파일 포함 시 21)**
1. `packages/web/src/App.tsx` — `<Route>`
2. `packages/mobile/src/navigation/AIStack.tsx` — `<Stack.Screen>`
3. `packages/mobile/src/navigation/types.ts` — `AIStackParamList` 키
4. `packages/mobile/src/screens/ai/aiHubRoutes.ts` — `AI_HUB_STACK_SCREENS`
5. `packages/web/public/locales/*/ai-generate.json` 8개 + `packages/mobile/src/i18n/locales/*/ai-generate.json` 8개 (`hub.entries.<camelCase 키>.title/.desc` — 키는 엔트리 `id` 가 아니라 descriptor 의 `titleKey`/`descKey` 가 정한다. 예: id `learning_plan` → `hub.entries.learningPlan.title`)

**손대지 않는 것**: 메뉴 4표면(웹 nav·웹 허브·모바일 드로어·모바일 허브). 손대면 `ai-hub-not-hardcoded.test.ts` 가 red.

**결정할 것**: `poweredBy: 'model' | 'device'`. `'model'` 이면 AI 배지와 크레딧 안내가 자동으로 따라온다
(판단은 필드가 아니라 파생 술어 `isAiBadgeEligible` / `aiFeatureRequiresCredits` 로만).

**게이트**: `ai-hub-catalog.test.ts` · `ai-hub-not-hardcoded.test.ts` · `ai-hub-kernel-no-dead-exports.test.ts` · i18n 게이트 3종
**상세**: [`../AI-HUB.md`](../AI-HUB.md)

## 2. AI 제공자·모델 추가

- **모델만 교체**: **0파일.** Supabase edge secret `AI_GENERATION_MODEL` / `AI_VISION_MODEL` / `*_MODEL_FALLBACKS`.
- **새 제공자**: `supabase/functions/_shared/ai-providers.ts` 의 `PROVIDERS` 1엔트리 + `ai_pricing_config` 요율 행 마이그레이션 1개.

**반드시 같이**: 요율 행이 없으면 폴백 단가($5/$15 per Mtok)로 **43배 과금**된다(실측 사고).
`supabase/tests/unpriced_model_test.sql` 의 체인 배열이 **gemini 하드코딩**이라 새 제공자는 이 검사에 자동으로 포함되지 않는다 — 배열도 같이 넓힌다.

**체인 순서 규칙**: 항상 **싼 것부터**. 비싼 모델이 앞에 오면 폴백이 마진 사고가 된다(`ai-provider-chain.test.ts` 가 검사).

## 3. 유료 AI 액션(kind) 추가

`supabase/functions/ai-generate/index.ts` 는 커널이 아니라 **1,535줄 파일**이고, kind 분기는 `Deno.serve` 핸들러(600–1535행, 약 936줄) 안의 if-체인이다. 최소 5파일:

1. `ai-generate/index.ts` — kind 유니온 + 분기 + 에러코드 매핑 + CORS/해제 호출
2. `packages/shared/lib/ai/server-client.ts` — `ServerGenerateRequest` 유니온
3. `packages/shared/lib/ai/refusal.ts` — `PaidActionId` + `PAID_ACTIONS`
4. 마이그레이션 — `ai_generation_jobs.job_kind` CHECK 확장 + `ai_action_prices`/`ai_quiz_price_units` 행 + `ai_free_allowances` 행
5. 예약 RPC 1개 (`reserve_ai_*`)

**계약**: 예약 → (성공)과금 / (실패)해제 3단계. 예약은 원장에 아무것도 쓰지 않는다.
자세히 → [`../05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md)

## 4. 학습 도메인 추가

`packages/shared/learning/adapters/domain-adapters.ts` 에 어댑터 + `domain-catalog.ts` 에 `.register()` = **2파일**.
마이그레이션 불필요(`learning_goals.domain_id` 는 `text CHECK (<> '')`).

**주의**: 등록만으로는 앱 동작이 바뀌지 않는다. 어댑터의 `activityMix`/`supportedActivityTypes` 가
`packages/shared/stores/learning-store.ts` 의 `buildDailyPlan` 호출부까지 **전달되는지** 확인한다(과거 사고).

## 5. 무료 한도·가격 변경

| 하려는 일 | 어디 | 파일 |
|---|---|---|
| 무료 개수 변경 | `ai_free_allowances` `UPDATE` | 마이그레이션 1개 |
| 새 티어/행동그룹 무료화 | `ai_free_allowances` `INSERT` | 마이그레이션 1개 |
| 액션 정가 변경 | `ai_action_prices` `UPDATE` | 마이그레이션 1개 |
| 퀴즈 유닛 수 변경 | `ai_quiz_price_units` | 마이그레이션 1개 |

**금지**: `price_micro * 10` 같은 **곱셈 갱신**. 마이그레이션은 로컬·프로덕션·CI 재생성으로 여러 번 돈다 —
초안을 두 번 적용해 가격이 100배가 된 적이 있다. 절댓값 + 이전 값 `WHERE` 가드로 쓴다(mig 230).
**금지**: `target_margin_bps` 를 가격 인상 노브로 쓰기 — 그 값은 동시에 `ai_cost_ledger.under_target` 의 정의라, 올리면 과거 job 이 하룻밤에 전부 빨개진다.

## 6. SQL 어서션 스위트 추가

`.github/workflows/ci.yml` 의 `ai-credit-tests` 잡에 **손으로** 등록해야 실행된다. 글롭이 아니다.

- 새 파일은 `:383-401` 의 `for f in \` 묶음 루프에 **1줄** 추가하는 것이 현재 관례.
- 등록을 잊으면 파일은 커밋되고 CI 는 초록인 채로 **영원히 안 돈다.** 실제로 `quiz_set_delete_test.sql` 이 그 상태였고(안 도는 동안 프로덕션에서 퀴즈 삭제가 23503 으로 실패), 같은 조사에서 **9개가 더** 발견됐다(커밋 1de45600). 현재 묶음 루프에는 11개가 들어 있다.
- 확인법: `for f in supabase/tests/*_test.sql; do grep -q "$(basename $f)" .github/workflows/ci.yml || echo "미등록: $f"; done`

## 7. 로케일 네임스페이스·문자열 추가

- 새 문자열 1개(양 플랫폼) = **로케일 JSON 16파일**.
- 새 네임스페이스 = 웹 `i18n/index.ts` ns[] 1줄 + JSON 8 / 모바일 `i18n/index.ts` require 8줄 + ns[] + `i18n.test.ts` NAMESPACES + JSON 8.
- 모바일은 **동적 경로를 번들러가 인식하지 못해** require 를 줄여 쓸 수 없다.

상세·함정 → [`../10_I18N`](../10_I18N/README.md)

## 8. 플랫폼 포트 추가

**6파일**: `packages/shared/adapters/<name>.ts` → `adapters/index.ts`(타입 export + `AdapterConfig` 필드 + getter) →
`packages/web/src/adapters/web-<name>.ts` → `web/src/adapters/index.ts` → `packages/mobile/src/adapters/rn-<name>.ts` → `mobile/src/adapters/index.ts`.

**만들기 전에**: 구현이 정말 2개인가? 현재 7포트 중 5개가 소비자 0이다. 포트는 싸지 않다.

## 9. 결제 프로바이더 추가

`packages/web/src/lib/payments/<x>-provider.ts` + `payments/index.ts`(`PaymentProviderId` union · `VALID_IDS` · `makeProvider` switch) = 2파일.
**3파일째**: `preferredProviderId()` 가 `'lemonsqueezy'` 를 하드코딩하고 있어 고치지 않으면 새 어댑터는 선택될 수 없다.
결제 계열 전체 계약 → [`../11_SECURITY`](../11_SECURITY/README.md)

## 10. 봇 프리렌더 라우트 추가

`worker-modules/seo/page-registry.js`(패턴) + `worker-modules/seo/handlers/<x>.js`(핸들러) + `worker.js`(`BOT_HANDLERS` 1줄) = 3파일.
**패턴과 핸들러가 다른 파일에 살고 서로를 검증하지 않는다** — 패턴만 넣으면 `if (handler)` 를 건너뛰고 SPA 셸이 봇에게 나가고(프리렌더 없음), 핸들러만 넣으면 `matchBotRoute` 가 null 이라 `else if` 의 `handleBotNotFound()` 로 조용히 404 가 된다.

## 11. 캐시가 필요한 스토어

`createStaleCache({ ttlMs })` 를 스토어 상단에 선언 → fetch 진입부 `shouldFetch(key, opts)` → 성공 후 `markFetched(key)` → 변경 액션에서 `invalidate(key)`.
TTL 은 저장소 전체가 **5분**으로 통일돼 있다. 다른 값을 쓰려면 사유를 주석에 적는다.
상세 → [`../02_CLIENT`](../02_CLIENT/README.md)
