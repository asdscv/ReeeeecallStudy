# Study Hardening Phase 6 — Persistent Undo & Session Idempotency

상태: DESIGN — implementation pending

기준선: `origin/develop@51a4259` (P5A/P5B/P5C merged)

## 1. 남은 문제

P5B가 undo를 `persistenceChain` 뒤에 큐잉하고 revision을 반영하게 했지만, `undoLastRating`은
여전히 **동기 함수**다. 그래서:

1. **서버 undo 실패가 UI에 반영되지 않는다.** 로컬은 이미 복원됐고 서버는 그대로여서 화면과 DB가
   갈린다. 사용자가 그 카드를 다시 평가하면 revision이 맞아 성공하므로 조용히 두 번 기록된다.
2. **undo 진행 중 중복 조작을 막지 못한다.** undo 버튼 연타, undo 직후 rating, undo 직후
   session 종료가 서로 끼어들 수 있다.
3. **완료 화면 undo가 새 session row를 만든다.** P5B는 `sessionSaved`를 false로 되돌려
   `endSession`을 다시 호출한다. 서버 finalize는 `(user, client_session_id)`로 idempotent하므로
   두 번째 호출은 **첫 결과를 그대로 반환**한다 — 즉 undo 후 재평가한 결과가 session에 반영되지 않는다.
   서버는 undo 시 metadata를 `reopened`로 바꾸지만 클라이언트는 재-finalize 경로가 없다.

## 2. 상태 모델

`StudyState`에 추가한다.

- `undoState: 'idle' | 'pending'` — 서버 undo 진행 여부.
- `undoLastRating: () => Promise<void>` (동기 → async 전환)

`LastRatedCard`는 그대로 사용한다(P5B에서 `ratingEventId` 추가됨).

## 3. undo 계약

```
undoLastRating():
  1. 가드: lastRatedCard 없음 / phase가 studying·completed 아님 / isRating / undoState==='pending' → no-op
  2. undoState='pending'
  3. persisted event가 있으면 persistenceChain 뒤에 undo_study_rating을 큐잉하고 결과를 await
     - 실패: persistenceError(scope='undo') 설정, 로컬 복원 없음, undoState='idle', 반환
     - 성공: applied_revision을 로컬 카드에 반영
  4. 로컬 snapshot 복원(queue/manager/stats/index/phase)
  5. 완료 화면에서 undo한 경우 sessionSaved=false로 되돌린다
  6. undoState='idle'
```

핵심 변경은 **성공 후에만 로컬 복원**이다. 실패 시 화면을 그대로 두면 사용자에게는 undo가
"안 된" 것으로 보이고 이는 서버 상태와 일치한다. `55000`(non-latest)·`P0002`(없는 event)도
동일하게 복원하지 않는다 — 서버가 이미 그 undo를 거부했으므로 UI가 앞서 나가면 안 된다.

이미 `undone` 상태인 event 재요청은 서버가 성공으로 응답하므로(idempotent) 복원한다.

## 4. session re-finalize 계약

undo가 finalized session을 reopen하면 클라이언트도 다시 finalize해야 한다. 그러나 서버
finalize는 같은 `client_session_id`로는 첫 결과를 반환하므로 재-finalize가 의미 없다.

결정: **undo가 finalized session을 reopen하면 새 `client_session_id`를 발급하지 않는다.**
대신 이후 rating은 같은 session key로 계속 쌓이고, 재완료 시 `endSession`은 finalize가
이미 존재함을 확인한 뒤 **서버 집계 갱신을 요청하지 않는다**. 대신 서버가 undo 시점에
aggregate를 재계산해 두므로, 새 rating이 추가되면 그 rating은 event로 남지만 session row의
집계에는 반영되지 않는다 — 이것은 실제 정합성 결함이다.

따라서 P6은 서버에 **재집계 RPC**를 추가한다(migration 162):

```sql
refresh_study_session(p_client_session_id uuid) RETURNS jsonb
```

- 호출자 own session만.
- 해당 session의 `applied` event로 `cards_studied`/`total_cards`/`total_duration_ms`/`ratings`를
  다시 계산한다.
- `metadata.study_persistence.status`를 `finalized`로 되돌린다.
- cursor는 건드리지 않는다(cursor 계약은 finalize/undo가 소유).
- `SECURITY DEFINER SET search_path = public`, anon revoke, authenticated grant.

`endSession`은 다음과 같이 분기한다.

- session row 없음 → `finalize_study_session` (기존 경로)
- session row 있음(reopened 포함) → `refresh_study_session`

`sessionSaved` 가드는 유지하되, undo가 완료 화면에서 일어난 경우에만 해제한다(P5B와 동일).

## 5. 호출처 변경

- `packages/web/src/pages/StudySessionPage.tsx`: `undoLastRating()` → `void undoLastRating()`,
  `undoState === 'pending'` 동안 버튼 비활성화.
- `packages/mobile/src/hooks/useStudy.ts`: async 위임 + `undoState` 노출.
- `packages/mobile/src/screens/StudySessionScreen.tsx`: pending 동안 undo 차단.

## 6. TDD

`packages/web/src/stores/__tests__/study-store-persistent-undo.test.ts` (신규)

1. 서버 undo 성공 후에만 queue/stats/phase가 복원된다.
2. 서버 undo 실패(`55000`)면 로컬 복원이 일어나지 않고 `persistenceError.scope==='undo'`가 설정된다.
3. undo 진행 중 두 번째 `undoLastRating`은 no-op이다(RPC 1회).
4. undo 진행 중 `rateCard`는 no-op이다.
5. 이미 undone인 event의 재요청은 성공으로 취급해 복원한다.
6. 완료 화면 undo 후 재평가 → `endSession`이 `refresh_study_session`을 호출하고
   `finalize_study_session`을 다시 호출하지 않는다.
7. 첫 완료는 여전히 `finalize_study_session`을 호출한다.
8. applied event가 0인 session은 finalize/refresh를 호출하지 않는다.

integration `tests/integration/study-session-refresh.spec.ts` (신규, real DB)

9. finalize → undo → 재평가 → refresh: session row 1개, 집계가 재평가 결과와 일치, status `finalized`.
10. refresh는 cursor를 바꾸지 않는다.
11. 타인 session refresh는 `P0002`(조회 불가)로 거부된다.
12. anon은 refresh를 실행할 수 없다.

## 7. Rollback

`supabase/rollbacks/162_study_session_refresh_down.sql`로 함수를 제거한다. 클라이언트 변경은
PR revert로 되돌린다.

## 8. 완료 조건

- 설계 commit 선행
- migration 162 + rollback + 클라이언트 async undo + 호출처 3곳
- Red → Green, store/integration/회귀/typecheck/lint/build Green
- fresh reset 2회
- 독립 review(throttle 시 자체 3단계 감사로 대체하고 기록)
- PR 최종 CI 7 checks green, develop merge, 문서 DONE 이동, worktree 정리
- 프로덕션 배포·migration 실행 없음
