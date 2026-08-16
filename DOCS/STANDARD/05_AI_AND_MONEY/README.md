# 05. AI 와 돈 — 제공자 · 미터링 · 가격 · 무료 정책

> 이 영역의 결함은 조용하고 비싸다. **43배 과금**은 프로덕션에서 실제로 계량됐고, **홀드 영구 동결**과 **무료 카드 한도 누수**는
> 퀴즈 미터링을 붙이던 mig 194 에서 배포 직전에 막았다. 그래서 규칙 하나하나가 사고·차단 기록에 묶여 있다.

## 목차
- [1. 단일 진입점](#1-단일-진입점)
- [2. 제공자·모델 — 코드가 아니라 레지스트리 + env](#2-제공자모델--코드가-아니라-레지스트리--env)
- [3. 돈의 흐름 — 예약 → 과금/해제](#3-돈의-흐름--예약--과금해제)
- [4. 가격과 무료 정책 — 데이터로](#4-가격과-무료-정책--데이터로)
- [5. 모델 호출 규칙](#5-모델-호출-규칙)
- [6. 프롬프트](#6-프롬프트)
- [7. 체크리스트](#7-체크리스트)
- [8. 함정](#8-함정)

---

## 1. 단일 진입점

**모든 모델 호출은 `supabase/functions/ai-generate/index.ts` 하나를 통과한다**(9개 `kind`).
TTS 만 `supabase/functions/tts/index.ts` 로 갈라져 있고, 이쪽은 지갑·원장·환불이 없는 **단순 일일 카운터**다(의도된 차이).

- 클라이언트는 `packages/shared/lib/ai/server-client.ts` 의 `callServerAI()` 로 부른다.
  예외 1건: `quiz-store` 가 `supabase.functions.invoke` 를 직접 호출한다(자체 에러 파서 보유) — 부채.
- **클라이언트가 raw prompt 문자열을 보낼 수 없다.** 구조화된 파라미터만 보낸다. 우리 키가 범용 LLM 프록시로 쓰이는 것을 막는 경계다.

## 2. 제공자·모델 — 코드가 아니라 레지스트리 + env

| 하려는 일 | 비용 |
|---|---|
| 모델 교체 | **0파일** — edge secret `AI_GENERATION_MODEL` / `AI_VISION_MODEL` / `*_MODEL_FALLBACKS` |
| 새 제공자 | `_shared/ai-providers.ts` 의 `PROVIDERS` 1엔트리 + `ai_pricing_config` 요율 행 마이그레이션 |

| 규칙 | 게이트 |
|---|---|
| 모델명 리터럴은 `PROVIDERS` 와 env 밖에 존재하지 않는다 | `server-providers.test.ts`, `ai-provider-chain.test.ts` — 단 두 테스트는 리졸버가 `PROVIDERS`/env 에서 모델을 뽑는지만 검증한다. ⚠️ **다른 파일에 모델명 리터럴이 없다는 것을 강제하는 가드는 없다**(`tools/check-arch.ts` 에 해당 규칙 없음). 현재는 사실상 지켜지고 있을 뿐이다 |
| 텍스트와 비전은 **서로 다른 제공자/키/모델**을 가질 수 있다. 한쪽 키가 다른 제공자로 새면 안 된다 | `ai-provider-chain.test.ts:203-261` |
| 폴백 체인은 **항상 싼 것부터** | `ai-provider-chain.test.ts` fallback ordering |
| 은퇴한 모델을 체인에 남기지 않는다 | `ai-provider-chain.test.ts` + `ai-model-watch` 크론(매일 09:00 KST, **새로 나타난 모델**과 조회 실패 제공자를 GitHub 이슈로). ⚠️ 이 크론은 목록에서 **사라진 모델은 감지하지 않는다** — 은퇴 탐지는 `ai-provider-chain.test.ts:89` 의 `it('lists no model the API has retired')` 하나뿐이고, 그 목록은 사람이 갱신한다 |
| 체인이 도달할 수 있는 **모든** 모델에 `ai_pricing_config` 요율 행이 있어야 한다 | `supabase/tests/unpriced_model_test.sql` ⚠️ **gemini 체인만** 검사 |
| 어떤 액션도 최고가 모델 원가의 **10배** 아래로 팔지 않는다 | `price-floor.test.ts` ⚠️ RATE 맵에 없는 모델은 조용히 건너뜀 |

**⚠️ 두 가드 모두 gemini 하드코딩이다.** deepseek/xai/openai 체인은 어느 쪽에도 걸리지 않는다.
새 제공자를 넣을 때는 `unpriced_model_test.sql:28-32` 의 배열과 `price-floor.test.ts` 의 **RATE 맵 그리고 `dearest()`** 를 같이 넓힌다 — `dearest()` 는 `PROVIDERS.gemini` 만 읽으므로 RATE 맵에 다른 제공자 요율을 넣어도 그 모델은 검사 대상에 들어오지 않는다.

**키 운영 주의**: `supabase secrets set` 은 `supabase/config.toml` 의 `[edge_runtime.secrets]` 블록도 **함께** 밀어 올린다. 요청한 개수보다 많이 올라갔다면(count > 요청 수) 프로덕션 키가 덮였는지 즉시 확인한다. → [`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md)

## 3. 돈의 흐름 — 예약 → 과금/해제

```
reserve_ai_*(authenticated)  →  모델 호출  →  결과 검증
                                              ├─ 쓸 수 있음 → charge_ai_generation / settle_ai_quiz (service_role)
                                              └─ 쓸 수 없음 → release_ai_job (service_role)
```

| 규칙 | 이유 |
|---|---|
| **예약 시점에 원장(`ai_credit_ledger`)에 아무것도 쓰지 않는다.** 잔액 게이트 + 카운터/홀드만 잡는다 | 환불 자격 판정(`refund_eligibility`, mig 157)이 `delta < 0 AND reason <> 'refund'` 합으로 팩 사용 여부를 정한다 — 예약 차감 행을 쓰면 보정 양수행을 넣어도 **학습자의 환불권이 영구 소멸**한다 |
| 실패는 자동으로 net-zero 여야 한다 | |
| 예약 RPC 는 `authenticated`, 과금/정산/해제는 `service_role` 전용 | 클라이언트가 스스로 마감할 수 없게 |
| **모델이 답했어도 결과가 쓸 수 없으면 과금하지 않고 해제한다** — deck 은 name 존재, 나머지는 비어있지 않은 항목 배열, quiz 는 요청 대비 50% 미만이면 unservable | 게이트 없음(`resultIsUsable` 을 import 하는 테스트가 0) |
| 과금/해제는 **best-effort**. 이미 벌어들인 200 응답을 절대 가리지 않는다 | |
| 부분 실패는 **드롭 사유 enum + cardId** 로만 로그·응답에 싣는다. **카드 내용은 절대 싣지 않는다** | PII |
| 모델이 고칠 수 있는 사유로 배치 전체가 죽었을 때만 **같은 예약 안에서 1회** 교정 재시도 | |

**액션 유형별로 계약이 다르다는 사실 자체를 기억한다**: `charge_ai_generation` 은 quiz job 을 **거부**한다(계산하면 홀드가 영구 동결된다), `release_ai_job` 은 quiz job 에 카드 카운터를 깎지 않는다(쓰지도 않은 `free_cards_used`/`paid_cards_used` 를 되돌려 **무료 카드 한도가 조용히 새어 나간다**). 새 kind 를 추가할 때 이 두 함수의 분기를 반드시 확인한다.

**그리고 새 kind 만이 아니라 새 카운터도 마찬가지다.** mig 239 가 `free_quiz_items_used` 를
추가하면서 `release_ai_job` 을 고치지 않았고, 그 결과 **생성이 실패하면 그날 무료 문항이 통째로
소멸**했다(유닛은 돌아오고 문항은 안 돌아옴 → 재시도가 전액 유료). 정상 경로에서는 보이지
않는다 — 생성이 성공하고 전부 배달되면 아무 증상이 없다. mig 240 에서 고쳤다.

카운터를 하나 추가하면 **그 값을 만지는 함수 전부**를 세어 본다. 한 줄로 확인할 수 있다:

```sql
select p.proname,
       (p.prosrc like '%<옛_컬럼>%') as old, (p.prosrc like '%<새_컬럼>%') as new
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc like '%<옛_컬럼>%' order by 1;
```

`old = t, new = f` 인 행이 곧 빠뜨린 경로다. 예약·정산·해제·견적·지갑요약 다섯이 전부
나와야 한다.

## 4. 가격과 무료 정책 — 데이터로

| 값 | 테이블 | 변경 비용 |
|---|---|---|
| 액션 정가 | `ai_action_prices` (mig 216) | `UPDATE` 1행 |
| 퀴즈 유닛 수 | `ai_quiz_price_units` (mig 194) | 1행 |
| 퀴즈 유닛 단가 | `ai_pricing_settings.quiz_unit_price_micro` | 1행 |
| **무료 배분** | `ai_free_allowances(tier, action_group)` (mig 239) | 1행 |
| 모델 요율 | `ai_pricing_config` | 1행 |

**무료 정책 커널** (mig 239): `_ai_free_allowance(user, action_group)` 이 그 사용자에게 적용되는 **한 행**을 돌려준다.
호출부는 숫자도 티어도 모른다. 행이 없으면 **0 = 유료**(안전 방향 폴백).
`action_group` 이 enum 이 아니라 text 인 것은 의도다 — 새 AI 행동에 타입 변경이 필요 없다.

**가격 마이그레이션 금기 2개**
1. **곱셈 갱신 금지** (`price_micro * 10`). 마이그레이션은 로컬·프로덕션·CI 재생성으로 여러 번 돈다 — 두 번 적용돼 100배가 된 적이 있다. 절댓값 + 이전 값 `WHERE` 가드.
2. **`target_margin_bps` 를 가격 인상 노브로 쓰지 않는다.** 그 값은 charge 경로의 마크업 제수(`10000/(10000-bps)`)이자 동시에 `ai_cost_ledger.under_target` 의 판정 기준이다. `under_target` 은 행이 기록될 때 확정 저장되므로 과거 job 이 소급해 빨개지지는 않지만, 값을 올린 순간부터 기록되는 모든 job 의 판정선이 달라져 대시보드가 일어나지 않은 마진 악화를 보고하기 시작한다.

**클라이언트에 한도를 미러링하지 않는다.** `card-count.ts` 가 미러를 제거한 이유를 헤더에 적어 뒀다.
(잔여 부채: `server-client.ts:110,235` 가 읽기 실패 시 `10` 으로 fail-open)

## 5. 모델 호출 규칙

| 규칙 | 사고 기록 |
|---|---|
| **추론 모델은 `reasoningEffort: 'none'` 을 명시한다** | deepseek-v4-flash 가 3,000 토큰 중 2,847을 reasoning 으로 써서 JSON 이 잘렸고 **서술형 퀴즈 생성이 100% 실패**했다. none 이면 856토큰·6초 |
| 폴백 자리(i>0)의 실패는 **종류 불문 다음 후보로** 넘어간다. rethrow 하면 전 AI 기능이 죽는다 | 폴백 1번의 404 가 3번의 정상 모델 도달을 막아 전 기능이 "AI 서비스가 붐빕니다"로 나갔다 |
| **429 를 한 덩어리로 취급하지 않는다** — 분당 한도와 하루 쿼터는 다른 상태다. PerDay 는 재시도로 못 넘기므로 즉시 폴백으로 | Gemini 의 'retry in 58s' 힌트를 기다리면 1분 낭비 후 실패 |
| **타임아웃은 재시도하지 않는다** | 이미 예산 전체(추론 90초)를 쓴 호출을 두 번 더 하면 학습자를 3배 기다리게 한다. 네트워크 에러는 재시도, abort 는 아님 |
| JSON 파싱 실패는 **더 엄격한 시스템 프롬프트로 1회만** 재시도하고 두 호출 토큰을 합산해 과금. 한쪽이 usage 를 안 주면 합산하지 않고 null(=estimated) | 정직한 계량 |
| 액션별 출력 토큰 상한(`OUTPUT_CAP`)은 성능 노브가 아니라 **가격 상한**이다. 측정 최댓값의 약 3배 | |
| 채점 온도는 **0** — 같은 답안을 두 번 내면 같은 점수여야 `normalized_score` 를 플래너가 쓸 수 있다 | |
| **모델은 정답을 쓰지 않는다.** MCQ 는 모델이 오답 보기만 만들고 정답은 서버가 카드 필드에서 삽입, 위치는 item id 에서 결정론적으로 파생 | `ai-quiz.test.ts` |

## 6. 프롬프트

- 프롬프트는 **엣지 TS 상수**다(`_shared/ai-prompts.ts`, `_shared/ai-quiz-prompts.ts`, `_shared/ai-remediation.ts`). 예외는 난이도 밴드 지시문으로 `quiz_difficulty_levels.guidance` jsonb 에서 읽는다.
- **언어 지시는 태그가 아니라 언어명으로.** `write the question in "ko"` 는 영어 출력을 냈고 `in Korean` 은 동작했다. BCP-47 태그는 DB 가 저장하는 값이지 모델이 따르는 지시가 아니다.
- **언어 지시를 '타이브레이커' 이상으로 강화하지 않는다.** 강화 버전을 배포했더니 서술형이 `answer_leaked_in_question` 으로 전멸했다. 문구를 바꾸기 전에 `supabase/tests/quiz_prod_e2e.ts` 를 돌려 DROP 수를 비교한다.
- 다국어 처리 방식이 현재 **세 가지로 갈라져 있다**(한/영 이분법 · `LANGUAGE_NAMES` 8언어 · BCP-47 태그 삽입). 새 프롬프트는 `LANGUAGE_NAMES` 방식을 쓴다.

## 7. 체크리스트

**모델/제공자를 바꿀 때**
- [ ] 새 모델이 `ai_pricing_config` 에 요율 행을 갖는가? (후속작이라고 전작 요율을 가정하지 않는다 — 실제로 입력 2.5배·출력 3.75배였다)
- [ ] 체인 순서가 싼 것부터인가?
- [ ] `unpriced_model_test.sql` / `price-floor.test.ts` 가 그 체인을 실제로 보는가?
- [ ] 추론 모델이면 `reasoningEffort` 를 껐는가?

**유료 액션을 추가할 때** → [`../01_ARCHITECTURE/extension_points.md §3`](../01_ARCHITECTURE/extension_points.md)
- [ ] 예약/과금/해제 3단계를 모두 붙였는가?
- [ ] `charge_*` 와 `release_*` 의 유형별 분기를 확인했는가?
- [ ] `ai_free_allowances` 행을 넣었는가(무료로 열 거라면)?
- [ ] SQL 스위트를 만들고 `ci.yml` 에 등록했는가?

## 8. 함정

- **핀 박은 모델명은 썩는다.** 은퇴(404)되거나 무료 쿼터가 하루 20회로 잘린다. 같은 사고를 3번 겪었고 매번 학습자가 에러를 맞고서야 발견됐다. `ai-model-watch` 크론이 그래서 있다.
- **`ai_pricing_config` 요율 행 누락 = 43배 과금.** `_ai_resolve_rate` 가 빈 결과를 내면 pessimistic 폴백($5/$15 per Mtok)으로 계산한다.
- **`crypto.randomUUID()` 는 Hermes 에 없다.** 모바일에서 퀴즈 생성·채점이 둘 다 죽었는데 웹은 멀쩡했고, 자동 테스트는 전부 crypto 가 있는 환경에서 돌아 아무도 못 잡았다. → `newPersistenceId()` 를 쓴다.
- **클라이언트 배치 크기가 서버 `MAX_QUIZ_BATCH` 를 넘으면 그 유형은 영구 불가능해진다.** 두 상수가 다른 패키지에 있고 관계가 어디에도 표현돼 있지 않았다 → 지금은 `quiz-batch-size.test.ts` 가 **서버 상수를 직접 import 하고 마이그레이션 파일을 읽어**, 클라 상수가 그 안에 들어가는지 검증한다(도출이 아니라 관계 단언). 서버 캡과 짝이 되는 클라 상수는 복사하지 말고 이 방식을 쓴다.
- **배치 예산을 총액/배치수로 균등 분할하면 첫 배치부터 P0008 로 거절된다.**(측정: 12문항 MCQ, 견적 120,000 → 배치당 상한 60,000, 실제 첫 배치 8문항이 80,000 → 12문항 중 0문항 배달) 무료·체험 유닛이 호출 단위로 첫 배치에 몰려 균등분할이 어느 배치의 실제 가격과도 맞지 않기 때문.
- **`sweep_ai_quiz_holds` 는 저절로 돌지 않는다**(pg_cron 미설치). `reserve_ai_quiz` 가 호출자 본인의 오래된 홀드를 먼저 정산하는 방식으로 우회하고 있다 — 즉 그 사용자가 다시 예약해야만 정리된다.
- **`quiz_answer_key` 는 코드로 무료다**(가격표에 행이 없고 핸들러가 예약을 건너뛴다). "무료"가 데이터로 결정되는 것과 코드로 결정되는 것이 섞여 있다는 사실을 알고 본다.

## 관련 문서
[`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) · [`../04_DATABASE`](../04_DATABASE/README.md) · [`../06_RESILIENCE`](../06_RESILIENCE/README.md) · [`../AI-HUB.md`](../AI-HUB.md)
