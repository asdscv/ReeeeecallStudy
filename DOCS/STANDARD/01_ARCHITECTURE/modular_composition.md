# 모듈식 (modular composition) — 이 저장소의 **제1원칙**

> **능력을 모듈로 쪼갠다. 소비자는 필요한 것만 골라 쓴다. 모듈은 공유 범위만큼 위로 올린다.**
>
> 이 원칙은 다른 모든 규칙보다 앞선다. 새 코드를 쓰기 전에 **"이건 어느 층의 모듈인가"** 를 먼저 답한다.

**이 문서가 SSOT 다.** `DOCS/STANDARD/README.md` 와 `01_ARCHITECTURE/README.md` 는 요약이며 여기를 가리킨다.
충돌하면 이 문서가 우선한다.

**두 질문, 한 문서**
- **어디에 두나 / 누가 쓰나** → §1~§7 (계층 · hoist · 규칙 R1~R5 · 실패 사례)
- **어떤 형태로 쪼개나** → **[§8 확장 메커니즘 5종](#8-확장-메커니즘-5종--쪼갠다를-어떤-형태로-하나)**
  — 커널 · 플러그인 레지스트리 · 포트&어댑터+DI · 이벤트 버스 · 파이프 앤 필터

---

## 1) 왜 — 같은 것을 두 곳에 두면 두 곳이 각각 절반씩 틀린다

이 저장소는 **하나의 학습 제품을 웹·모바일·엣지·DB 네 런타임에 동시에 배포**한다.
같은 규칙(SRS 계산, 정답 판정, 가격, 로케일)이 네 곳에서 다시 필요해지고,
그때마다 복사하면 **복사본은 조용히 갈라진다**. 이건 가정이 아니라 이 저장소의 실측이다:

| 사고 | 결과 | 근거 |
|---|---|---|
| `packages/web/src/lib/stats.ts` 가 shared 사본과 갈라짐 | 연속학습일(streak) 계산이 웹과 모바일에서 서로 다른 숫자를 보여줌 (웹=오늘 안 하면 0, shared=어제 했으면 유지) | `packages/web/src/lib/stats.ts:95`, `packages/shared/lib/stats.ts:95` |
| 웹이 스터디 엔진 복사본을 보유 | 손으로 미러링해야 했고, 누락되면 웹 테스트는 웹 사본만 검증해서 **모바일이 조용히 옛 동작 유지** | `tools/check-arch.ts:74-88` |
| 클라이언트 배치 크기와 서버 `MAX_QUIZ_BATCH` 가 다른 패키지에 각각 존재 | 서술형 퀴즈가 기능 존재 내내 100% `AI_REQUEST_TOO_LARGE` 로 실패 | `packages/web/src/lib/__tests__/quiz-batch-size.test.ts` |
| 모델 체인과 가격표가 따로 움직임 | 학습자에게 **43배 과금**(실측 50,325 vs 1,095) | `supabase/tests/unpriced_model_test.sql`, mig 214 |

**그래서 규칙은 "복사하지 마라"가 아니다.** 런타임 경계 때문에 복사가 불가피한 곳이 실제로 있다
(엣지 함수는 `packages/` 를 import 할 수 없다). 규칙은 이것이다:

> **복사가 불가피하면, 두 사본이 갈라지는 순간 빨개지는 테스트를 같이 만든다.**

---

## 2) 계층 — 모듈이 살 수 있는 자리

아래로 갈수록 공유 범위가 넓다. **위 계층은 아래 계층만 import 한다 — 아래 계층은 위 계층을 import 할 수 없다.**

| 계층 | 경로 | 무엇이 사는가 | 무엇을 import 할 수 있나 |
|---|---|---|---|
| L4 앱 | `packages/web/src`, `packages/mobile/src` | 화면·라우팅·플랫폼 UI | shared 를 import (`@reeeeecall/shared/<subpath>`) |
| L3 공유 유스케이스 | `packages/shared/stores` | zustand 스토어 = 유스케이스. supabase 접근은 여기까지 | lib·types·adapters |
| L2 공유 도메인 | `packages/shared/lib`, `packages/shared/learning` | 순수 함수·커널·레지스트리. **supabase 금지** | types·adapters |
| L1 포트 | `packages/shared/adapters` | 플랫폼 인터페이스만. 구현 없음 | 아무것도 import 하지 않음 |
| L0 타입 | `packages/shared/types` | DB 타입·도메인 타입 | 없음 |
| 서버 | `supabase/functions`, `supabase/migrations` | 엣지(Deno)·RPC·정책 테이블 | `packages/` **import 불가**(배포 단위가 다름) |
| 엣지 | `worker-modules/`, `worker.js` | Cloudflare Worker(순수 ESM JS) | pnpm workspace 밖 — packages 참조 금지 |

**방향 검증(실측 2026-08-16)**: `packages/shared` → web/mobile 역참조 0건, web ↔ mobile 상호 import 0건.
shared 내부는 `types ← lib ← stores`(stores→lib 59, lib→types 28). 역방향 1건 존재
(`packages/shared/lib/learning-attempt-selection.ts:10` → stores) — 부채로 §7 에 기재.

**게이트**: `tools/check-arch.ts` (CI job `arch-guard`) 가 검사하는 것은 두 가지뿐이다 —
Rule 1: `packages/shared/lib/**` 의 supabase 금지(`DOMAIN_ROOTS` 가 `packages/shared/lib` 하나뿐이라 위 표가 L2 로 분류한 `packages/shared/learning` 은 대상 밖),
Rule 2: 스터디 엔진 6개 파일이 `packages/web/src` 에 재등장하면 exit 1(§4 R3).
계층 방향 전체를 검사하는 게이트는 **없다**. eslint `no-restricted-paths`·madge·dependency-cruiser 도 없다.

---

## 3) hoist 규칙 — 언제 위로 올리나

> **두 번째 소비자가 생기는 순간 올린다. 세 번째를 기다리지 않는다.**
> 단, **일반화(제네릭화)는 세 번째에 한다.**

두 문장이 모순처럼 보이지만 다른 이야기다.

- **배치(placement)**: 소비자가 2개가 되면 그 모듈은 `packages/shared` 로 간다. 웹에 남겨두고 모바일이 복사하는 순간 §1 의 사고가 시작된다.
- **추상화(abstraction)**: 비슷한 것이 2개일 때는 각자 두고, **3번째가 나타나면** 공통 커널로 묶는다.
  이 저장소가 실제로 그렇게 했다 — `packages/shared/learning/registry/knowledge-registry.ts:5-11` 원문:
  > *"A near-twin of `LearningDomainRegistry` rather than a shared generic … Merge them when a third appears, not before."*

  그리고 세 번째(AI 허브)가 나타나자 `packages/shared/lib/kernel/registry.ts` 가 만들어졌다.
  **앞의 둘은 의도적으로 남겼다** — learning 레지스트리는 `LearningError` 를 던지고 자기 모듈 밖을 import 하지 않는다는 계약이 있어서, 커널로 갈아타면 그 계약이 깨진다. 이 예외는 `registry.ts:8-13` 에 사유가 적혀 있다.

**의도적 예외를 남길 때는 반드시 그 파일 헤더에 사유를 적는다.** 사유 없는 중복은 부채고, 사유 있는 중복은 설계다.

---

## 4) 규칙 R1~R5

### R1 — 패키지 경계는 서브패스 import 로만 넘는다

```ts
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'   // ✅
import { useDeckStore } from '../../../shared/stores/deck-store'      // ❌
import { useDeckStore } from '@reeeeecall/shared'                     // ❌ (배럴 없음)
```

- 실측: 상대경로로 패키지 경계를 넘는 곳 0건, bare `@reeeeecall/shared` import 0건.
- `packages/shared/package.json` 의 `main`/`types` 는 **존재하지 않는** `./index.ts` 를 가리킨다. 배럴 import 를 쓰는 순간 해석 실패한다.
- 경로 alias 는 소비자 쪽에 3중으로 선언된다: `packages/web/tsconfig.app.json:30` · `packages/mobile/tsconfig.json:13` · `packages/web/vite.config.ts:11`. 모바일 번들러는 alias 대신 `packages/mobile/metro.config.js` 의 워크스페이스 해석 설정(`watchFolders` · `nodeModulesPaths` · `sourceExts` TS 우선 · `unstable_enablePackageExports=false`)에 의존한다. **하나만 고치면 타입은 통과하고 번들이 깨진다.**
- **게이트**: CI `lint-typecheck` / `Web typecheck`(오타 난 서브패스만). 상대경로 월경을 막는 게이트는 없다.

### R2 — L2(`packages/shared/lib/**`)는 supabase 를 import 하지 않는다

허용 예외는 2개뿐: `packages/shared/lib/supabase.ts`, `packages/shared/lib/rate-limit-instance.ts`.

- **게이트**: CI job `arch-guard` → `tools/check-arch.ts`
- ⚠️ **이 게이트는 초록이어도 규칙이 지켜졌다는 뜻이 아니다.** `FORBIDDEN` 정규식이 `lib/supabase` 로 끝나는 문자열만 보기 때문에 **경로에 `lib/` 가 들어가지 않는 상대 import(`from './supabase'`, `from '../supabase'`)를 통과시킨다.** 현재 `packages/shared/lib/stats.ts:1`(`./supabase`), `packages/shared/lib/storage.ts:1`(`./supabase`), `packages/shared/lib/ai/server-client.ts:6`(`../supabase`) 이 그 구멍으로 통과 중이다. → §7 부채 D1.

### R3 — 학습(study) 엔진은 `packages/shared` 에만 존재한다

`srs.ts` · `study-queue.ts` · `cramming-queue.ts` · `study-session-utils.ts` · `srs-access.ts` · `study-store.ts`
이 6개는 `packages/web/src` 에 **재-export shim 으로도** 되살릴 수 없다.

- **게이트**: `tools/check-arch.ts` Rule 2 (파일 존재만으로 exit 1)
- shim 조차 금지인 이유: shim 이 supabase mock 경로를 갈라 #342 이전에 68개 테스트를 깼다(`tools/check-arch.ts:78-79`).

### R4 — 런타임 경계로 복제할 때는 parity 테스트를 짝으로 만든다

`supabase/functions/` 는 배포 단위가 달라 `packages/` 를 import 할 수 없다. 그래서 **의도적으로 복제**한다.
복제본을 만들면 **같은 PR 에서** parity 테스트를 만든다.

| 원본 | 복제본 | parity 게이트 |
|---|---|---|
| `packages/shared/lib/card-answer.ts` | `supabase/functions/_shared/card-answer.ts` | `packages/web/src/lib/__tests__/server-card-answer-parity.test.ts` |
| `packages/shared/lib/quiz-answer-field.ts` | `supabase/functions/_shared/quiz-answer-field.ts` | `packages/web/src/lib/__tests__/quiz-answer-field-parity.test.ts` |
| `packages/shared/lib/ai/prompts.ts` | `supabase/functions/_shared/ai-prompts.ts` | `packages/web/src/lib/ai/__tests__/server-prompts-parity.test.ts` |

복제할 만큼 크지 않으면 **엣지 파일을 유일 소스로 두고 웹 테스트가 상대경로로 직접 import** 한다
(`ai-quiz.ts`, `ai-quiz-prompts.ts`, `ai-remediation.ts` 가 이 방식).
**둘 중 하나를 고르고, 파일 헤더에 어느 쪽인지 적는다.** 아무 표시 없는 복제본이 최악이다.

### R5 — 확장점을 만들면 **우회를 막는 가드 테스트**를 같이 만든다 ★

이 저장소를 다른 저장소와 구별짓는 규칙이다. 레지스트리를 만들어 놓는 것만으로는 아무 일도 일어나지 않는다:

> `LearningDomainRegistry` 는 pluggable 하게 만들어 놓고 **아무도 import 하지 않았다**. 소비자 셋이 각자 목록을 하드코딩했다 — 웹 `GoalFormModal.tsx` · 모바일 `LearningGoalsScreen.tsx` 의 `const DOMAINS = ['language','labor-law']`, 그리고 `supabase/functions/_shared/ai-remediation.ts` 의 `domainId === 'labor-law'`.
> — `packages/shared/learning/adapters/domain-catalog.ts:3-12`

> 같은 일이 **세 라운드** 반복됐다 — #400 레지스트리에 importer 0, #402 `LearningDomainAdapter` 멤버 4개에 reader 0, 그리고 `ports/`·`domain/validators.ts` 등 0 리더. 그동안 **렌더링은 완벽했다.** 행위 테스트로는 절대 안 잡히고 컴파일러도 못 본다.
> — `packages/web/src/lib/__tests__/learning-kernel-no-dead-exports.test.ts:8-17`

그래서 **컴파일러도 행위 테스트도 못 보는 것을 잡는 가드**를 쓴다. 세 종류가 이미 있고, 새 확장점은 이 중 맞는 것을 복제한다:

| 가드 종류 | 무엇을 막나 | 표본 |
|---|---|---|
| not-hardcoded | 화면이 레지스트리를 우회해 목록을 직접 타이핑 | `packages/web/src/lib/__tests__/ai-hub-not-hardcoded.test.ts` |
| no-dead-exports | 읽는 사람 없는 export/필드가 커널에 남음 | `packages/web/src/lib/__tests__/ai-hub-kernel-no-dead-exports.test.ts` |
| parity | 두 런타임의 사본이 갈라짐 (소스 스캔이 아니라 두 사본을 import 해 동작 비교) | `packages/web/src/lib/__tests__/quiz-answer-field-parity.test.ts` |

**소스 스캔 가드를 새로 쓸 때의 필수 주의**: 스캔에서 `.js` 를 제외해야 한다.
gitignore 된 컴파일 트윈(현재 `packages/shared` 에 `.js` 9개 실재, `.d.ts` 까지 세면 19개 — 로컬 빌드 산출물이라 머신마다 다르다)이 **삭제된 reader 의 심볼을 살려둬서** 로컬만 통과하는 테스트가 된다(`ai-hub-kernel-no-dead-exports.test.ts:28-31`).

---

## 5) "읽는 사람 없는 것은 없는 것과 같다"

선언만 하고 읽지 않는 필드/포트/레지스트리는 **거짓말하는 capability 와 구분되지 않는다.** 실제 피해:

- `LearningDomainAdapter` 멤버 4개에 reader 가 없었고, 그중 `requireSourceGrounding` 이 자기 도메인의 remediation 을 **만족 불가능하게 만들어 매 요청 400** 을 냈다 (커밋 `dad30072`).
- 도메인을 등록해도 앱 동작이 안 바뀌었다 — `buildDailyPlan` 이 activityMix 없이 호출돼 전부 DEFAULT_MIX 를 받았다. 확장점의 값이 **호출부까지 전달되지 않으면** 도메인은 행에 붙은 라벨일 뿐이다.

**규칙**: 서술자(descriptor)는 **렌더/라우팅/분기에 실제로 읽는 필드만** 갖는다.
"나중에 쓸 것 같아서" 넣은 필드는 넣지 않는다. → `packages/shared/lib/ai/hub/types.ts:1-11`

**현재 이 규칙이 검사되는 범위**: `packages/shared/lib/kernel`, `packages/shared/lib/ai/hub`, `packages/shared/learning` 3곳뿐.
`packages/shared/adapters`(포트 7개 중 5개 소비자 0), `packages/web/src/lib/payments` 는 대상 밖이고 실제로 죽은 export 가 남아 있다. → §7 부채 D2.

---

## 6) 값은 코드가 아니라 데이터로

**배포 없이 바뀌어야 하는 값은 테이블 행으로 옮긴다.** 이 저장소의 최신 표본:

| 값 | 어디에 사는가 | 바꾸는 비용 |
|---|---|---|
| 무료 티어 배분 | `ai_free_allowances(tier, action_group)` (mig 239) | `UPDATE` 1행, 배포 0 |
| 액션 정가 | `ai_action_prices` (mig 216) | `UPDATE` 1행, 배포 0 |
| 퀴즈 유닛 가격 | `ai_quiz_price_units` (mig 194) | `INSERT/UPDATE` 1행 |
| 난이도 밴드·지시문 | `quiz_difficulty_levels.guidance` (mig 197/202) | `INSERT` 1행 |
| 모델·제공자 | `PROVIDERS` + Deno env (`supabase/functions/_shared/ai-providers.ts`) | 모델 교체는 env 1개, 배포 0 |
| 킬스위치·운영 플래그 | `system_flags` (mig 153) | 1행 |

**설계 시 확인 사항 3가지**:
1. **폴백 방향이 안전한가.** `_ai_free_allowance` 는 행이 없으면 0(=유료)을 돌려준다 — 깜빡해도 돈을 잃지 않는다. 반대로 `_ai_resolve_rate` 는 행이 없으면 비싼 폴백 단가로 떨어져 **43배 과금**이 났다.
2. **enum 이 아니라 text 인가.** `ai_free_allowances.action_group` 이 text 인 것은 의도다 — 새 AI 행동을 추가할 때 타입 변경이 필요 없다.
3. **테이블을 만들었으면 SQL 어서션 스위트도 만들고 `ci.yml` 에 등록했는가.** → `07_TESTING/GATES.md`

여전히 코드에 박혀 있는 값(부채): 하루 요청 상한 `300` 이 4개 plpgsql 함수(`reserve_ai_generation`·`reserve_ai_image`·`reserve_ai_remediation`·`reserve_ai_quiz`)에 리터럴로,
TTS 상한(400,000자/2,000요청)이 `101_tts_usage_quota.sql` 상수로. → §7 부채 D3.

---

## 7) 지금 어긋나 있는 것 (부채 목록 — 늘어나면 안 되고 줄어들기만 한다)

| id | 부채 | 규모(2026-08-16 실측) | 해소 방향 |
|---|---|---|---|
| D1 | `check-arch` 정규식이 상대 import 를 못 잡음 | 3파일 통과 중 | `FORBIDDEN` 에 `/from\s+['"]\.{1,2}\/supabase['"]/` 추가 (`ai/server-client.ts` 는 `'../supabase'` 라 `\.\/` 만으로는 안 잡힌다) |
| D2 | dead-export 가드 스캔 범위가 커널 3곳뿐 | `adapters` 7포트 중 5개 소비자 0 | `KERNEL_DIRS` 를 공유 상수로 뽑고 `adapters` 추가 |
| D3 | 하루 요청 상한 300 이 4곳 리터럴 | 4개 함수 | `ai_pricing_settings` 컬럼으로 이동 |
| D4 | `packages/web/src/lib` 과 `packages/shared/lib` 에 동명 파일 53개 | shim 3 · 바이트 동일 36 · **이미 갈라진 14** | 갈라진 14개부터 shared 로 단일화하고 `SINGLE_SOURCE_ONLY` 에 등록 |
| D5 | web 스토어 3개(content/marketplace/subscription)가 shared 와 별개 구현 | 웹은 로컬, 모바일은 shared 를 읽음 | shared 로 단일화 |
| D6 | 웹에 supabase 클라이언트가 2개(로컬 `createClient` + shared 싱글턴) | 웹 46파일이 로컬, shared 스토어 18개가 싱글턴 | `packages/web/src/lib/supabase.ts` 를 shim 으로 |
| D7 | 지원 로케일 8개 목록이 최소 18곳에 따로 적힘 | 최소 18곳 | `packages/shared/lib/locale-utils.ts` 단일화 → `10_I18N` |
| D8 | shared 내부 역방향 import 1건 | `lib/learning-attempt-selection.ts:10` → stores | 함수 인자로 주입 |

**UI 계층의 부채는 [`../14_UI/README.md` U1~U7](../14_UI/README.md#이-문서의-부채) 에 따로 있다** — 디자인 토큰 미동기화·CSS 변수 2벌·접근성 게이트 전무 등. 성격이 달라(값 불일치·게이트 부재) 표를 나눴을 뿐, **같은 규칙을 따른다: 줄어들기만 한다.**

**부채를 새로 만드는 것 자체가 금지는 아니다.** 다만 이 표(또는 14_UI 의 U 표)에 줄을 추가하고 사유를 적어야 한다.
표에 없는 중복이 발견되면 그건 부채가 아니라 결함이다.

---

## 8) 확장 메커니즘 5종 — "쪼갠다"를 어떤 형태로 하나

### 선택 기준표

| 상황 | 메커니즘 | 이 저장소의 실물 |
|---|---|---|
| 여러 모듈이 **같은 기반 능력**을 필요로 한다 | **8-1 커널** | `lib/kernel/registry.ts`, `lib/cache/stale-cache.ts`, `is_admin()`, `_check_deck_access()` |
| **항목이 계속 늘어난다** (메뉴·도메인·제공자·가격) | **8-2 플러그인 레지스트리** | `ai/hub/catalog.ts`, `PROVIDERS`, `ai_free_allowances` |
| **플랫폼/외부 구현이 갈린다** (스토리지·결제·TTS) | **8-3 포트&어댑터+DI** | `packages/shared/adapters`, `packages/web/src/lib/payments` |
| 발생 사실을 **모르는 구독자에게** 알린다 | **8-4 이벤트 버스** | `ai/hub/events.ts` (`aiHubBus`) |
| **순서 있는 단계**를 거쳐 하나의 산출물을 만든다 | **8-5 파이프 앤 필터** | `worker-modules/content-pipeline.js` |

---

### 8-1 커널 (kernel)

- **언제**: 같은 기반 능력이 3번째로 필요해졌을 때. 2번째까지는 각자 둔다(§3).
- **코드 SSOT**: `packages/shared/lib/kernel/{registry,event-bus}.ts` · `packages/shared/lib/cache/stale-cache.ts` · `packages/shared/lib/fetch-all-rows.ts` · DB 쪽 `is_admin()`(소비자 78 = 함수 75 + RLS 정책 3) · `_check_deck_access()`(5) · `_quiz_eligible_cards()`(3) · `_ai_free_allowance()`
- **확장 비용**: 새 소비자 = import 1줄. 커널 자체는 무수정.
- **게이트**: `ai-hub-kernel-no-dead-exports.test.ts` · `learning-kernel-no-dead-exports.test.ts`
- **안티패턴**
  - 커널을 만들고 소비자가 1개인 채 방치 (현재 `EventBus` 가 그 상태 — 소비자 1)
  - 커널 반환 계약을 표시 순서로 착각: `Registry.ids()` 는 **알파벳 정렬**이다. 메뉴 순서는 서술자의 `order` 필드가 갖는다.
  - DB 커널을 고칠 때 소비자 수를 안 세는 것: `is_admin()` 한 줄이 76개 함수와 14개 RLS 정책에 영향을 준다.

### 8-2 플러그인 레지스트리 (plugin registry)

- **언제**: 항목이 늘어나는 것이 **정상 운영**인 축. "새 항목 추가 = 파일 1개 + 등록 1줄" 이 목표.
- **코드 SSOT (TS)**: `packages/shared/lib/ai/hub/catalog.ts`(소비자 11 — 웹 5 · 모바일 6, 테스트 3개 별도) · `learning/adapters/{domain,knowledge}-catalog.ts` · `supabase/functions/_shared/ai-providers.ts` · `worker-modules/locale-policy.js`(소비자 8) · `worker-modules/topic-registry.js` · `packages/web/src/components/content/blocks/index.ts` · `packages/mobile/src/services/prefetch.ts`
- **코드 SSOT (데이터 테이블)**: `ai_free_allowances` · `ai_action_prices` · `ai_quiz_price_units` · `quiz_difficulty_levels` · `system_flags`
- **표준 형태 (TS)**: `createDefault…()` 팩토리 → 모듈 레벨 싱글턴 → 싱글턴을 읽는 자유 함수 3종 세트.
  미상의 id 는 `find()` 가 **null** 을 돌려준다(`get()` 은 throw — 이 빌드가 안 싣는 id 는 버그라는 뜻). `register()` 는 chainable(`return this`), 빈 id·중복 id 는 throw.
- **확장 비용 실측**: AI 허브 항목 1개 = 코드 5파일 + 로케일 16파일. 학습 도메인 1개 = 2파일. AI 제공자 1개 = 2파일 + 가격 마이그레이션 1개.
- **게이트**: `*-not-hardcoded.test.ts`(우회 금지) + `*-catalog.test.ts`(`availableXxx()` 와 `createDefaultXxx().ids()` 일치 pin)
- **안티패턴**
  - 레지스트리를 만들고 화면은 배열을 그대로 들고 있기 → R5 가드로 막는다.
  - 등록부와 핸들러 맵을 **다른 파일로 쪼개기**: `worker-modules/seo/page-registry.js`(패턴)와 `worker.js`(핸들러)가 서로를 검증하지 않아 한쪽만 추가하면 조용히 404 로 떨어진다.
  - 값 타입을 `Record<string, ComponentType<{ props: any }>>` 로 두기: `BLOCK_REGISTRY` 는 오타난 키를 컴파일러도 테스트도 못 잡고 조용히 null 을 렌더한다.

### 8-3 포트&어댑터 + DI

- **언제**: 같은 능력의 구현이 **플랫폼/외부 사업자별로** 갈릴 때.
- **코드 SSOT**: `packages/shared/adapters/index.ts`(포트 7 + `initAdapters()`), 각 앱의 composition root(`packages/web/src/adapters/index.ts`, `packages/mobile/src/adapters/index.ts`), `packages/web/src/lib/payments/`, `packages/official-decks/src/application/ports/`
- **표준 형태**: shared 는 인터페이스만. 각 앱 부팅 시 `initAdapters()` 1회. shared 코드는 `getStorage()` 같은 getter 로만 접근하고 구현을 절대 `new` 하지 않는다.
- **확장 비용**: 포트 1개 추가 = **6파일**. 싸지 않다 — 구현이 실제로 2개 이상일 때만 만든다.
- **게이트**: **없음.** 미초기화는 런타임 throw 로만 드러난다.
- **안티패턴 (현재 실재)**
  - 포트를 만들고 화면이 구현을 직접 `new` 하기: `packages/mobile/src/screens/StudySessionScreen.tsx:30` 의 `new RNTTS()` 가 `getTTS()` 를 우회한다.
  - 포트가 있는데 플랫폼 API 를 직접 부르기: `IPlatformAdapter.getOrigin()` 이 있는데 `packages/shared/stores/auth-store.ts:153,167,178` 이 `window.location.origin` 을 직접 읽는다 — **RN 에는 `window.location` 이 없어서** 모바일이 이 경로를 부르면 즉시 크래시한다.
  - 어댑터를 등록해 놓고 선택을 하드코딩: `payments/index.ts:91-93` 의 `preferredProviderId()` 가 항상 `'lemonsqueezy'` 를 반환해 나머지 3개 어댑터는 선택될 수 없다.

### 8-4 이벤트 버스 (event bus)

- **언제**: 발행자가 **구독자를 몰라야** 할 때(주로 텔레메트리·퍼널).
- **코드 SSOT**: `packages/shared/lib/kernel/event-bus.ts` ← `packages/shared/lib/ai/hub/events.ts`(`aiHubBus`, 발행 16곳/14파일 + 구독 2파일)
- **경계**: **버스는 의도(intent)만 나르고 돈은 절대 나르지 않는다.** 과금은 예약→과금 RPC 경로로만 움직인다(`05_AI_AND_MONEY`).
- **확장 비용**: 새 구독자 = 1파일. 새 이벤트 타입 = `events.ts` 1파일(union + `aiHubAnalyticsEvent` switch — exhaustive 라 타입체커가 누락을 잡는다).
- **게이트**: `packages/web/src/lib/__tests__/ai-hub-kernel.test.ts` — 단 **커널(`EventBus`) 자체의 동작만** 검사한다(구독/해제/emit 중 해제/리스너 예외 격리). **브리지가 플랫폼당 한 번만 마운트되는지, 발행 지점이 빠지지 않았는지를 잡는 게이트는 없다** — 아래 안티패턴 두 개가 모두 무방비라는 뜻이다.
- **안티패턴**
  - **브리지 이중 마운트** → 퍼널 2배 집계. 플랫폼당 정확히 한 번(웹 `Layout.tsx`, 모바일 `MainDrawer.tsx`).
  - `onError` 를 안 넘기기: `emit` 은 리스너 예외를 삼킨다(기본값 no-op). 현재 `aiHubBus` 가 그 상태라 브리지 오류가 전혀 보고되지 않는다.
  - 버스를 상태 동기화에 쓰기 — 순서 보장이 없다. 상태는 스토어가, 사실 통지는 버스가.

### 8-5 파이프 앤 필터 (pipe & filter)

- **언제**: 순서 있는 단계가 하나의 산출물을 만들고, 단계별로 교체·삽입이 필요할 때.
- **코드 SSOT**: `worker-modules/content-pipeline.js`(`runContentPipeline` 본문의 번호 붙은 5단계 + IndexNow 제출) · `scripts/apply-prod-migrations.sh`(적용→기록 파이프) · AI 생성의 예약→호출→검증→과금/해제
- **확장 비용**: 스테이지 1개 추가 = **2파일** — `worker-modules/<x>.js` 신규 + `content-pipeline.js` 의 import·호출 지점. 단계 목록이 데이터가 아니므로 **순서 변경·중간 삽입은 오케스트레이터 본문 수정**이다.
- **게이트**: **없음.** `worker-modules/__tests__/` 17개 스위트 중 `content-pipeline.js` 를 import 하는 것이 하나도 없다(개별 스테이지 모듈만 테스트한다). 단계 누락·순서 뒤바뀜을 잡는 것은 아무것도 없다.
- **안티패턴**: 단계 목록이 **데이터가 아니라 함수 본문의 명령형 코드**면 순서 변경·삽입이 오케스트레이터 수정이 된다. 현재 `content-pipeline.js` 가 그렇다 — 스테이지가 늘면 배열로 뽑는다.

---

## 9) 새 코드를 쓰기 전 체크리스트

1. **어느 계층인가?** (§2) — 답이 "웹에도 모바일에도 필요"면 `packages/shared`.
2. **두 번째 소비자가 이미 있나?** (§3) — 있으면 지금 올린다. 나중은 없다.
3. **어떤 메커니즘인가?** (§8 선택 기준표) — 억지로 고르지 않는다. 소비자가 1개면 그냥 함수다.
4. **확장점을 만들었다면 우회 가드를 같이 만들었나?** (R5)
5. **런타임 경계로 복제했다면 parity 테스트를 만들었나?** (R4)
6. **배포 없이 바뀌어야 하는 값을 코드에 박지 않았나?** (§6)
7. **읽는 사람 없는 export/필드를 남기지 않았나?** (§5)
8. **부채를 남겼다면 §7 표에 줄을 추가했나?**

---

## 관련 문서

- 계층 경계와 게이트 요약 → [`README.md`](README.md)
- 확장점 실물 인벤토리(등록 절차·비용) → [`extension_points.md`](extension_points.md)
- 게이트가 실제로 무엇을 막는지 → [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md)
