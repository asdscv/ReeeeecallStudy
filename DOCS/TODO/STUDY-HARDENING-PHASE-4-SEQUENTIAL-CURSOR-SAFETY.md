# Study Hardening Phase 4 — Sequential Cursor Safety

상태: DESIGN — implementation pending

## 1. 목적

`sequential`과 `sequential_review`가 duplicate `sort_position`, insert/reorder, batch 경계에서도 eligible card를 영구 누락하지 않도록 한다. 현재 queue는 `sort_position`만으로 정렬한 뒤 `slice/limit`하고 완료 시 `max(sort_position)+1`을 저장한다. batch 경계에서 같은 position group이 잘리면 잘린 card는 다음 cursor보다 작아져 누락된다. `new_start_pos` 이전으로 삽입/재정렬된 new card도 현재 구현에서는 다시 조회되지 않는다.

DB schema/cursor column 형식은 바꾸지 않고 queue construction을 안전하게 만든다.

## 2. 범위

- shared/web `study-session-utils.ts`에 stable comparator, tie-safe take, cyclic selection, plain sequential builder 추가
- `sequential_review` new/review selection에 tie-safe cyclic selection 적용
- shared/web store의 `sequential` queue를 동일 helper로 구성
- embedded sequential path도 paginated full eligible set을 읽어 duplicate boundary와 wrap을 동일하게 처리
- duplicate/reorder/wrap/suspended/empty/max-position tests

제외: cursor DB schema 변경, `(sort_position,id)` 복합 cursor migration, persistence RPC(P5), shared mirror 제거(P7).

## 3. 불변조건

1. 모든 정렬은 `(sort_position ASC, id ASC)`다.
2. requested batch의 마지막 card와 같은 `sort_position`을 가진 eligible card는 전부 포함한다.
3. cursor 이상 primary segment가 requested size보다 작으면 cursor 미만 segment에서 한 번만 wrap/fill한다.
4. wrap segment도 tie group을 자르지 않아 결과가 requested size를 초과할 수 있다.
5. 한 session queue에서 ID는 중복되지 않는다.
6. suspended card는 어떤 builder 결과에도 포함되지 않는다.
7. cursor 이전의 eligible new/review card는 wrap 시 회수된다.
8. tie group을 전부 소비한 뒤 기존 `max(position)+1` cursor update는 안전하다.

## 4. Helper 설계

```ts
interface SeqCard {
  id: string
  sort_position: number
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
}

compareSequentialCards(a, b)
takeTieSafe(sortedCards, requested)
selectCyclicTieSafe(sortedEligible, cursor, requested)
buildSequentialQueue(allCards, cursor, batchSize)
```

### `takeTieSafe`

- `requested <= 0` 또는 empty면 `[]`
- length가 requested 이하이면 전부 반환
- index `requested - 1`의 `sort_position`을 boundary로 잡고 같은 position의 마지막 card까지 반환

### `selectCyclicTieSafe`

- stable sort와 ID dedupe를 먼저 수행
- `position >= cursor` primary에서 tie-safe requested selection
- primary 결과가 requested 이상이면 종료
- 부족하면 아직 선택하지 않은 `position < cursor` card에서 remaining 수를 tie-safe 선택해 1회 wrap

### `buildSequentialQueue`

- suspended 제외 후 `selectCyclicTieSafe` 호출
- owned/non-owned store path가 같은 결과를 사용

### `buildSequentialReviewQueue`

- new: 모든 new card를 대상으로 `new_start_pos` 기준 cyclic tie-safe selection
- review: learning/review만 대상으로 한다.
- new card가 있고 `new_start_pos > review_start_pos`이면 기존 review window `[review_start_pos,new_start_pos)`를 유지하되 그 window 내부에서 cyclic tie-safe selection한다.
- 그 외에는 전체 reviewable을 `review_start_pos` 기준 cyclic selection한다.
- new/review set은 status상 서로 disjoint이며 helper 내부에서도 ID dedupe한다.

## 5. Store 전략

현재 non-owned path는 이미 `mergedAll` 전체를 보유한다. owned `sequential` path도 `fetchAllRows`로 non-suspended card를 stable ordered pagination해 가져온 뒤 `buildSequentialQueue`를 호출한다. 이는 한 번의 `.limit(batchSize)`로 tie group을 절단하는 오류를 제거하고 owned/non-owned semantics를 일치시킨다.

PostgREST ordering은 `.order('sort_position').order('id')`를 사용하고 helper가 다시 stable sort하므로 page/source ordering에 의존하지 않는다. correctness를 위해 full eligible set을 읽는 비용을 수용한다. pagination safety cap/fail-closed는 P1 `fetchAllRows` 계약을 그대로 사용한다.

## 6. TDD 계획

### Red

- plain sequential: requested 2의 boundary position에 3 cards가 있으면 3 cards 모두 반환
- plain sequential: cursor 이전으로 재정렬된 card를 primary 고갈/부족 시 wrap 회수
- plain sequential: wrap queue에 duplicate ID 없음
- plain sequential: identical position은 ID ASC
- sequential_review new: cursor 이전 inserted/reordered new를 1회 wrap 회수
- sequential_review review: duplicate position boundary group 전부 포함
- suspended, empty, batch 0, cursor > max, `Number.MAX_SAFE_INTEGER`
- store owned/non-owned sequential이 동일 tie-safe queue 생성

### Green/회귀

- focused helper/store tests
- study mode regression을 4~5 files씩 분할
- shared/web helper parity
- web/mobile typecheck, targeted ESLint, diff check, production build
- independent review와 PR final 7 CI checks

## 7. 위험과 대응

- **requested보다 queue가 커짐:** tie group 원자성이 우선이며 UI stats는 실제 queue length를 사용한다.
- **owned large deck full read:** paginated helper와 safety cap으로 fail-closed한다. 향후 복합 cursor schema 도입 시 server-side keyset query로 최적화할 수 있다.
- **duplicate ID input:** 첫 stable occurrence만 유지해 같은 session 중복 평가를 막는다.
- **new wrap의 반복 학습:** cursor 이전인데 여전히 `srs_status='new'`인 card만 대상이므로 실제 미소비/reordered card다. 평가된 card는 status가 바뀌어 new set에서 제외된다.

## 8. Rollback

helper와 두 store queue construction을 revert한다. cursor DB 값과 schema는 변경하지 않으므로 data rollback은 없다.

## 9. 완료 조건

- duplicate boundary/reorder/wrap/ID stability tests Green
- owned/non-owned store integration Green
- shared/web helper byte parity
- 분할 study regression, web/mobile typecheck, lint, diff, build Green
- 독립 review blocker/high/medium 없음
- PR CI 7개 Green 후 merge, DONE 이동, branch/worktree cleanup
