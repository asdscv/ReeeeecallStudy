# 학습 로직을 Pro 플랜의 판매 근거로 쓸 수 있는가 — 근거와 수정 설계

작성 2026-08-01. 대상: `packages/shared/learning/**`, `packages/shared/lib/learning-candidates.ts`,
`packages/shared/stores/learning-store.ts`.

이 문서는 "좋아 보인다/나빠 보인다"를 적지 않는다. 확인 방법과 확인된 값만 적는다.
프로덕션 조회는 읽기 전용(count / select)만 사용했다.

---

## 1. 질문

Pro 플랜의 판매 근거를 "개인화된 학습 계획"에 두려고 한다. 지금 코드가 그 문구를
지탱하는가?

답: **아직 아니다.** 알고리즘의 수학은 대체로 정확하고 근거도 명시돼 있으나, 실제로
판매하는 물건 — 하루치 카드의 **순서** — 이 사실상 한 개 피처로 정해지고 있다.
아래 ①②③ 은 전부 배관(plumbing) 결함이며, 세 개를 고치면 처음으로 "팔 만한가"를
데이터로 물어볼 수 있게 된다.

---

## 2. 프로덕션 상태 (2026-08-01, 읽기 전용 조회)

| 대상 | 값 |
| --- | --- |
| `cards` 전체 | 377,031 |
| `cards` 중 `interval_days > 0` | 429 |
| `cards` 중 `last_reviewed_at IS NOT NULL` | 433 |
| `user_card_progress` 행 | 14,805 |
| `user_card_progress` 중 `interval_days > 0` | **1** |
| `study_logs` | 515 |
| `learning_goals` / `daily_plans` / `daily_plan_items` | 1 / 1 / 6 |
| `study_recommendations` | 0 |
| `deck_shares` 중 `share_mode='subscribe' AND status='active'` | 3 |

읽는 법:

- 학습 엔진은 실사용에서 **계획 1건**밖에 만든 적이 없다. 그러므로 "실사용자가 불만을
  말하지 않았다"는 것은 아무 증거가 아니다.
- `user_card_progress` 14,805 행은 `acquire_listing` 이 구독 시 심어놓은 **빈 행**이다
  (진도 있는 행은 1건). 즉 "구독자 진도가 대량으로 존재한다"는 진술은 사실이 아니다.
  그러나 활성 구독 3건이 존재하므로 ③ 은 잠재 결함이 아니라 **활성 경로의 결함**이다.

### 2.1 유일하게 실제로 만들어진 계획 — 결정적 증거

`daily_plan_items` 6행 전체:

| position | reason_code | priority |
| --- | --- | --- |
| 0,1,2 | `due` | 0.625 |
| 3,4,5 | `due` | 0.4751086203703703 |

카드 6장 중 서로 다른 우선순위 값이 **2개**뿐이고, 이유 코드는 **전부 `due`** 다.
이 숫자를 v1 가중치로 역산하면 정확히 재현된다 (`algorithm_version = daily-plan-v1`):

- 신규 카드 3장: `0.35·1 + 0.25·0.3 + 0.2·0.5 + 0.1·0.5 + 0.1·0.5 = 0.625`
- 1.0042일 연체 카드 3장: `dueUrgency = 0.5 + (1.0042/7)·0.5 = 0.5717`,
  `0.35·0.5717 + 0.275 = 0.4751086…`

즉 5개 피처 중 **정확히 하나(`dueUrgency`)만 값이 변했다.** `recentFailure` 는 0.3,
`goalRelevance` 는 0.5, `responseTimePenalty` 는 0.5, `contentImportance` 는 0.5 —
모두 상수였다. 이것은 시뮬레이션이 아니라 프로덕션에 저장된 값이다.

---

## 3. 결함 ①②③

### ① `recentFailure` (가중치 0.25) 는 항상 상수다 — 타입 거짓말

`CandidateStudyLog.rating` 은 `number | null` 로 선언돼 있고
(`packages/shared/lib/learning-candidates.ts`), 필터는 이렇다:

```ts
const rated = logs.filter((log) => typeof log.rating === 'number')
if (rated.length === 0) return NEUTRAL_RECENT_FAILURE   // 0.3
```

그런데 `study_logs.rating` 은 **TEXT** 다. CHECK 제약이 값을 열거한다
(`071_fix_study_logs_constraints.sql:21`):

```sql
CHECK (rating IN ('again','hard','good','easy','known','unknown','next','viewed','got_it','missed'))
```

그러므로 `typeof log.rating === 'number'` 는 **항상 false**, `recentFailureFor` 는 항상
0.3 을 반환한다. 가중치 1.00 중 **0.25 가 죽어 있다.**

컴파일러가 잡지 못한 이유: `learning-store.ts` 가
`recentLogs: (logRows ?? []) as CandidateStudyLog[]` 로 검사 없는 캐스트를 한다.

#### 수정 설계 (W1)

`rating` 을 `string | number | null` 로 받고, **실제 어휘를 명시적으로 매핑**한다.
이진 실패율 대신 0..1 의 "고전 정도(struggle)" 로 만든다:

| rating | 값 | 근거 |
| --- | --- | --- |
| `again`, `unknown`, `missed` | 1.0 | 회상 실패 |
| `hard` | 0.5 | 스케줄러는 `hard` 에서 간격을 **늘린다** (`srs.ts` review: `×1.2`). 실패로 세면 스케줄러와 모순되고, 성공으로 세면 고전 신호가 사라진다. |
| `good`, `easy`, `known`, `got_it` | 0.0 | 회상 성공 |
| `next`, `viewed` | 증거 없음 (분모에서 제외) | 평점이 아니라 넘김/열람 기록 |
| 그 밖의 문자열 | 증거 없음 | 미래에 추가될 값을 조용히 실패로 세지 않는다 |

숫자 `rating` 도 계속 받는다 (1..4 → SM-2 등급). 현재 DB 에는 없지만
`FAILURE_RATING` 의 의도를 버릴 이유가 없고, 두 어휘를 한 함수가 판정하면 미래의
마이그레이션이 이 파일을 다시 깨뜨리지 않는다.

캐스트는 `.returns<CandidateStudyLog[]>()` 로 바꿔, 다음에 컬럼 타입이 어긋나면
컴파일러가 말하게 한다.

### ② `reviewValue` (가중치 0.25) 는 04:00 스냅 때문에 짧은 간격 카드를 체계적으로 깎는다

두 개의 독립적인 문제가 겹쳐 있다.

**(a) 스케줄러의 "due" 와 메모리 모델의 "최적 시점" 이 어긋난다.**
`nextDayBoundary` (`srs.ts`) 는 `next_review_at` 을 **다음 04:00 로 스냅**한다. 그래서
카드가 due 가 되는 순간의 실경과일수는 `interval` 이 아니라
`interval − (학습시각 − 04:00)/24일` 이다. `estimateMemory` 는 `last_reviewed_at` 과
`now` 로 경과일을 계산하므로, 이 부족분이 그대로 `R` 을 올리고 `reviewValue` 를 깎는다.
부족분을 `interval` 로 나누기 때문에 **간격이 짧을수록 손해가 크다.**

배포된 `estimateMemory` 를 그대로 실행해 얻은 값 (KST, due 당일 09:00 에 계획 생성):

| interval | 09시 학습 → 09시 계획 | 21시 학습 → 09시 계획 |
| --- | --- | --- |
| 1일 | 1.0000 (경과 1.00일, R 0.9000) | **0.5394** (경과 0.50일, R 0.9461) |
| 3일 | 1.0000 (경과 3.00일) | 0.8540 (경과 2.50일) |
| 7일 | 1.0000 (경과 7.00일) | 0.9383 (경과 6.50일) |
| 30일 | 1.0000 (경과 30.00일) | 0.9857 (경과 29.50일) |

즉 **막 배우기 시작한(간격 1~3일) 카드가 성숙한(30일) 카드보다 낮은 점수를 받는다.**
저녁에 공부하는 사용자에게는 항상 이렇게 된다. 이것은 개인화가 아니라 학습 시각에서
새는 노이즈다.

**(b) 값 곡선이 위험한 카드를 뒤로 보낸다.**
`reviewValue` 는 `R = 0.9` 에서 최대이고 `R` 이 더 낮아지면 **감소**한다 (0.6 까지).
그래서 가장 많이 잊은 카드가 가장 낮은 우선순위를 받는다. FSRS 의 안정성 증가
함수(성공 조건부)로는 정당한 서술이지만, **하루치 예산 안의 순서 결정** 목적에는
맞지 않고 — Anki/FSRS 계열이 권장하는 복습 순서는 `relative overdueness`,
즉 **낮은 R 먼저** 다 — UI 가 말할 "잊어버릴 위험이 큰 카드부터" 와 정면으로 어긋난다.

#### 수정 설계 (W2) — 권장안, 그대로 진행

1. **경과일을 스케줄에 정박시킨다.** `next_review_at` 이 있으면
   `elapsedDays = intervalDays + (now − next_review_at)/1일` 로 계산한다.
   `next_review_at` 은 스케줄러 자신이 "이 카드가 목표 유지율에 도달하는 시점" 이라고
   적어둔 값이다. 그것을 재구성하지 않고 그대로 신뢰하면 04:00 스냅·리스케줄·수동
   날짜 수정·간격을 바꾸지 않는 크래밍 로그가 만드는 불일치가 **전부** 사라진다.
   `next_review_at` 이 없으면 지금처럼 `last_reviewed_at` 으로 되돌아간다.
2. **값 곡선을 R 에 대해 단조 비증가로 만든다.** 목표 유지율에 무릎(knee)을 두고
   `value(1) = 0`, `value(target) = VALUE_AT_TARGET`, `value(0) = 1` 의 조각선형.
   위험한 쪽이 항상 안전한 쪽보다 높다.

두 변경을 합치면 `reviewValue` 는 사실상 **`relative overdueness`** 가 된다: due 시점에
정확히 `VALUE_AT_TARGET`, 연체될수록 상승, 이르면 하락. `dueUrgency`(절대 연체일,
7일 포화, 신규 카드 = 1) 와 겹치지 않고 서로를 보완한다.

### ③ 카드의 99.7% 가 있는 곳에서 플래너는 진도를 읽지 않는다

`getSrsSource` (`packages/shared/lib/srs-access.ts`) 는 명시한다: **덱을 소유하지 않은
사용자의 SRS 상태는 `cards` 행이 아니라 `user_card_progress` 에 있다.** 구독/공식 덱이
전부 여기에 해당한다.

`learning-store.ts` 의 `generatePlan` 은 `user_card_progress` 를 **한 번도 참조하지
않는다** (`grep -c user_card_progress packages/shared/stores/learning-store.ts` = 0).
그래서 구독 덱에 대해:

- **due 필터가 틀린다.** `cards.next_review_at` 은 발행자의 값(공식 덱은 NULL)이므로
  모든 카드가 "신규 = 최대 due" 로 통과한다.
- **학습자가 쌓은 진도가 보이지 않는다.** `interval_days`/`last_reviewed_at` 이 발행자
  행에서 0/NULL 로 읽히므로 `reviewValue` 는 null, `dueUrgency` 는 1 로 고정된다.
- 결과적으로 6개 피처 중 5개가 상수 → **전 카드 동점** → 플래너의 타이브레이커
  `candidateId.localeCompare` 에 의해 **UUID 순서**가 된다.

`record_answer_attempt` 는 `cards` 를 갱신하지 않으므로, 학습 엔진 안에서 문제를 아무리
풀어도 이 피처들은 개선되지 않는다. 루프가 닫혀 있지 않다.

#### 수정 설계 (W3)

1. 목표에 붙은 덱의 소유자를 읽어 `getSrsSource` 로 **소유 덱 / 구독 덱을 분리**한다.
2. 소유 덱: 지금처럼 `cards` 의 SQL due 필터를 쓴다.
3. 구독 덱: `user_card_progress` 에서 자신의 due 행을 읽고, `mergeCardWithProgress` 로
   발행자 카드에 겹친 뒤 due 판정을 클라이언트에서 한다. 진도 행이 없는 카드는 신규다.
4. **동점의 타이브레이커를 의미 있게 만든다.** 신규 카드가 대량으로 동점일 때 UUID
   순서는 근거가 없다. `PlannerCandidate.sequence` (덱 저자가 정한 `sort_position`) 를
   추가해 동점 시 그 순서를 쓴다. 결정성은 유지되고, 순서에 의미가 생긴다.

---

## 4. 지킬 것 — 이 코드에서 실제로 좋은 부분

고치는 과정에서 아래를 훼손하지 않는다. 근거를 직접 실행/독해로 확인했다.

- **FSRS 상수가 자유 파라미터가 아니다.** `R(t) = (1 + 19/81·t/S)^(−1/2)` 에서 19/81 은
  "안정성 = 유지율이 90% 로 떨어지는 일수" 정의에서 유도된 값이고, 테스트가
  `R(S,S) = 0.9` 를 12자리로 고정한다. 주석이 근사를 근사라고 부른다
  (`stabilityFromInterval` 은 identity 이며 "BRIDGE, not a measurement" 로 명시).
- **null 과 0 을 구분한다.** 증거 없음에 0 을 넣지 않고 null 을 전파해 사용된 가중치로
  재정규화한다 (`scoreCandidate` 의 `used` 분모). `?? 0` 으로 뭉개는 흔한 결함이 없다.
- **설명이 산술과 어긋날 수 없다.** 하나의 `FEATURES` 배열이 점수와 `reasonCode` 를
  동시에 만든다. 계산되지 않은 피처는 이유가 될 수 없다.
- **`apply_study_rating` 은 프로덕션급이다.** 멱등(`rating_event_id`), advisory lock,
  `srs_revision` 낙관적 잠금. SRS 백엔드에서 가장 비싼 부분이고, 스케줄러를 FSRS 로
  갈아타더라도 건드리지 않는다.

---

## 5. 가격 페이지에 쓸 수 있는 문구 / 쓸 수 없는 문구

세 결함을 고친 뒤에도 아래 구분은 유지된다.

**쓸 수 없다:**

- "FSRS" — 메모리 **모델**만 FSRS 모양이고, 간격을 정하는 스케줄러는 SM-2 다
  (`srs.ts`, `ease_factor`/`repetitions`). 간격 페이지에 FSRS 를 쓰면 오해 소지가 있다.
- "당신의 망각 곡선을 학습합니다" — 개인별 파라미터 피팅이 없다. `estimateMemory` 는
  `stabilityDays` 를 받을 수 있지만 아무도 넣지 않는다.
- "AI 가 채점합니다" — `evaluate` 는 서빙되지 않는다 (채점기 미연결, 루브릭 없음).

**쓸 수 있다 (W1~W3 이후):**

- "복습 시점을 기억 확률로 판단합니다" — `retrievability` 가 실제로 계산되고,
  W2 이후 순서에 반영된다.
- "잊어버릴 위험이 큰 카드부터" — W2 의 단조 곡선 이후에 참이 된다. **그 전에는 거짓.**
- "지금 이 오답을 설명해 드립니다" — `explain`/`hint` 는 실제로 시도(attempt)에 정박돼
  있다 (mig 176, PR #377/#378).

---

## 6. 그래도 남는 것 — 검증

세 결함을 고쳐도 **"v2 가 v1 보다 낫다"는 숫자는 여전히 0개다.** 백테스트·시뮬레이션·
홀드아웃이 없고, 현재 테스트는 나머지 피처를 고정한 단일 피처 지배 검사다.
계획 1건·카드 429장의 이력으로는 통계적 주장을 할 수 없다.

그래서 판매 문구는 **작동을 서술하는 문구**("기억 확률로 순서를 정합니다")까지만 쓰고,
**효과를 주장하는 문구**("2배 빨리 외웁니다")는 쓰지 않는다. 후자는 데이터가 쌓인 뒤에
백테스트로 근거를 만들고 나서 쓴다.

---

## 7. 결과 (2026-08-01 저녁) — ①②③ 모두 머지, 그리고 실측

| 결함 | PR | 머지 |
|---|---|---|
| ① `recentFailure` 상수 (TEXT vs number) | #387 | `10a36fd` |
| ② `reviewValue` 상수/역전 (04:00 스냅 + 봉우리 곡선) | #388 | `2564cd1` |
| ③ 플래너가 `user_card_progress` 를 안 읽음 | #389 | `76de802` |
| 랭킹이 실제로 작동함을 고정하는 E2E 테스트 | #390 | — |

### 7.1 §6 이 "0개"라고 적은 숫자 — 이제 있다

§6 의 지적("v2 가 낫다는 숫자가 0개")은 **여전히 절반 유효**하다. 아래는 **효과**(더 잘
외워진다) 가 아니라 **작동**(순서를 실제로 만든다) 의 증거다. 둘을 섞지 않는다.

프로덕션과 같은 형태 — 공식 덱 구독자, 3개월차 계정 — 로 진짜 플래너를 돌린 결과:

```
순위  카드          간격   지연   점수      이유
 1   nearly-lost    1d    6d   0.6984   memory_risk
 2   month-late    30d   30d   0.5677   memory_risk
 3   mid-late      10d    6d   0.5586   memory_risk
 4   barely-moved  90d    6d   0.5557   memory_risk
 5   short-due      1d    0d   0.5125   memory_risk
 6   long-due      90d    0d   0.4059   memory_risk
```

**6장 → 서로 다른 점수 6개.** 수정 전 같은 조건에서는 200장 → 점수 **1개**였다.

핵심은 3위와 4위다. `mid-late`(10일 카드 6일 지연)와 `barely-moved`(90일 카드 6일 지연)는
due-date 정렬에게는 **똑같이 "6일 지연"** 이다. 상대 지연으로 보면 0.6배와 0.07배로 전혀
다르고, 이 차이를 만들 수 있는 건 `reviewValue` 뿐이다. **이것이 이 엔진이 due-date 정렬
대비 파는 유일한 실체다.**

`packages/web/src/lib/__tests__/learning-plan-discriminates.test.ts` 가 이걸 고정한다.
①③ 을 각각 되돌리면 red 로 바뀌는 것까지 확인했다.

### 7.2 이유 코드 도달 가능성 — 7개 중 4개

1,200 조합(간격 × 지연 × 실패이력 × 소요시간 × 덱 중요도) 스윕 결과:

| 이유 코드 | 도달 | 횟수 |
|---|---|---|
| `memory_risk` | YES | 388 |
| `recent_failure` | YES | 170 |
| `goal_relevance` | YES | 38 |
| `importance` | YES | 4 |
| `due` | **no** | 0 |
| `slow_response` | **no** | 0 |
| `balanced` | **no** | 0 |

`due`(0.10)와 `slow_response`(0.10)는 **구조적으로 도달 불가**다. 최대 기여가 0.10인데
`memory_risk`(0.25)와 `recent_failure`(0.25)의 하한이 그보다 높다. 16개 로케일에 번역돼
있지만 화면에 뜨지 않는 문자열이다.

**가중치를 만져 라벨을 예쁘게 만들지 않는다.** 그건 설명을 맞추려고 순서를 틀리게 하는
것이다. 라벨이 실제로 지배적인 피처를 말하는 지금 상태가 옳고, 도달 불가라는 사실을
여기 적어 두는 것으로 충분하다.

### 7.3 그래서 팔 수 있나 — 바뀐 것과 안 바뀐 것

**바뀐 것:** "가장 잊어버렸을 카드부터, 각 카드 고유 주기 대비로" 가 이제 **참이고 테스트로
고정돼 있다.** 오늘 아침까지는 거짓이었다.

**안 바뀐 것 (가격 페이지 기준 그대로):**

- 스케줄러는 여전히 **SM-2**다. "FSRS" 는 여전히 쓸 수 없다 — 기억 모델만 FSRS 모양이다.
- 개인별 파라미터 피팅 없음 → "당신의 망각 곡선을 학습합니다" 여전히 불가.
- `goalRelevance`(0.20) 하드코딩 0.5, `contentImportance`(0.10) 추천 0건 → 상수.
  **결함이 아니라 제품 결정** (덱 가중치 UI 가 없다).
- **이 정교함은 여전히 화면에 안 보인다.** 계획 행에 이유 문자열 하나가 전부고, 숫자는
  없다. 보이지 않는 정교함은 아무리 옳아도 팔리지 않는다 — 남은 것 중 가치/노력 비가
  제일 높은 항목.
- 실사용자는 여전히 2명. §6 의 "효과 주장 금지" 는 그대로 유효하다.
