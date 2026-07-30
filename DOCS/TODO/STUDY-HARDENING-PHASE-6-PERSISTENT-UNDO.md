# Study Hardening Phase 6 — Persistent Undo & Session Idempotency

상태: IMPLEMENTED — review/PR pending

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

결정: **undo가 finalized session을 reopen해도 새 `client_session_id`를 발급하지 않는다.**
세션은 하나이고 row도 하나여야 한다. 대신 서버에 **재집계 RPC**를 추가한다(migration 162).

```sql
refresh_study_session(
  p_client_session_id uuid,
  p_cursor_before jsonb DEFAULT NULL,
  p_cursor_after  jsonb DEFAULT NULL,
  p_metadata      jsonb DEFAULT NULL
) RETURNS jsonb
```

- 호출자 own session만. 남의 session은 없는 session과 동일하게 `P0002`.
- 해당 session의 `applied` event로 `cards_studied`/`total_cards`/`total_duration_ms`/`ratings`를
  다시 계산하고 `metadata.study_persistence.status`를 `finalized`로 되돌린다.
- **applied event가 0이면 row를 DELETE하고 `status='discarded'`를 반환한다.** 모든 평가를
  되돌린 세션은 일어나지 않은 세션이고, row를 남기면 history/analytics에 0장·0분 세션이
  찍힌다. 이 경로는 cursor payload를 무시한다(undo가 이미 cursor를 되돌려 놨다).
- **cursor는 재전진시킨다.** 설계 조사 초기 판단("cursor는 건드리지 않는다")은 틀렸다:
  `undo_study_rating`은 reopen 시 cursor를 그 session의 `cursor_before`로 **되돌린다**.
  refresh가 다시 전진시키지 않으면 sequential·sequential_review 세션의 진도가 조용히
  사라진다. 검증 규칙(payload 형태, `cursor_before` 일치 → 아니면 `PT409`)은
  finalize와 동일하게 둔다.
- client metadata는 `study_persistence` **아래로만** 병합한다(위조 불가). `p_metadata`가
  NULL이면 row에 이미 있던 client key를 유지한다.
- `SECURITY DEFINER SET search_path = public`, anon revoke, authenticated/service_role grant.

### 4-1. apply_study_rating의 reopened 예외 (설계 중 발견한 차단 결함)

`apply_study_rating`은 session row가 존재하면 어떤 평가도 `55000`으로 거부한다
(finalize 이후 도착한 늦은 apply가 집계에서 누락되는 것을 막는 가드). 그래서 **undo 후
재평가 자체가 서버에서 불가능**했고, refresh만 추가해서는 P6가 성립하지 않는다.

migration 162는 이 가드에 예외를 하나 낸다: `metadata.study_persistence.status`가
`reopened`인 session은 apply를 허용한다. `finalized` session은 여전히 거부하고,
refresh가 status를 `finalized`로 되돌리면 다시 잠긴다.

### 4-2. 클라이언트 분기

`sessionFinalized: boolean`을 store에 추가한다(finalize 성공 시에만 true).

- `sessionFinalized === false` → `finalize_study_session` (기존 경로)
- `sessionFinalized === true` → `refresh_study_session`
- undo가 finalized session을 비우면(`previousStats.cardsStudied === 0`) undo가 그 자리에서
  refresh를 호출해 row를 폐기하고 `sessionFinalized`를 false로 되돌린다. 서버 응답이
  `discarded`일 때만 되돌린다 — 평가가 끼어들어 실제로는 refresh된 경우 마커를 유지해야
  row가 계속 refresh로 교정된다.

`sessionSaved` 가드는 유지하되, undo가 완료 화면에서 일어난 경우에만 해제한다(P5B와 동일).

### 4-3. endSession의 늦은 스냅샷 결함

`endSession`은 진입 시점의 `sessionStats`/`queue`로 cursor를 계산하는데, 그 사이
`persistenceChain` 대기 중에 undo가 완료될 수 있다. 그러면 사용자가 되돌린 카드만큼
cursor가 더 전진한다. 체인 drain 이후 stats/queue를 **다시 읽어** 계산하고,
studied가 0이 되었으면 finalize/refresh를 아예 하지 않는다.
또 진행 중 undo가 세션으로 복귀시킨 경우 `endSession`이 `phase='completed'`를 다시
씌우지 않는다(완료 화면으로 튕기는 버그). `exitSession`/`crammingTimeUp`은
`undoState === 'pending'` 동안 no-op이다.

## 5. 호출처 변경

- `packages/web/src/pages/StudySessionPage.tsx`: `undoLastRating()` → `void undoLastRating()`,
  `undoState === 'pending'` 동안 버튼 비활성화.
- `packages/mobile/src/hooks/useStudy.ts`: async 위임 + `undoState` 노출.
- `packages/mobile/src/screens/StudySessionScreen.tsx`: pending 동안 undo 차단.

## 6. TDD

`packages/web/src/stores/__tests__/study-store-persistent-undo.test.ts` (신규, 9 tests)

1. 서버 undo 성공 후에만 queue/stats/phase가 복원된다.
2. 서버 undo 실패(`55000`)면 로컬 복원이 일어나지 않고 `persistenceError.scope==='undo'`가 설정된다.
3. undo 진행 중 두 번째 `undoLastRating`은 no-op이다(RPC 1회).
4. undo 진행 중 `rateCard`는 no-op이다.
5. 이미 undone인 event의 재요청은 성공으로 취급해 복원한다.
6. 2카드 세션에서 완료 화면 undo 후 재평가 → `endSession`이 `refresh_study_session`을
   호출하고 `finalize_study_session`을 다시 호출하지 않는다.
7. 세션의 유일한 평가를 undo하면 그 자리에서 refresh가 호출되어 row가 폐기되고,
   이후 재완료는 다시 `finalize_study_session`을 호출한다.
8. 첫 완료는 여전히 `finalize_study_session`을 호출한다.
9. applied event가 0인 session은 finalize/refresh를 호출하지 않는다.

integration `tests/integration/study-session-refresh.spec.ts` (신규, real DB, 9 tests)

10. finalize → undo → 재평가 → refresh: session row 1개, 집계가 재평가 결과와 일치,
    status `finalized`. 재-finalize는 첫 결과를 그대로 돌려준다(refresh가 필요한 이유).
11. 세션의 모든 평가를 undo한 뒤 refresh하면 row가 사라지고(`discarded`) event ledger는
    남는다. 같은 session id로 재평가·재finalize가 가능하다.
12. sequential: undo가 되돌린 cursor를 refresh가 재전진시키고 metadata의 cursor pair를 갱신한다.
13. stale cursor refresh는 `PT409`이며 cursor·session row 변화가 net-zero다.
14. 비-sequential session에 cursor payload를 주면 `22023`.
15. client analytics는 `study_persistence` 아래로 병합되고 status는 위조되지 않는다.
16. metadata 없이 refresh하면 기존 analytics가 유지된다.
17. 타인 session refresh는 `P0002`(조회 불가)로 거부된다.
18. anon은 refresh를 실행할 수 없다(`42501`).

## 7. Rollback

`supabase/rollbacks/162_study_session_refresh_down.sql`이 두 변경을 함께 되돌린다:
`apply_study_rating`을 160판(session row 존재 시 무조건 거부)으로 복원하고
`refresh_study_session`을 DROP한다. 클라이언트 변경은 PR revert로 되돌린다.
로컬에서 rollback → 재적용을 실제로 실행해 확인했다.

## 8. 완료 조건

- [x] 설계 commit 선행 (`f18083a`)
- [x] migration 162(apply reopened 예외 + refresh) + rollback + 클라이언트 async undo + 호출처 3곳
- [x] store 9 tests Green, integration 43 tests Green(신규 9 포함), study-store 회귀 44 Green
- [x] web `tsc -b` Green, 변경 파일 eslint Green, `vite build` Green, mobile `tsc` Green
- [x] fresh reset 2회 + rollback/재적용 검증
- [ ] 독립 review(throttle 시 자체 3단계 감사로 대체하고 기록)
- [ ] PR 최종 CI 7 checks green, develop merge, 문서 DONE 이동, worktree 정리
- [x] 프로덕션 배포·migration 실행 없음

### 남은 사전 결함(P6 범위 밖, 기록만)

`packages/web` 전체 vitest에 **기존 실패 96개(10 파일)** 가 있다. 이 브랜치의 변경을
stash한 상태에서도 동일하게 96개가 실패하므로 P6와 무관하다:
`useTheme`, `guide-content`, `i18n-key-usage`, `layout-styles`, `study-input-settings`,
`admin-store-official`, `auth-store-official`, `auth-store`, `marketplace-reviews`,
`version-store`. 별도 워크스트림으로 처리한다.
