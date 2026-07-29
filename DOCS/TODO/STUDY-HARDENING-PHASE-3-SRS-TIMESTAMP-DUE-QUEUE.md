# Study Hardening Phase 3 — Timestamp-based SRS Learning Queue

상태: DESIGN — implementation pending

## 1. 목적

SRS가 계산해 저장하는 `next_review_at`과 세션 내 재출제 시점을 동일한 절대 timestamp 계약으로 맞춘다. 현재 `SrsQueueManager`는 learning 결과의 1분/10분 due를 무시하고 카드 3장 뒤에 즉시 재삽입하며, 한 장 세션에서는 아예 재삽입하지 않는다. 이로 인해 UI에 표시되는 학습 간격, 세션 동작, 영속화된 다음 복습 시각이 서로 다르다.

이 phase는 queue/store 코드와 테스트만 변경한다. DB schema, SRS 계산식, `next_review_at` 저장 형식은 변경하지 않는다.

## 2. 범위

### 포함

- `packages/shared/lib/study-queue.ts`와 web mirror의 고정 card-gap 재출제를 timestamp delayed queue로 교체
- test clock injection
- learning 결과의 `next_review_at` 전달을 위한 shared/web store 연결 변경
- delayed queue snapshot/restore
- due learning 우선순위 및 one-card 정상 종료 검증
- shared/web queue와 store parity 유지

### 제외

- SRS 학습 단계 계산식 변경
- DB write 원자화/멱등성 및 persistent undo(P5/P6)
- web mirror 제거(P7)
- 미래 due까지 세션을 열어 두는 timer/polling UI

## 3. 근본 원인

현재 manager는 `REQUEUE_GAP = 3`, `MAX_REQUEUE_PER_CARD = 3`, `shouldRequeue` boolean만 받는다. 따라서 실제 `SrsResult.next_review_at`을 알 수 없고:

1. 10분 learning 카드도 수 초 뒤 조기 노출된다.
2. 다른 카드가 없는 one-card 세션은 learning 카드 재출제를 버린다.
3. 반복 횟수 cap이 학습 단계 timestamp와 무관하게 동작한다.
4. undo snapshot이 실제 due schedule을 표현하지 못한다.

## 4. 정책

- 초기 입력은 이미 현재 세션에 eligible하므로 learning → review → new 순서로 ready queue에 둔다.
- rating 후 결과가 `srs_status === 'learning'`이면 해당 카드와 `next_review_at`을 delayed min-order queue에 넣는다.
- `currentCard()`와 `isComplete()`는 먼저 `dueAt <= clock()` 항목을 승격한다.
- 승격된 learning 카드는 아직 평가하지 않은 review/new보다 앞에 삽입한다.
- ready 카드가 없고 delayed 카드가 모두 미래면 현재 세션은 정상 완료한다. 기다리거나 조기 표시하지 않는다.
- 저장된 `next_review_at`은 그대로 유지되므로 다음 SRS 세션이 due 이후 카드를 다시 로드한다.
- 절대 epoch millisecond만 비교한다. local timezone/DST calendar 연산을 queue에서 수행하지 않는다.
- malformed/non-finite timestamp는 조기 노출하지 않고 fail-closed로 현재 세션에서 제외한다. 정상 `calculateSRS` 결과는 항상 유효 ISO timestamp다.

## 5. 상태 모델과 API

```ts
interface DelayedQueueCard {
  card: QueueCard
  dueAt: number
  sequence: number
}

interface SrsQueueSnapshot {
  queue: QueueCard[]
  cursor: number
  studied: number
  delayedQueue: DelayedQueueCard[]
  nextSequence: number
}
```

- constructor는 optional `clock: () => number`를 받고 기본값은 `Date.now`다.
- `rateCard(result: SrsResult)`는 현재 ready card를 1회 소비하고, learning 결과만 갱신된 SRS state와 함께 delayed queue에 schedule한다.
- delayed queue는 `(dueAt ASC, sequence ASC)`로 정렬해 동일 timestamp에서도 결정적 순서를 보장한다.
- `promoteDueCards()`는 due 항목을 cursor 위치에 삽입하여 남아 있는 review/new보다 먼저 표시한다.
- `remaining()`은 현재 시각에 ready인 카드만 센다. 미래 delayed 카드는 세션이 기다릴 의무가 없으므로 진행률 denominator에 포함하지 않는다.
- `studiedCount()`는 rating action 수를 유지하고 `totalCards()`는 최초 unique 입력 수를 유지한다.
- snapshot/restore는 delayed entries와 sequence를 독립 배열/객체로 복사한다.

Store는 이미 한 번 계산한 `srsResult` 전체를 manager에 전달한다. 이로써 queue schedule과 DB/UI에 적용하는 `next_review_at`이 동일한 값이 된다.

## 6. 불변조건

1. 미래 due delayed card는 ready queue에 존재하지 않는다.
2. `dueAt <= clock()`인 delayed card만 승격된다.
3. 동일 card는 rating 사이에 ready 또는 delayed 중 한 곳에만 존재한다.
4. due learning은 남은 review/new보다 먼저 표시된다.
5. 미래 delayed만 남으면 `isComplete() === true`다.
6. snapshot 후 mutation/restore가 delayed due와 tie order를 정확히 복원한다.
7. store가 완료한 one-card learning rating의 `next_review_at`은 queue state와 DB update payload에 동일하게 남는다.

## 7. TDD 계획

### Red — manager

- 10분 due가 9:59에는 `currentCard() === null`, 10:00에는 다시 노출
- one-card learning 결과는 즉시 세션 complete이며 future delayed를 `remaining()`에 포함하지 않음
- due learning이 waiting review/new보다 우선
- delayed queue의 due order와 same-time stable order
- snapshot/restore가 delayed queue와 sequence를 보존
- absolute timestamp 비교가 timezone offset 표기/DST와 무관
- review 결과는 재출제하지 않음
- malformed due timestamp는 조기 표시하지 않음

기존 fixed-gap/max-requeue/`shouldRequeue` 테스트는 새 timestamp 계약으로 교체한다. 기본 advance, ordering, stats, SRS settings 테스트는 유지한다.

### Red — store integration

- one-card SRS `good`이 10분 learning 결과를 만들면 현재 세션은 완료
- optimistic queue card와 `cards.update` payload 모두 future `next_review_at` 및 learning state 보존
- manager ready queue에는 카드를 조기 재출제하지 않음
- study log rating은 1회 기록

### Green 및 회귀

- shared 구현 후 web mirror를 byte-identical하게 유지
- focused manager/store tests
- SRS/queue/store/cramming/sequential regression을 4~5 files씩 분할 실행
- web/mobile typecheck, targeted ESLint, `git diff --check`, production build
- PR 최종 head의 7 CI checks

## 8. 위험과 대응

- **세션 완료 후 clock이 due에 도달하면 manager가 다시 non-complete가 될 수 있음:** 실제 store는 미래 delayed만 남은 시점에 phase를 completed로 전환하고 manager를 다시 polling하지 않는다. manager 직접 테스트에서는 clock promotion을 검증할 수 있다.
- **통계 denominator 감소:** 미래 항목을 포함하면 완료 화면에서 미학습 잔여처럼 보이므로 현재 세션의 eligible work만 센다. rating action 수는 그대로 누적한다.
- **stale queue card state:** delayed entry에는 `SrsResult`의 ease/interval/repetitions/status를 반영한 새 `QueueCard`를 저장한다.
- **invalid timestamp:** 내부 정상 경로에는 없지만 malformed 값은 즉시 표시하지 않아 spacing 계약을 침해하지 않는다.

## 9. Rollback

queue manager, 두 store 연결부, phase 테스트를 revert한다. schema/data migration이 없고 기존 `next_review_at` 형식도 그대로이므로 data rollback은 필요 없다.

## 10. 완료 조건

- timestamp 경계, one-card, priority, snapshot, invalid timestamp 테스트 Green
- shared/web manager source byte-identical
- focused 및 분할 study regression Green
- web/mobile typecheck, targeted lint, diff check, production build Green
- PR CI 7개 Green 후 `develop` merge
- phase 문서를 `DOCS/DONE/STUDY-HARDENING/PHASE-3-SRS-TIMESTAMP-DUE-QUEUE.md`로 이동하고 master P3 checkbox 갱신
