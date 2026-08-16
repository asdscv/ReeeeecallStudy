# 03. 서버 계약 — 엣지 함수 · RPC · 에러 어휘

> 이 저장소에 REST API 는 없다. 서버 표면은 **① Supabase RPC(PostgREST)** 와 **② Deno 엣지 함수** 둘뿐이고,
> 둘의 계약 규칙이 다르다.

## 목차
- [1. 무엇을 RPC 로, 무엇을 엣지 함수로](#1-무엇을-rpc-로-무엇을-엣지-함수로)
- [2. 엣지 함수 표준 형태](#2-엣지-함수-표준-형태)
- [3. 에러 어휘 — SQLSTATE ↔ code ↔ HTTP](#3-에러-어휘--sqlstate--code--http)
- [4. RPC 계약 규칙](#4-rpc-계약-규칙)
- [5. 엣지 함수를 새로 만들 때 체크리스트](#5-엣지-함수를-새로-만들-때-체크리스트)
- [6. 함정](#6-함정)

---

## 1. 무엇을 RPC 로, 무엇을 엣지 함수로

| 조건 | 표면 |
|---|---|
| DB 안에서 끝난다 (읽기·쓰기·계산·정책) | **RPC** (`SECURITY DEFINER`) |
| 외부 사업자 비밀키가 필요하다 (AI 제공자, 결제사, TTS) | **엣지 함수** |
| 외부에서 우리를 부른다 (웹훅, 크론) | **엣지 함수** (`verify_jwt = false` + 자체 서명/비밀 검증) |
| 응답이 스트림/바이너리다 | **엣지 함수** |

> **원칙**: 비밀키를 쥐어야 하는 이유가 없으면 엣지 함수를 만들지 않는다.
> 엣지 함수는 CI 에서 타입체크·테스트·배포 **어느 것도 되지 않는 유일한 코드**다(§6).

## 2. 엣지 함수 표준 형태

```ts
// 1. 파일 헤더 — 무엇을 하는 함수인지, 누가 부르는지, 어떤 시크릿이 필요한지,
//    verify_jwt 설정이 무엇인지, 실패 시 fail-open 인지 fail-closed 인지를 산문으로 적는다.
//    (이 저장소의 결제 함수 헤더가 표본이다: lemonsqueezy-webhook/index.ts:1-99)

Deno.serve(async (req) => {
  // 2. CORS — ALLOWED_ORIGINS 허용목록. 절대 '*' 금지.
  //    허용되지 않은 Origin 에는 ACAO 헤더를 아예 붙이지 않는다.
  const cors = corsHeadersFor(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  // 3. 인증 — 사용자 함수면 JWT, 웹훅이면 서명/공유비밀(상수시간 비교)
  const userId = await verifyUser(req.headers.get('Authorization'))
  if (!userId) return json({ error: 'Unauthorized' }, 401, cors)

  // 4. opsGate — 돈/AI 경로면 필수. userId 가 필수 인자이므로 반드시 인증 뒤에 온다.
  //    유지보수 플래그 → AI 킬스위치 → 결제정지 → 밴 → 레이트리밋
  const gate = await opsGate(sbServiceRole(), { userId, requireAI: true, rateKey: `aigen:${userId}`, rateLimit: 20, rateWindowSec: 60 })
  // 통과하면 null, 막히면 { status, code, message }
  if (gate) return json({ error: gate.message, code: gate.code }, gate.status, cors)

  // 5. 예약(reserve) → 6. 외부 호출 → 7. 검증 → 8. 과금(charge)/해제(release)
  // 9. 응답: 성공은 함수별 페이로드를 그대로 반환한다({ content, ... } · { url } · { ok, grant }).
  //    실패만 { error, code } 로 고정 + 적절한 HTTP status
})
```

| 규칙 | 게이트 |
|---|---|
| CORS 는 `ALLOWED_ORIGINS` 허용목록. `*` 금지 | 없음 (브라우저가 부르는 7개 함수가 모두 준수) |
| 돈/AI 경로는 `opsGate()` 로 시작 | 없음 (현재 소비자 3: `ai-generate`·`tts`·`lemonsqueezy-checkout`) |
| 시크릿은 `Deno.env` 로만. service_role 키는 엣지 안에서만 존재 | 없음 |
| 웹훅은 `verify_jwt = false` + **자체 서명 검증**. 시크릿 미설정이면 **503(절대 통과시키지 않는다)** | 없음 (4개 중 3개 준수. `toss-webhook` 만 예외 — Toss 의 legacy `PAYMENT_STATUS_CHANGED` 는 서명이 없어서, 본문을 믿지 않고 `GET /v1/payments/{paymentKey}` 재조회로 권위 상태를 확인하고 미설정 시 200 ack 한다) |
| 프롬프트·정책 문자열은 서버에서 만든다. 클라이언트는 구조화된 파라미터만 보낸다 | 타입(`ServerGenerateRequest`)만 |
| 응답 실패 형태는 `{ error, code }` 고정 | 없음 (엣지 응답 모양을 검사하는 테스트는 없다. `ai-refusal.test.ts` 는 클라이언트가 code 를 어떻게 분류·번역하는지만 고정한다) |
| 각 함수 디렉터리에 `deno.json` 임포트 맵을 두고 bare specifier 로 import | 없음 (12/13 준수, `ai-model-watch` 만 `jsr:` 직접) |

**`verify_jwt = false` 인 함수는 `supabase/config.toml` 에 명시된 5개뿐**:
`payment-webhook` · `lemonsqueezy-webhook` · `revenuecat-webhook` · `toss-renew` · `toss-webhook`.
이 목록에 함수를 추가하는 것은 **인증을 끄는 결정**이다 — 반드시 자체 검증을 같은 PR 에서 넣는다([`../11_SECURITY`](../11_SECURITY/README.md)).

## 3. 에러 어휘 — SQLSTATE ↔ code ↔ HTTP

**닫힌 어휘다. 새 값을 만들기 전에 이 표에 맞는 것이 없는지 본다.**

| SQLSTATE | code | HTTP | 뜻 |
|---|---|---|---|
| `42501` | `FORBIDDEN` | 403 | 인증/인가 실패 (`Authentication required` 포함) |
| `P0002` | `AI_INSUFFICIENT_CREDITS` | 402 | 잔액 부족 |
| `23514` | `AI_RATE_CAP` | 429 | 일일/구간 상한 |
| `P0008` | `AI_PRICE_CHANGED` | 409 | 견적과 실제 가격 불일치 |
| `55006` | `AI_REMEDIATION_IN_FLIGHT` | 409 | 같은 작업 진행 중 |
| `P0009` | `AI_REQUEST_TOO_LARGE` | 400 | 요청이 서버 상한 초과 |
| `P0010` | `QUIZ_NOT_ENOUGH_CARDS` | 422 | 출제 가능 카드 부족 |
| `P0013` | `QUIZ_DIFFICULTY_UNAVAILABLE` | — (엣지 경유 없음) | 난이도 밴드에 유형별 guidance 없음. `create_quiz_set` 이 던지고 PostgREST 로 바로 나가며, 코드 부여는 클라이언트 `quiz-store.ts:546` 에서 한다 |
| `22023` | — | 400 | 인자 검증 실패 |

**규칙**
- DB 는 `RAISE EXCEPTION '<영문 메시지>' USING errcode = '<코드>'` 로 던진다. **errcode 를 빼면 P0001 로 떨어지고**, 테스트가 `EXCEPTION WHEN OTHERS` 로 감싸면 가드가 사라져도 통과한다(실측: 1090건 중 202건이 errcode 없음).
- 엣지는 SQLSTATE → code 매핑을 한 곳에 모은다. 현재 quiz 경로만 `quizReserveResponse()` 로 모여 있고 cards/image/remediation 은 분기마다 반복한다 — 새 kind 는 공용 매퍼를 쓴다.
- 클라이언트는 **`code` 로만 분기**한다. 문구는 로케일에서 고른다.

## 4. RPC 계약 규칙

전체 규칙은 [`../04_DATABASE`](../04_DATABASE/README.md) 에 있고, **계약(호출자 관점)** 만 여기 요약한다.

| 규칙 | 근거 |
|---|---|
| 사용자 id 를 인자로 받지 않는다 — 함수 안에서 `auth.uid()` 로 읽는다 (`my_*` 패턴) | "넘길 게 없으니 위조할 것도 없다" (mig 232) |
| 어쩔 수 없이 `p_user_id` 를 받으면 IDOR 가드 2변형 중 하나를 반드시 넣는다 | mig 098 |
| 인자 시그니처를 바꿀 때는 `CREATE OR REPLACE` 가 아니라 **`DROP FUNCTION IF EXISTS` 먼저** | 인자 추가는 오버로드를 만들고 PostgREST 가 둘 사이를 골라버린다 |
| 이름 접두사로 역할을 표시: `_`=내부 헬퍼, `admin_`=is_admin() 가드, `get_`/`set_`, `my_`=auth.uid() 전용 | |
| 예약 RPC 는 `authenticated`, 과금/정산/해제 RPC 는 `service_role` 전용 | 클라이언트가 스스로 과금을 마감할 수 없게 |
| 반환 형태를 바꾸면 그 RPC 를 읽는 클라이언트를 **같은 PR** 에서 고친다 | 타입 게이트가 없다(§6) |

## 5. 엣지 함수를 새로 만들 때 체크리스트

1. 정말 엣지여야 하나? (§1)
2. 파일 헤더에 **호출자·시크릿·verify_jwt·실패 정책**을 적었나?
3. `deno.json` 임포트 맵을 만들었나?
4. CORS 허용목록을 붙였나? (브라우저가 부르는 함수라면)
5. `opsGate()` 를 통과시키나? (돈/AI 라면)
6. 웹훅이면 서명 검증 + 시크릿 미설정 시 503 인가?
7. 실패 응답이 `{ error, code }` 이고 code 가 §3 어휘 안에 있나?
8. `supabase/config.toml` 에 필요한 블록을 넣었나?
9. **배포는 자동이 아니다** — `supabase functions deploy <name>` 을 릴리스 체크리스트에 넣었나?
10. 로직을 `packages/` 에서 복제했다면 parity 테스트를 만들었나? (제1원칙 R4)

## 6. 함정

- **엣지 함수는 CI 가 전혀 보지 않는다.** 타입체크·린트·테스트·배포 모두 없다. 결제 웹훅 4개, 환불, AI 과금이 전부 여기 산다. 유일한 보호는 웹 vitest 가 파일시스템으로 끌어다 쓰는 15개 테스트뿐이고, `ai-generate/index.ts`(1,535줄)는 **import 하는 테스트가 0개**다.
  → 새 로직은 가능한 한 `_shared/` 의 순수 함수로 빼서 웹 테스트가 직접 import 할 수 있게 만든다.
- **`supabase-js` 의 `rpc()` 는 thenable 이라 `.catch()` 가 없다.** `.rpc().catch()` 는 `catch is not a function` 을 던져 200 응답을 500 으로 바꾼다. **await 후 반환된 `error` 를 검사**하고, network throw 만 try/catch 로 감싼다.
- **과금/정산/해제는 best-effort 이며 이미 벌어들인 200 응답을 가리지 않는다.** 반대로 하면 사용자는 결과를 못 받고 돈만 나간다.
- **`REVOKE ... FROM PUBLIC` 은 service_role 의 암묵 EXECUTE 까지 벗긴다.** mig 098 이 `resolve_api_key` 를 잠그자 엣지의 API 키 인증이 전부 401 이 됐고 mig 107 이 복구했다. 내부 헬퍼를 잠글 때는 **엣지가 그 함수를 부르는지** 먼저 확인한다.
- **`ai-generate/index.ts` 에는 리터럴 NUL 바이트가 있다**(1022줄). 셸 `grep`/`rg` 가 이 파일을 바이너리로 보고 조용히 건너뛴다 — 감사할 때 `grep -a` 를 쓴다.

## 관련 문서
[`../04_DATABASE`](../04_DATABASE/README.md) · [`../05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md) · [`../06_RESILIENCE`](../06_RESILIENCE/README.md) · [`../11_SECURITY`](../11_SECURITY/README.md)
