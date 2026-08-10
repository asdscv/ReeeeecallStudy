# 학습 플랜 AI — 진단과 제안

> 조사일 2026-08-10 · **코드는 한 줄도 수정하지 않았습니다** · 읽기 전용 조사
> 병렬 에이전트 9개(스카우트 5 + 설계 3 + 종합 1)를 돌린 뒤, 핵심 주장은 제가 프로덕션에 직접 쿼리해 검증했습니다.
> 검증 결과 **에이전트 주장 하나는 틀렸고**, 아래 §0에 정정해 두었습니다.

---

## 한 줄 결론

> **학습 플랜의 AI가 약한 게 아니라, 없습니다.**
> 그리고 진짜 문제는 모델이 아닙니다 — **이 앱은 학습자가 정답을 실제로 알았는지 한 번도 확인하지 않습니다.** 전부 자가채점입니다.
> 그 구멍을 먼저 막아야 어떤 AI를 붙여도 의미가 생깁니다. 안 막으면 모델은 학습자의 자기 낙관을 근거로 추론하게 됩니다.

---

## 0. 먼저, 제가 직접 검증한 사실만

에이전트 보고를 그대로 옮기지 않았습니다. 계획을 바꿀 만한 주장은 전부 프로덕션에 쿼리했습니다.

| 주장 | 검증 결과 | 근거 |
|---|---|---|
| 학습 플랜에서 AI 호출이 0회 | ✅ **사실** | `ai-generate`의 `kind`는 `template · deck · image · image_deck · quiz_generate · quiz_grade · remediation` 7개뿐. 학습/목표/플랜 파일 어디에도 호출 없음 |
| 모든 활동이 자가채점 | ✅ **사실** | `activitiesForLegacyCard`가 내보내는 값은 `activityType:'recall'`, `evaluatorType:'self_rate'`, `responseType:'self_rate'` **단 하나씩** |
| 플랜 배합의 40%가 후보 0개 | ✅ **사실** | 두 어댑터 모두 `defaultPlanMix: {recall .6, practice .25, produce .15}` 선언 — 그런데 `practice`/`produce` 활동을 만드는 코드가 없음 |
| `recordAttempt` 호출자 0 | ✅ **사실** | 인터페이스 선언(537행)과 구현(1419행)뿐, 테스트 외 호출 없음 |
| 카드가 스스로 문제가 될 수 있다 | ✅ **사실, 더 강함** | 프로덕션 **377,067장 전부(100%)** 템플릿이 정답 필드를 선언 |
| `study_rating_events` 0행 / 로그 3월에 끊김 | ❌ **틀림** | 실제: 29행, 최신 **2026-08-06**. `study_logs` 544행, `study_sessions` 121행 — 파이프라인은 **정상 작동 중** |

### ❌ 정정과, 그보다 중요한 진짜 사실

에이전트는 로그 파이프라인이 죽었다고 봤지만 살아 있습니다. 대신 프로덕션 숫자가 말하는 건 다른 겁니다:

```
study_logs           544행   (최신 2026-08-06)
study_sessions       121행
study_rating_events   29행
answer_attempts       58행   (오늘 제 퀴즈 테스트 포함)
daily_plans            4행   ← 학습 플랜이 지금까지 만들어진 총 횟수
```

**학습 플랜은 지금까지 4번 만들어졌습니다.** 이게 진짜 맥락입니다.

이게 왜 중요하냐면 — "기존 데이터를 AI로 분석해서 인사이트를 준다" 류의 기능은 **전부 빈 화면이 됩니다.** 캘 데이터가 없습니다.
그러니 기능 평가 기준은 *"기존 데이터를 잘 쓰는가"*가 아니라 **"학습자가 매일 돌아올 이유를 만드는가"**여야 합니다.

---

## 1. 이미 다 만들어놓고 안 쓰는 것 두 개

이게 이번 조사에서 제일 놀란 부분입니다. 새로 만들 게 아니라 **되살릴 게** 있습니다.

### (1) AI 리메디에이션 — 완성·과금·배포 끝, UI만 없음

`설명 / 힌트 / 비교` 기능이 서버에 통째로 살아 있습니다.

| 항목 | 상태 |
|---|---|
| 서버 로직 | `supabase/functions/_shared/ai-remediation.ts` (14.5KB), `ai-generate`에 19곳 연결 |
| 과금 | 마이그레이션 168, 프로덕션에 `reserve_ai_remediation` · `persist_ai_remediation` **살아 있음** |
| 검증 계약 | 근거 인용 강제(`compareGroundingError`), 허용 소스 목록 |
| 테스트 | `ai-remediation.test.ts` 등 다수 |
| **클라이언트 호출** | **0곳** — 테스트 파일만 참조 |
| i18n 문자열 | 삭제됨 |

`LearningTodayScreen.tsx:47`의 주석이 전부를 설명합니다:

> *"Paid AI remediation (설명 / 힌트 / 비교) and its preview sheet. **Removed as a product decision, not a rendering one.** The `ai-generate` function and its metering are untouched server-side."*

**즉 렌더링 문제가 아니라 제품 판단으로 뗀 겁니다.** 왜 뗐는지는 오너만 압니다(→ §6 질문 4).
설계도 훌륭합니다 — `compare`는 "학습자가 실제로 쓴 답"과 "템플릿이 선언한 정답" **양쪽이 다 있을 때만** 동작하고, 하나라도 없으면 일반 설명으로 퇴화하지 않고 **거부**합니다. `evaluate`는 채점기가 없다는 이유로 의도적으로 미구현 상태입니다.

또 하나: SQL 허용목록에는 `generate · evaluate · recommend`가 **이미 예약돼 있습니다.** 다음 로드맵이 이미 그려져 있는 셈입니다.

### (2) 추천 테이블 — AI 프로듀서용 자리가 비어 있음

`study_recommendations`는 처음부터 **프로듀서 교체 가능**하게 설계됐습니다.

```ts
// learning-store.ts — 현재 유일한 프로듀서
p_provider: 'algorithm',
p_algorithm_version: WEAK_CARD_RECOMMENDER_VERSION,  // 'weak-card-v1'
```

주석이 명시적으로 말합니다:

> *"Nothing here calls the model — **an AI producer can write the same table under a different `provider` without a schema change.**"*

현재 알고리즘은 `평균 점수 낮은 카드 10개`를 뽑아 `"mean 42% over 5 attempts"`라고 적는 게 전부입니다.
**AI 프로듀서를 위한 자리(`provider` 컬럼)가 설계돼 있고, 한 번도 채워진 적이 없습니다.**

---

## 2. 진단 — 얼마나 약한가

### 학습 플랜을 열면 실제로 일어나는 일

1. Postgres 읽기 10~18회
2. `supabase.functions.invoke` — **도달하지 않음**
3. 화면이 "지능"처럼 보여주는 것의 정체:
   - 오늘 뭘 할지 = `daily-planner.ts`의 **하드코딩된 가중치 6개에 대한 argmax**
   - 추천 = 평균 점수 낮은 카드 정렬
   - 완료 예상일 = 산술

### 더 근본적인 문제 — 측정이 없다

```
학습자가 카드를 봄
  → "쉬움/보통/어려움" 스스로 누름        ← 이게 유일한 신호
  → SRS 간격 조정
  → 내일 플랜
```

`apply_plan_study_rating`(mig 187)이 기록하는 응답은 문자 그대로 `{self_rated, srs_rating}` 뿐입니다.
**학습자가 답을 타이핑할 수 있는 유일한 경로인 `recordAttempt`는 호출자가 0개입니다.**

그래서:
- 플랜 배합의 `practice 25% + produce 15% = 40%`는 **후보가 0개**라 전부 `recall`로 되돌아갑니다
- 랭킹 가중치의 10%인 `responseTimePenalty`는 사실상 **"자기 정직함을 얼마나 오래 고민했는가"**를 재고 있습니다

> **결론: 모델을 붙일 자리가 없는 게 아니라, 모델이 볼 진실이 없습니다.**

---

## 3. 제안 — 우선순위

정렬 기준은 (임팩트 × 확신) / 노력, **의존성 반영 후**.

| # | 기능 | 노력 | 과금 | 왜 이 순서 |
|---|---|---|---|---|
| **P0** | 플랜 실명(失明) 봉합 — *AI 아님* | S | — | #5의 전제. 안 고치면 AI가 성실한 학습자에게 "속도 줄이세요"라고 함 |
| **1** | **오늘의 확인** / Daily Check | M | 채점만 유료 | 나머지 전부의 입력을 만듦 |
| **2** | **왜 틀렸을까** / Why I Missed It | S | 실비 | 서버 이미 완성(리메디에이션 부활) |
| **3** | **돌아왔어요** / Comeback Triage | S− | **무료** | 비율 최고, 하루면 됨. 병렬로 바로 |
| **4** | **오답 유형** / Miss-Type Report | S | **무료** | 이미 돈 주고 산 분류를 버리고 있음 |
| **5** | **주간 플랜 코치** / Weekly Coach | M | **무료** | 추천 seam을 드디어 채움. P0에 막힘 |
| **6** | **약점 지도** / Weak-Topic Map | S/M | 거의 무료 | 태그 커버리지 먼저 확인 후 결정 |
| **7** | **문장 만들기** / Produce | L | 유료 | 천장은 제일 높음, 제일 큼 |

---

### P0. 플랜 실명 — AI 이전에 이것부터

`apply_plan_study_rating`은 URL에 `goalId` + `planDate`가 있을 때만 발동합니다.
**`/decks`에서 공부하면**(앱에서 제일 자연스러운 경로) 카드 복습일은 밀리는데 플랜 항목은 전부 `pending`으로 남습니다.

결과:
- 내일도 `28장 남음`
- 달성률 ≈ 0%
- 완료 예상일이 `1/달성률`로 나뉘어 **매일 공부하는 사람일수록 완료일이 늘어남**
- `학습 시작`이 오늘 이미 본 카드를 다시 내주고 간격을 **이중으로** 밀어버림

**AI를 여기 얹으면, 제일 성실한 학습자에게 자신 있게 "페이스 줄이세요"라고 말합니다.**

권장: 진입점마다 `goalId`를 넘기지 말고(6곳에서 어긋납니다) **`apply_study_rating` 레벨에서 같은 트랜잭션 안에 매칭되는 pending 플랜 항목을 완료 처리**.

---

### 1. 오늘의 확인 / Daily Check — 첫 번째로 만들 것

**학습자가 보는 것**

오늘 카드를 다 본 뒤 카드 하나:
> `오늘 배운 8장, 진짜 아는지 확인 (약 2분)`

전체화면, 한 문항씩. 카드의 앞면 필드 + 입력창 하나. **정답 보기 버튼 없음.**
제출하면:
> `8장 중 6장 정확 · 2장은 애매`
애매한 것만 학습자가 쓴 답과 카드 정답을 나란히, 다른 부분에 밑줄.
하단: `2장을 확인하는 데 4유닛을 썼습니다. 정확히 맞힌 6장은 무료입니다.`

**왜 이게 첫 번째인가 — 세 가지가 겹칩니다**

1. **문제를 생성하지 않습니다.** 프로덕션 **377,067장 전부** 템플릿이 정답 필드를 선언합니다. 카드의 앞면이 곧 문제입니다.
   → `200_quiz_easy_band_without_ai.sql`(쉬움 밴드를 모델 없이 만든 그 판단)을 주관식에 적용한 것. **생성 비용 $0, 환각 불가능.**
2. **대부분의 채점도 모델 없이 끝납니다.** `normalizeAnswer` → `containsNormalized` → `answerParts` → `scriptCompatible`이 이미 있습니다. **잘하는 학습자는 한 푼도 안 냅니다.**
3. **퀴즈 러너와 지갑을 그대로 탑니다.** 주관식 입력창, 견적→제스처→`maxPriceMicro`→reserve→settle, `reserve_ai_quiz`/`settle_ai_quiz` 전부 존재.
   → `quiz_sets`에 `goal_id uuid NULL` 한 칸 추가하면 끝. 새 plpgsql 과금쌍(~250줄) 불필요.
4. **P0를 우회합니다.** "오늘 배운 카드"를 `daily_plan_items`가 아니라 `study_logs`에서 뽑으면 **어느 화면에서 공부했든** 동작합니다.
5. **무료 티어에 처음으로 의미가 생깁니다.** 지금 10유닛으로는 10문항 MCQ 세트(20유닛)를 **끝낼 수가 없습니다.** 여기선 하루치 의식이 완결됩니다.

**모델이 하는 것 / 절대 못 하는 것**

| 모델이 산출 | 모델이 손대면 안 되는 것 |
|---|---|
| `SHORT_ANSWER_VERDICTS` 중 하나 | 정답 (모델 호출 **전에** `resolveQuizAnswerFaces`가 결정) |
| `SHORT_ANSWER_GAPS` 중 하나 | 점수 (밴드 중앙값으로 서버가 유도) |
| `QuizSpan` 문자 범위 | 어떤 카드를 검사할지 |
| — | 학습자에게 보이는 **문장** (verdict별 수작업 번역 8개국어) |

**가격**: 생성 0µUSD(구조적) · 채점 `grade_short` 2유닛=10,000µUSD, 정확히 맞힌 건 미전달 처리로 **환불**.
**노력**: M. **킬 기준**: 3주 뒤 완료율 40% 미만이면 하루 8장이 너무 많은 것.

> ⚠️ 자라게 두면 안 되는 것: 생성 단계, 난이도 밴드, 스트릭. **8장, 입력창 하나, 건너뛰기 가능, `오늘 끝!`을 막지 않을 것.**

---

### 2. 왜 틀렸을까 — 리메디에이션 부활

#1이 만든 "학습자가 쓴 답"이 있으면 `compare`가 드디어 성립합니다(양쪽 근거가 다 있어야만 동작하도록 이미 설계돼 있음).
**서버는 다 돼 있습니다.** 화면과 i18n만 다시 붙이면 됩니다.

가격은 퀴즈와 다릅니다 — **실비 청구**(마크업 1.0). 노력 S.
**전제**: "위치가 문제였지 기능이 문제가 아니었다"가 참이어야 합니다. 그건 오너만 압니다(§6-4).

---

### 3. 돌아왔어요 / Comeback Triage — 무료, 모델 없음, 하루면 됨

10일 만에 열었을 때 `복습이 214장 밀렸어요` 대신:

> `10일 쉬셨네요. 밀린 214장을 한 번에 하지 않아도 됩니다.`
> `5일에 걸쳐 따라잡기 (하루 43장)` / `가장 급한 것부터 60장` / `새 카드는 잠깐 멈추기`

숫자는 전부 `projectWorkload`/`cadence.ts`가 이미 계산합니다.
**학습자가 이탈하는 바로 그 화면**이고, 지금은 밀린 양과 "예상보다 더 걸립니다"를 동시에 보여줍니다.
가장 불안한 순간에 가격표를 붙이지 않는다 — `mig 200`의 판단을 플랜에 적용한 것.

---

### 4. 오답 유형 — 이미 산 걸 버리고 있음

> `이번 주 오답 8건 중 6건이 "뜻은 맞지만 표기가 틀림"이었어요`

채점기는 이미 `SHORT_ANSWER_GAPS` 닫힌 enum으로 실패 유형을 분류해 돌려줍니다. **그 분류에 돈을 내고 버리고 있습니다.**
**신규 모델 호출 0회.** 모든 문자열이 enum 라벨이라 번역 이슈도 없음.
**단, #1과 같이 내야 합니다** — 지금 `answer_attempts`는 사실상 비어 있어서 단독 출시하면 빈 카드입니다.

---

### 5. 주간 플랜 코치 — 비어 있던 seam 채우기

> `이번 주 제안 — 새 카드를 하루 20장 → 12장`
> `지난 7일 중 4일은 계획의 절반도 못 끝냈어요`  [적용] [그대로 둘게요]

지금 모든 설정은 write-once입니다. **모바일에는 목표 수정 UI 자체가 없습니다.**

**모델은 닫힌 레버 하나만 고릅니다**: `lower_intake | raise_intake | catch_up_week | add_study_day | shorten_session | hold`
숫자는 서버가 `workload.ts`로 유도(기존 CHECK 범위로 클램프), 문장은 레버별 수작업 번역, `learning_goals`에 직접 쓰지 않고 **추천 행만** 쓰고 학습자의 `적용`이 반영.

**무료** — 왜 뒤처졌는지 듣는 데 돈을 받는 건 사업이 아닙니다.
레버 정의는 `quiz_difficulty_levels`(mig 197→202) 패턴 그대로 **테이블 행**으로. 튜닝이 배포가 아니라 UPDATE가 됩니다.
**P0에 하드 블록.** 적용률 20% 미만이면 진단이 틀린 것이니 킬.

---

### 6·7. 약점 지도 / 문장 만들기

- **약점 지도**: `cards.tags`는 초기 스키마부터 있는데 태그별 성적 집계가 없습니다. `_quiz_eligible_cards`가 `scope_kind='tags'`를 이미 지원 → "이 주제만 학습"과 주제별 퀴즈가 같은 호출.
  **코드 쓰기 전에 쿼리부터**: 학습자가 실제로 보는 덱의 태그 커버리지가 0이면 빈 섹션으로 출시됩니다.
- **문장 만들기**: 플랜이 예산만 잡아두고 후보가 0인 `produce 15%`를 실제로 채우는 유일한 기능. 천장이 제일 높고 빌드도 제일 큽니다. #1이 자리잡은 뒤에.

---

## 4. 만들지 말 것

| 아이디어 | 왜 안 되는가 |
|---|---|
| **AI 학습 인사이트 대시보드** | 캘 데이터가 없습니다. `daily_plans` 4행. 빈 화면 + 모델 비용 |
| **AI 자동 채점으로 SRS 간격 조정** | 채점기가 커리큘럼을 소유하게 됩니다. `evaluate`가 의도적으로 미구현인 이유와 동일 |
| **모델이 쓴 산문을 그대로 노출** | 8개 로케일 규율이 깨집니다. 퀴즈가 닫힌 enum + 수작업 번역을 고수한 이유 |
| **학습 플랜 안에 또 다른 난이도 밴드** | 퀴즈에 이미 있습니다. #1이 밴드를 갖는 순간 "확인"이 아니라 두 번째 퀴즈가 됩니다 |
| **AI 카드 자동 생성으로 플랜 채우기** | 이미 `kind:'cards'`로 존재. 플랜의 문제는 카드 부족이 아니라 **측정 부재** |

---

## 5. 지금부터 기록할 것 — 나중엔 못 채웁니다

모델 필요 없음. 지금 안 넣으면 소급 불가.

| # | 신호 | 어디에 | 왜 지금 |
|---|---|---|---|
| 1 | **학습자가 타이핑한 답** | `answer_attempts.response.text` | #1이 첫 writer. 이후 전부가 여기 막힘 |
| 2 | **예측 회상확률 vs 실제 결과** | 이미 반쯤 있음 — `daily_plan_items.payload.recall_probability` 기록 중, `answer_attempts.plan_item_id`로 연결됨. **JOIN 하나인데 아무도 계산 안 함** | 개인화 FSRS의 유일한 경로. 지금 `stabilityFromInterval()`은 문자 그대로 항등함수 |
| 3 | **카드별 lapse 횟수** | 새 컬럼 | FSRS 난이도항이 불가능. `study_logs`는 언젠가 정리됨 |
| 4 | **뒤집기까지 시간 ≠ 평가까지 시간** | `study-store`에 타임스탬프 1개 | 지금 둘이 합쳐져 있어 랭킹 가중치 10%가 "정직함 고민 시간"을 재는 중 |
| 5 | **학습자 로컬 시각/IANA 존** | `study_logs`, `study_sessions`, `study_streaks` | 스트릭이 서버 `CURRENT_DATE` 기준 → KST 학습자는 날짜 경계가 어긋남 |
| 6 | **세션 시작(종료 말고)** | 세션 열 때 행 생성 | 지금은 완료된 세션만 남아서 **"이 학습자는 18장쯤에서 그만둔다"가 구조적으로 안 보임** |
| 7 | **채점기 verdict/gaps enum** | `answer_attempts.evaluator_result` | 이게 저장돼야 #4가 공짜 |
| 8 | **이미 쓰고 있는데 안 읽는 것** | 스키마 변경 0 | `daily_plan_items.status='skipped'` + `reason_code`, `study_rating_events.status='undone'`, `study_sessions.ratings`, `answer_attempts.hints_used` — 전부 writer는 있고 reader가 없음 |

---

## 6. 오너가 결정할 것

1. **Gemini 결제 — 블로킹.** 무료 티어 **하루 20요청 전체 합계**. 위 기능 전부가 학습자당 하루 1회 AI 호출을 전제합니다. **billing 켜기 전에는 테스트 계정 하나 이상으로 출시 불가.** 코드 쓰기 전에 이것부터.
2. **채점된 확인이 SRS를 움직여야 하나?** 제 권장은 **아니오**(mig 187의 명제, mig 193이 이미 퀴즈 시도를 제외). 다만 그러면 같은 카드를 하루에 두 번 보게 되니 "중복 작업"이 아니라 "의도적 강화"로 읽히게 만들어야 합니다.
3. **AI 지갑을 하나로? 여러 개로?** 퀴즈 지갑을 같이 쓰면 plpgsql 250줄이 굳지만, 지갑 UI의 "퀴즈 유닛"을 "AI 유닛"으로 바꿔야 하고(8개 로케일) 플랜 확인이 퀴즈 무료분을 먹습니다. **저는 공용+이름변경 쪽입니다.**
4. **리메디에이션은 왜 뗐나?** #2 전체가 "위치가 문제였지 기능이 아니었다"에 걸려 있습니다. 텔레메트리가 없어서 오너만 압니다.
5. **학습 플랜은 별도 제품인가, 앱의 기본 학습 경로인가?** 기본이라면 P0는 버그픽스가 아니라 로드맵입니다 — `/decks/:id/study`가 목표의 존재를 알아야 하고 대시보드 due 수가 플랜의 수여야 합니다.
6. **`temperature` 먼저 고칠까?** 명세는 `grade: 0`인데 `providerRequest`는 0.8 하드코딩. 주간 퀴즈면 참을 만하지만 **매일 하는 채점 의식이면 안 됩니다.**
7. **모델이 쓴 산문의 8개국어 규칙?** #2의 설명이 이 계획 전체에서 유일한 열린 산문입니다. 지금까지 지켜온 규율을 실제로 완화할 것인지.

---

## 부록 — 근거 파일

- `packages/shared/learning/adapters/domain-adapters.ts` — `recall`/`self_rate` 단일 활동, 양 어댑터 `.6/.25/.15` 배합
- `packages/shared/learning/application/daily-planner.ts` — 하드코딩 가중치, argmax
- `packages/shared/stores/learning-store.ts:1419` — `recordAttempt`(비테스트 호출자 0), `:1640-1680` 추천 프로듀서 seam
- `packages/shared/stores/study-store.ts:415, 1000-1009` — `config.planSelection` 게이트 (P0)
- `supabase/migrations/187_plan_study_rating.sql:141` — 응답이 `{self_rated, srs_rating}` 뿐
- `supabase/functions/_shared/ai-remediation.ts` — 잠자는 기능, `compare` 근거 규율, `evaluate` 미구현 사유
- `supabase/migrations/168_ai_remediation_metering.sql` — 실비 과금(마크업 1.0)
- `supabase/migrations/174_study_recommendation_writers.sql` — `provider` 컬럼
- `supabase/migrations/194_quiz_metering.sql` — 닫힌 가격표, `grade_mcq` 의도적 부재
- `supabase/migrations/200_quiz_easy_band_without_ai.sql` — 모델 없이 만드는 판단
- `supabase/migrations/197~203` — 튜닝 파라미터를 행으로 두는 패턴
- `packages/shared/lib/quiz-answer-field.ts` — 정답 필드 해석
