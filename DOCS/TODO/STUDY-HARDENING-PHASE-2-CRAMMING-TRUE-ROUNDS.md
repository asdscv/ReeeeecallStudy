# Study Hardening P2 — Cramming True Rounds

작성일: 2026-07-29  
기준선: `origin/develop@e3d6c5f`  
브랜치: `fix/cramming-true-rounds`  
상태: ACTIVE

## 문제

현재 `CrammingQueueManager`는 `missed` card를 같은 round queue 뒤에 다시 삽입한다.
마지막 미숙달 card는 평가할 때마다 queue tail을 새로 만들기 때문에 current round가 끝나지 않으며,
`_advanceRound()`와 실제 round 2가 정상 무제한 세션에서 사실상 도달 불가능하다. 그 결과
round metadata와 UI의 round 의미가 구현 동작과 일치하지 않는다.

## 목표

1. 한 round에서 각 unique card를 정확히 한 번 평가한다.
2. `missed`는 current queue에 재삽입하지 않고 next-round set에 기록한다.
3. current round 종료 시 missed set만 다음 round queue가 된다.
4. round 2와 round 3이 실제 정상 흐름에서 도달 가능해야 한다.
5. snapshot/restore, mastery, attempts, hardest cards, time limit, shuffle 의미를 보존한다.
6. cramming은 SRS 상태를 변경하지 않는다.

## 비목표

- study log/session persistence 원자화(P5)
- persistent undo(P6)
- web/shared single-source 통합(P7)
- cramming filter 정책 변경
- UI copy 또는 SRS scheduling 변경

## 상태 모델

Manager는 다음 상태를 가진다.

- `allCardIds`: 입력 순서를 유지한 unique card ID 전체 집합
- `queue`: current round에서 아직/이미 평가될 unique 대상의 고정 배열
- `cursor`: current round의 다음 평가 위치
- `round`: 1부터 시작하는 현재 round 번호
- `nextRoundMissed`: current round에서 `missed`를 받은 ID의 insertion-ordered `Set`
- `roundUniqueTotal`: current round 시작 시 queue 길이
- `cardStates`: session 전체 attempts/miss/mastery 누적 상태

입력 ID 중복은 최초 출현만 유지해 round당 unique 평가 불변조건을 방어한다.

## 상태 전이

### `got_it`

1. 현재 card의 `totalAttempts`를 증가시킨다.
2. `lastRating='got_it'`으로 기록한다.
3. `masteredInRound`가 `null`이면 현재 round를 최초 mastery round로 기록한다.
4. cursor를 한 칸 이동한다.

### `missed`

1. 현재 card의 `totalAttempts`와 `missedCount`를 증가시킨다.
2. `lastRating='missed'`로 기록한다.
3. card ID를 `nextRoundMissed`에 추가한다.
4. current queue는 변경하지 않고 cursor만 한 칸 이동한다.

### round 종료

cursor가 queue 끝에 도달하면:

- time limit이 끝났으면 상태를 더 전이하지 않고 session complete로 둔다.
- `nextRoundMissed`가 비었으면 모든 대상이 mastered이므로 session complete다.
- missed가 있으면 `round++`, missed set만으로 새 queue를 만들고 cursor를 0으로 리셋한다.
- shuffle 설정이면 새 round 대상 배열에만 Fisher-Yates shuffle을 적용한다.
- 새 round 시작 후 `nextRoundMissed`를 빈 set으로 교체한다.

따라서 `a=got_it, b=missed`인 round 1 직후 round 2 queue는 정확히 `[b]`이며,
round 2에서 b가 다시 missed이면 즉시 round 3의 `[b]`가 된다.

## 완료와 시간 제한

- empty input은 즉시 complete이며 기존 `masteryPercentage()===100` 계약을 유지한다.
- `isSessionComplete()`는 all mastered 또는 elapsed time >= limit이다.
- `rateCard()` 진입 시 이미 complete/timed-out이면 attempts, queue, round를 변경하지 않는다.
- 마지막 평가 후 time limit이 끝났다면 새 round를 만들지 않는다.
- `remainingTimeMs()`는 0 아래로 내려가지 않는다.

## 통계 의미

- `remainingInRound()`: current queue에서 cursor 이후 아직 평가하지 않은 unique card 수
- `totalInRound()`: current round 시작 대상 수
- `totalAttempts()`: 모든 round의 rating action 합계
- `masteryPercentage()`: 전체 unique card 중 최초 `got_it`을 받은 비율, 0..100
- `masteredInRound`: 최초 `got_it` round이며 이후 변경하지 않는다.
- `getHardestCards()`: 누적 `missedCount` 내림차순, tie는 deterministic card ID 순
- `currentRound()`: 현재 또는 완료된 마지막 round 번호

## Snapshot / Undo

`CrammingQueueSnapshot`에 `nextRoundMissed`를 포함한다. snapshot은 queue, set, map을 모두
복사해 caller와 manager 사이 mutable alias를 만들지 않는다. restore는 다음을 원자적으로 복원한다.

- queue/cursor/round/roundUniqueTotal
- next-round missed set
- card state map

시간 제한의 `startTime`은 기존처럼 session wall-clock 기준으로 유지하며 undo가 시간을 되감지 않는다.

## Web / Shared Parity

P7 전까지 다음 두 구현을 동일하게 수정한다.

- `packages/shared/lib/cramming-queue.ts`
- `packages/web/src/lib/cramming-queue.ts`

테스트는 현재 제품 web import를 직접 검증하고, 두 파일의 동작 parity를 별도 targeted test로 잠근다.

## TDD

### Red 계약

- round 1 `a got_it, b missed` 직후 `currentRound()===2`, current card=`b`
- round 2 `b missed` 직후 `currentRound()===3`
- 한 round의 card ID는 중복 평가되지 않음
- snapshot/restore가 current round와 pending missed set을 복원
- shuffle은 각 round의 대상 set만 섞고 ID를 추가/유실하지 않음
- duplicate input ID 제거
- timed-out `rateCard()`는 no-op
- attempts, mastery, hardest, remaining/total 통계
- web/shared 동일 scenario parity

### 회귀

- filter all/weak/due_soon/tags
- empty/all mastered/time limit
- store cramming rating/summary/progress 관련 tests
- 전체 study targeted suite
- web/mobile typecheck, production build, targeted lint, `git diff --check`

## 보안·데이터 영향

코드-only 변경이며 migration, DB schema, RLS, persisted SRS data를 변경하지 않는다.
기존 study log rating은 계속 `got_it|missed`를 사용한다. session metadata의 `rounds` 값만 실제
round 동작과 일치하게 교정된다.

## Rollback

manager와 tests를 함께 revert한다. DB rollback은 필요 없다. 이전 세션 snapshot은 메모리 전용이라
배포 경계를 넘어 호환할 persisted payload가 없다.

## 완료 증거

- [ ] 설계 commit
- [ ] Red 재현
- [ ] manager 구현 green
- [ ] web/shared parity
- [ ] study regression
- [ ] web/mobile typecheck
- [ ] production build
- [ ] targeted lint/diff check
- [ ] PR CI green
- [ ] `DOCS/DONE/STUDY-HARDENING/PHASE-2-CRAMMING-TRUE-ROUNDS.md` 이동
