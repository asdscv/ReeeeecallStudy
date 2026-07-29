# Study Hardening Phase 5B — Client Cutover to Atomic Persistence

상태: DESIGN — implementation pending

기준선: `origin/develop@44c804f` (P5A migration 160 merged)

## 1. 목적

P5A가 `apply_study_rating` / `finalize_study_session` / `undo_study_rating`를 도입했지만 client는 여전히
독립 fire-and-forget write 3종을 쓴다.

현재 경로(`packages/shared/stores/study-store.ts`, web mirror 동일):

- SRS: `cards.update(...)` 또는 `user_card_progress.upsert(...)`
- log: `rpc('insert_study_log', ...)`
- session: `study_sessions.insert(...)`
- cursor: `deck_study_state.update(...)` (endSession에서 별도 write)

문제:
1. SRS/log가 별도 statement라 부분 성공이 가능하다.
2. 재시도·중복 호출이 log 중복과 revision 덮어쓰기를 만든다.
3. session insert와 cursor update가 분리되어 한쪽만 반영될 수 있다.
4. client 집계(cards_studied/ratings/duration)를 서버가 그대로 신뢰한다.

P5B는 client를 새 RPC로 전환해 이 4개를 한 transaction 계약으로 옮긴다. 스키마 변경은 없다.

## 2. 상태 모델 추가

`StudyStore`에 persistence 식별자를 추가한다.

- `clientSessionId: string | null` — `startSession`에서 UUID 1회 생성. session 재시작 시 새 UUID.
- `lastRatedCard.ratingEventId: string | null` — rating 1건당 client 생성 UUID.
- `pendingRevision`는 별도 보관하지 않는다. expected revision은 카드 상태에서 읽는다.
  - `srs_source='embedded'`: `card.srs_revision ?? 0`
  - `srs_source='progress_table'`: 로드한 progress row의 `srs_revision ?? 0`
  - queue 카드에는 SRS 적용 결과와 함께 `srs_revision`을 서버 반환값(`applied_revision`)으로 갱신한다.

UUID 생성은 플랫폼 독립 helper `newPersistenceId()`를 shared에 둔다.
`globalThis.crypto.randomUUID`가 있으면 사용하고, 없으면 RFC4122 v4 형태의 fallback을 사용한다
(React Native Hermes 환경 대비).

## 3. rateCard 저장 계약

기존 3개 write를 단일 호출로 대체한다.

```ts
supabase.rpc('apply_study_rating', {
  p_event_id: ratingEventId,
  p_client_session_id: clientSessionId,
  p_card_id: card.id,
  p_deck_id: config.deckId,
  p_study_mode: config.mode,
  p_rating: rating,
  p_srs_source: srsSource,          // 'embedded' | 'progress_table' | 'none'
  p_expected_revision: expectedRevision,  // SRS 모드만, 그 외 null
  p_new_srs: newSrsPayload,               // SRS 모드만, allowlist 6 field
  p_review_duration_ms: durationMs,
})
```

- 비-SRS 모드는 `p_srs_source='none'`, revision/new_srs를 `null`로 보낸다.
- `p_new_srs`는 `srs_status,ease_factor,interval_days,repetitions,next_review_at,last_reviewed_at`만 담는다.
- optimistic UI는 그대로 유지한다. 저장 실패가 UI를 되돌리지는 않지만 오류는 반드시 보고한다.
- 응답의 `applied_revision`으로 queue 카드 `srs_revision`을 갱신해 다음 rating의 expected revision을 유지한다.
- `PT409`(stale revision)는 재시도로 덮어쓰지 않는다. 다른 기기/탭이 이미 쓴 상태이므로 사용자에게 sync 필요를 알린다.

## 4. endSession 저장 계약

`study_sessions.insert` + `deck_study_state.update`를 하나로 대체한다.

```ts
supabase.rpc('finalize_study_session', {
  p_client_session_id: clientSessionId,
  p_deck_id: config.deckId,
  p_study_mode: config.mode,
  p_started_at: new Date(sessionStartedAt).toISOString(),
  p_cursor_before: cursorBefore,   // sequential 계열만
  p_cursor_after: cursorAfter,     // sequential 계열만
})
```

- `sequential`: `{ sequential_pos }`
- `sequential_review`: `{ new_start_pos, review_start_pos }`
- 그 외 모드: 양쪽 `null`
- cursor before는 session 시작 시점 `studyState` 값, after는 기존
  `computeSequentialPosition` / `computeSequentialReviewPositions` 결과를 그대로 쓴다.
- 서버가 집계를 계산하므로 client 집계는 UI 표시에만 사용한다.
- `cardsStudied === 0`이면 호출하지 않는다(기존 동작 유지).
- cramming metadata는 P5A `finalize_study_session`이 받지 않는다. 이번 단계에서는
  cramming metadata를 잃지 않기 위해 finalize 성공 후 `study_sessions.metadata`를
  client session UUID로 한정해 병합 update한다. RPC의 `study_persistence` 키는 보존한다.

## 5. undo 계약

P5B에서는 client의 in-memory undo를 유지하되, persisted rating이 있으면 서버 undo를 함께 호출한다.

```ts
supabase.rpc('undo_study_rating', { p_event_id: lastRatedCard.ratingEventId })
```

- `undoLastRating`은 현재 동기 함수다. 서버 호출은 fire-and-forget으로 붙이고 오류만 보고한다.
- `55000`(non-latest)와 `P0002`는 이미 서버가 정합성을 지킨 상태이므로 UI 복원은 유지한다.
- 완전한 persisted undo 정합화(재시도/queue)는 P6 범위다.

## 6. 실패 정책

- Supabase는 reject 대신 `{ error }`를 준다. 모든 호출에서 `error`를 검사한다.
- 오류 코드별 처리:
  - `PT409`: stale — 사용자에게 재동기화 필요 알림, 로컬 재시도 금지
  - `22023`: payload 결함 — 개발 오류로 로깅, 재시도 금지
  - `23505`: 동일 event id 재사용 — 이미 저장됨으로 취급
  - `55000`: 종료된 session에 추가 rating — 새 session 필요
  - `42501`: 권한 — 로그인/공유 상태 확인 필요
- 저장 실패 시 session을 계속 진행하되 `persistenceError` 상태를 store에 노출한다.

## 7. TDD 범위

`packages/web/src/stores/__tests__/study-store-rpc-cutover.test.ts` (신규)

Red로 먼저 실패시킬 계약:
1. SRS rating이 `apply_study_rating` 1회만 호출하고 `cards.update`/`insert_study_log`를 호출하지 않는다.
2. 동일 rating 재호출 시 event id가 달라지고, 같은 카드 연속 rating의 expected revision이 서버 반환값으로 증가한다.
3. 비-SRS 모드가 `srs_source='none'`, revision/new_srs `null`로 호출한다.
4. subscribed deck은 `srs_source='progress_table'`로 호출하고 progress revision을 쓴다.
5. `endSession`이 `finalize_study_session`을 호출하고 `study_sessions.insert`/`deck_study_state.update`를 호출하지 않는다.
6. sequential/sequential_review는 cursor before/after를 보내고, 다른 모드는 null을 보낸다.
7. cramming은 finalize 후 metadata 병합을 수행한다.
8. `undoLastRating`이 persisted event id로 `undo_study_rating`을 호출한다.
9. `PT409` 응답 시 `persistenceError`가 설정되고 재시도하지 않는다.

기존 회귀:
- guardrails, cramming rounds, SRS timestamp, sequential cursor, sequential review store tests가
  새 RPC mock으로도 통과해야 한다.

## 8. Rollback

client-only 변경이므로 이 PR revert만으로 기존 write 경로로 복귀한다. migration 160은 additive로 남는다.

## 9. 완료 조건

- 설계 commit이 구현보다 선행
- shared/web store byte parity 유지
- Red → Green TDD 증거 기록
- web/mobile typecheck, targeted lint, 학습 회귀 tests, production build 통과
- 독립 review 승인
- PR 최종 CI 7 checks green, develop merge, 문서 DONE 이동, worktree 정리
- 프로덕션 배포·migration 실행 없음
