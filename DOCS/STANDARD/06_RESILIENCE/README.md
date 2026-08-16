# 06. 복원력 — 실패를 다루는 규칙

> 이 저장소의 실패는 대부분 **시끄럽게 죽지 않았다.** 빈 차트, 0으로 고정된 카드 수,
> 영원히 묶인 홀드, 조용히 잘린 1000행. 그래서 규칙의 절반은 **"실패를 보이게 만드는 것"** 이다.

## 목차
- [1. 첫 번째 규칙 — 실패를 삼키지 않는다](#1-첫-번째-규칙--실패를-삼키지-않는다)
- [2. 운영 게이트 — opsGate](#2-운영-게이트--opsgate)
- [3. fail-open 과 fail-closed 를 고르는 기준](#3-fail-open-과-fail-closed-를-고르는-기준)
- [4. 재시도 규칙](#4-재시도-규칙)
- [5. 멱등성](#5-멱등성)
- [6. 동시성](#6-동시성)
- [7. 절단(truncation) — 조용한 데이터 손실](#7-절단truncation--조용한-데이터-손실)
- [8. CI/인프라 흔들림](#8-ci인프라-흔들림)

---

## 1. 첫 번째 규칙 — 실패를 삼키지 않는다

```ts
const { data } = await supabase.rpc('get_x')      // ❌ error 를 버린다
const { data, error } = await supabase.rpc('get_x')
if (error) { /* 표면화 */ }                        // ✅
```

**왜 이게 첫 줄인가**: 이 저장소에는 **에러 리포팅(Sentry 등)이 없다.** 삼킨 에러는 영원히 보이지 않는다.

실제 사고:
- 대시보드 차트가 출시 이후 내내 비어 있었다. 원인은 **2단**이었다 — RPC 가 `authenticated` 에 GRANT 되지 않았고(권한 거부), 그 밑에 statement timeout 이 있었다. 페이지가 `{ data }` 만 구조분해해 둘 다 빈 배열로 만들었고, **빈 차트와 고장난 차트가 똑같이 생겼다**(recharts 는 빈 시리즈에도 축과 격자를 그린다).
- `admin_set_session_override` 가 `is_admin()` 을 통과하고 `{"success": true}` 를 답하면서 **아무것도 바꾸지 않았다** — inert 가 아니라 misleading.

**규칙**
- 실패와 "데이터 없음"은 화면에서 **구분되어야 한다**. 빈 상태 UI 와 에러 상태 UI 를 따로 만든다.
- 스토어는 실패를 `error` 필드로 표면화한다(값은 i18n 키).
- 이벤트 버스 리스너 예외는 `emit` 이 삼킨다(기본 `onError` 가 no-op). 텔레메트리가 본류를 깨지 않게 하려는 의도지만, **`onError` 를 넘기지 않으면 브리지 오류가 전혀 보고되지 않는다.**
- "성공했다"고 답하기 전에 **실제로 무엇이 바뀌었는지** 확인한다(영향 행 수 등).

## 2. 운영 게이트 — `opsGate`

돈/AI 경로 엣지 함수는 `supabase/functions/_shared/ops-gate.ts` 로 시작한다.

```
유지보수 모드 → AI 킬스위치 → 결제 정지 → 밴 → 버스트 레이트리밋
```

- 플래그는 `system_flags` 테이블(mig 153) — **배포 없이** 끌 수 있다.
- 플래그 읽기 실패는 **fail-open**(플래그 조회가 죽었다고 서비스를 멈추지 않는다).
- 현재 소비자 3개: `ai-generate`(20/60s) · `tts`(120/60s) · `lemonsqueezy-checkout`.
- **새 돈/AI 함수는 여기를 통과시킨다.** 통과하지 않는 결제 함수(`admin-refund`, `toss-*`, `subscription-portal`, 웹훅들)는 각자의 이유가 헤더에 있어야 한다.

## 3. fail-open 과 fail-closed 를 고르는 기준

| 상황 | 정책 | 근거 |
|---|---|---|
| 운영 플래그 조회 실패 | **fail-open** | 관측 장치가 서비스를 멈추면 안 된다 |
| 클라이언트 한도 프리플라이트 | **fail-open** | 값을 모르면 막지 않는다. 진짜 한도는 서버가 건다 |
| 결제/크레딧 부여 웹훅의 시크릿 미설정 | **fail-closed (503)** | 설정되지 않은 채로 절대 돈을 만들지 않는다 |
| 환불 시 제공자 시크릿 미설정 | **fail-closed (503)** | 돈이 움직이지 않았는데 "환불됨"이라고 말하지 않는다 |
| 무료 배분 테이블에 행 없음 | **0 = 유료** | 깜빡해도 손해 보지 않는 방향 |
| 모델 요율 행 없음 | ⚠️ 현재는 비싼 폴백으로 **과금** | 사고의 원인. `unpriced_model_test.sql` 로 방어 |

**규칙**: 엣지 함수 헤더에 **fail-open 인지 fail-closed 인지 명시**한다. 현재 명시하는 것은 웹훅 3종(`payment-webhook`·`lemonsqueezy-webhook`·`revenuecat-webhook`)과 `admin-refund` 뿐이고, `toss-*` 4개와 `lemonsqueezy-checkout`·`subscription-portal` 은 아직 안 하고 있다(부채).

## 4. 재시도 규칙

| 대상 | 재시도 | 이유 |
|---|---|---|
| 모델 호출 타임아웃 | **하지 않는다** | 이미 예산 전체(추론 90초)를 쓴 호출을 두 번 더 하면 학습자를 3배 기다리게 하고 edge invocation wall clock 을 태운다 |
| 모델 네트워크 에러 | 한다 | abort 와 구분한다 |
| 모델 429 (분당) | 백오프 후 재시도 | |
| 모델 429 (**하루 쿼터**) | 재시도 금지 → 즉시 폴백 체인 | 본문에서 `PerDay` 를 정규식으로 골라낸다. 'retry in 58s' 힌트를 기다리면 1분 낭비 후 실패 |
| JSON 파싱 실패 | **1회만**, 더 엄격한 시스템 프롬프트로 | 두 호출 토큰을 합산해 과금 |
| 폴백 자리(i>0)의 실패 | 종류 불문 **다음 후보로** | rethrow 하면 전 AI 기능이 죽는다 |
| `supabase start` / `db reset` (CI) | **인프라 시그니처 3종에만** 최대 3회 | 통째 재시도는 깨진 마이그레이션을 "3번째에 통과"로 만든다. 재시도했으면 `::warning::` 을 남긴다 |
| 웹훅 처리 실패 | 500 을 돌려 **제공자가 재시도**하게 | 단, 모든 RPC 가 멱등이어야 성립한다(§5) |

## 5. 멱등성

- **결제/크레딧 RPC 는 전부 멱등이다** — `confirm_payment`/`add_ai_credits` 는 `merchant_uid`, 환불 부여는 `ref='refund:<uid>'`, 인보이스는 invoice id 로 잠근다. 그래서 웹훅 재전송과 `admin-refund` 의 이중 적용이 안전하다.
- **학습 영속화는 클라이언트가 만든 UUID(`newPersistenceId()`)로 멱등**하다. `undo_study_rating` 은 세션의 최신 이벤트만 받는다.
- **새 웹훅/부여 경로를 만들면 멱등 키를 먼저 정한다.** 키 없이 "재시도하면 됩니다"는 성립하지 않는다.

## 6. 동시성

- 카운터·한도·지갑 경로는 `pg_advisory_xact_lock(<고정키>, hashtext(user))` + `FOR UPDATE` 로 직렬화한다(실측 25회/16파일).
- 클라이언트는 RPC 를 건너뛰고 PostgREST 로 직접 INSERT 할 수 있다 → RPC 안에만 있는 규칙은 **statement-level 트리거**로 백스톱을 놓는다(mig 136 표본).
- 순서가 있는 영속화는 클라이언트에서 Promise 체인으로 직렬화한다(`study-store` 의 `persistenceChain`).

## 7. 절단(truncation) — 조용한 데이터 손실

- PostgREST `max_rows = 1000`. **1000행을 넘을 수 있는 조회는 `fetchAllRows()`** 로 페이지네이션한다.
  과거 사고: "카드 1001번부터 학습 불가". 현재 `card-store.fetchCards` 만 미적용(부채).
- `fetchAllRows` 는 **부분 결과를 반환하지 않고 throw** 한다 — 절반의 데이터가 정상처럼 보이는 것보다 낫다.
- `expo-secure-store` 는 값당 2048바이트 초과를 거부한다. Supabase 세션은 빈 계정에서도 1963바이트(한계의 96%)라 **이메일이 길거나 identity 가 하나 더 붙으면 세션 영속화가 조용히 실패**하고 다음 실행에서 로그아웃된다 → 500자 청킹 + 매니페스트를 **나중에** 쓰는 순서(`rn-storage.ts`).

## 8. CI/인프라 흔들림

- `.github/scripts/supabase-up.sh` 는 **인프라 시그니처에만** 재시도한다(5xx / upstream / http deadline). 그 외 실패는 즉시 원래 exit code — 깨진 마이그레이션이 "3번째에 통과"하는 일을 막기 위해서다.
- 간헐 red 를 발견하면 **원인을 찾아 고친다.** 현재 알려진 원인 1건: `download-file.test.ts` 의 실타이머(→ [`../07_TESTING §6`](../07_TESTING/README.md#6-테스트-하네스-함정)).
- CI 는 `ai-credit-tests` 에 재시도가 없다. 그러므로 flaky 테스트는 **무관한 PR 을 막는 비용**으로 직결된다.

## 관련 문서
[`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) · [`../05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md) · [`../11_SECURITY`](../11_SECURITY/README.md)
