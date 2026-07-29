# Study Hardening Phase 5A — Atomic Persistence Expand

상태: DONE — PR #336 merged path, 최종 CI 7 checks green

## 1. 목적

현재 client의 SRS row update와 `insert_study_log`가 독립 fire-and-forget write라 부분 성공, 중복 log, stale overwrite가 가능하다. P5A는 client를 아직 전환하지 않고 migration 160에서 revision/event/session 기반의 additive persistence contract와 RPC 3개를 도입한다. 기존 client는 계속 동작해야 한다.

프로덕션 migration은 실행하지 않는다. local reset/integration 및 CI까지만 검증한다.

## 2. Additive schema

- `cards.srs_revision bigint NOT NULL DEFAULT 0`
- `user_card_progress.srs_revision bigint NOT NULL DEFAULT 0`
- `study_logs.rating_event_id uuid NULL`
- `study_sessions.client_session_id uuid NULL`
- partial unique indexes:
  - `study_logs(rating_event_id) WHERE rating_event_id IS NOT NULL`
  - `study_sessions(user_id,client_session_id) WHERE client_session_id IS NOT NULL`
- `study_rating_events`
  - `id uuid PRIMARY KEY` — client event id, globally unique
  - `user_id uuid NOT NULL`, `session_id uuid NOT NULL`, `session_sequence bigint NOT NULL`, `card_id`, `deck_id`
  - session advisory lock 아래에서 `session_sequence=max+1`, unique `(user_id,session_id,session_sequence)`
  - `study_mode`, `rating`, `srs_source` (`embedded|progress_table|none`)
  - `expected_revision`, `applied_revision`
  - `previous_srs jsonb`, `new_srs jsonb`
  - `review_duration_ms`, `status` (`applied|undone`)
  - `created_at`, `updated_at`, `undone_at`
  - indexes `(user_id,session_id)` 및 `(user_id,card_id,created_at DESC)`

`study_rating_events`는 RLS SELECT-own만 허용한다. direct INSERT/UPDATE/DELETE policy와 table grant는 두지 않는다. 모든 write는 RPC만 통한다.

기존 row는 default 0을 metadata-only 방식으로 읽으며 명시적 backfill UPDATE를 하지 않는다.

## 3. Revision compatibility trigger

`bump_srs_revision()` BEFORE UPDATE trigger를 `cards`, `user_card_progress`에 설치한다.

SRS fields(`srs_status,ease_factor,interval_days,repetitions,next_review_at,last_reviewed_at`) 중 하나가 바뀌고 `NEW.srs_revision <= OLD.srs_revision`이면 `OLD+1`로 올린다. 새 RPC가 정확히 `OLD+1`을 설정하면 그대로 둔다. SRS 외 field update는 revision을 바꾸지 않는다. 이를 통해 P5A/P5B 공존 기간의 legacy direct update도 stale detection에 참여한다.

## 4. RPC contract

모든 함수는 `SECURITY DEFINER SET search_path = public`, `auth.uid()` 필수, PUBLIC/anon revoke, authenticated grant다. service_role은 운영·integration 용도로 grant한다. session advisory lock을 가장 먼저 획득하고 이후 target SRS row lock 순서를 유지한다.

### 4.1 `apply_study_rating`

```sql
apply_study_rating(
  p_event_id uuid,
  p_client_session_id uuid,
  p_card_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_rating text,
  p_srs_source text,
  p_expected_revision bigint DEFAULT NULL,
  p_new_srs jsonb DEFAULT NULL,
  p_review_duration_ms integer DEFAULT NULL
) RETURNS jsonb
```

1. auth/session/event UUID, mode/rating/source/duration 조합을 검증한다.
2. `pg_advisory_xact_lock(hashtextextended(session_id::text, 160))`.
3. card-deck 관계와 caller access를 검증한다.
4. 동일 event가 있으면 caller와 immutable payload가 모두 같은지 확인한다. 같고 `applied`면 저장된 결과를 반환하고 `undone`면 재적용하지 않고 `status=undone`을 반환한다. payload mismatch/cross-user collision은 23505 성격의 domain error다.
5. SRS mode는 source가 `embedded|progress_table`, expected revision과 완전한 `new_srs`가 필수다. target row를 `FOR UPDATE`하고 current revision 일치 후 old state를 JSON으로 캡처, `OLD+1`로 update한다.
6. non-SRS mode는 source=`none`, revision/new_srs가 NULL이어야 하며 SRS row를 쓰지 않는다.
7. event와 `study_logs`를 같은 transaction에 insert한다. exception은 event/state/log 모두 rollback한다.
8. 반환값은 event/status/applied_revision/previous_srs/new_srs를 포함한다.

`new_srs`는 allowlist 6개 field만 허용하고 status/range/timestamp type을 검증한다. SQL cast error도 transaction 전체 rollback이다.

### 4.2 `finalize_study_session`

```sql
finalize_study_session(
  p_client_session_id uuid,
  p_deck_id uuid,
  p_study_mode text,
  p_started_at timestamptz,
  p_cursor_before jsonb DEFAULT NULL,
  p_cursor_after jsonb DEFAULT NULL
) RETURNS jsonb
```

- 동일 session advisory lock.
- 기존 `(user_id,client_session_id)` session row가 있으면 payload metadata 일치 확인 후 그대로 반환한다.
- 해당 session의 `applied` events만으로 action count, distinct cards, duration, ratings JSON을 집계한다. client aggregate를 신뢰하지 않는다.
- event deck/mode 일관성을 검증한다.
- sequential mode만 cursor payload를 허용한다. `cursor_before`가 현재 `deck_study_state`와 정확히 일치할 때만 `cursor_after`로 update한다. srs/random/by_date/cramming은 cursor payload NULL이어야 한다.
- `study_sessions` insert와 cursor update는 한 transaction이다.
- `metadata.study_persistence`에 cursor before/after와 `status=finalized`를 저장한다. 기존 cramming metadata 공간과 충돌하지 않는다.

Cursor JSON allowlist:
- sequential: `{"sequential_pos": n}`
- sequential_review: `{"new_start_pos": n, "review_start_pos": n}`

### 4.3 `undo_study_rating`

```sql
undo_study_rating(p_event_id uuid) RETURNS jsonb
```

- event를 caller own으로 조회하고 session advisory lock 후 `FOR UPDATE` 재조회한다.
- 이미 undone이면 저장 상태를 반환한다.
- 같은 session의 latest applied event만 undo 가능하다.
- SRS event는 target row lock 후 current revision이 event `applied_revision`과 같아야 한다. `previous_srs`를 복원하되 revision은 current+1로 증가시킨다.
- linked `study_logs` 삭제, event `status=undone`, `undone_at` 설정을 원자적으로 수행한다.
- finalized session이 있으면 남은 applied events로 aggregate를 다시 계산하고 `metadata.study_persistence.status=reopened`로 바꾼다. cursor가 있었다면 현재 cursor가 stored `cursor_after`와 일치할 때만 `cursor_before`로 복원한다. 불일치는 fail-closed rollback이다.

## 5. Error/net-zero 정책

- auth/access: `42501`
- invalid payload/source/mode/rating: `22023`
- event payload collision: `23505`
- stale revision/cursor: `PT409` (PostgREST HTTP 409 custom SQLSTATE)
  - 설계 시 `40001`을 계획했으나 local PostgREST가 serialization failure로 재시도한 뒤 60초에 연결을 종료해 structured error를 반환하지 않았다. `PT409`는 즉시 conflict를 반환하면서 동일 transaction rollback/net-zero 의미를 유지한다.
- missing card/event/state: `P0002`
- non-latest undo: `55000`

모든 실패 테스트는 target revision/state, event count, log count, session/cursor가 호출 전과 동일함을 확인한다.

## 6. TDD 및 integration

`tests/integration/study-persistence.spec.ts`를 local Supabase 환경변수 기반으로 추가한다.

- anon execute denied
- cross-user 및 card/deck mismatch denied
- embedded apply: state/event/log 한 transaction
- progress_table apply parity
- same event sequential/concurrent retry: log 1, revision +1
- same ID payload mismatch rejected
- stale revision/invalid payload net-zero
- non-SRS log-only path가 cards/progress를 쓰지 않음
- apply→undo restore + monotonic revision + log removal
- duplicate undo idempotent, non-latest undo denied
- finalize retry session row 1, server aggregate 정확
- stale cursor finalize net-zero
- finalize→undo session reopen/cursor restore
- legacy direct SRS update trigger +1, non-SRS update no bump

Static migration checks는 함수 search_path/grant/RLS/index/down-script 존재를 확인한다.

### 실행 증거 (2026-07-29/30)

- Design-first commit: `7708354 docs(study): design phase 5a persistence expand`
- Red (migration 160 전 real DB): 1 file, **8 failed / 1 passed**. `PGRST202` missing RPC와 missing revision/table contract를 재현했다.
- Green (최종 fresh DB): `tests/integration/study-persistence.spec.ts` **17/17**.
  - embedded/progress-table atomic apply+undo, concurrent duplicate, event collision
  - malformed/missing/null/fractional/timestamp payload의 `22023` net-zero
  - stale revision/cursor `PT409`, non-latest undo, finalized-session late apply 차단
  - sequential/non-sequential finalize retry, server aggregate, cursor restore, inaccessible deck denial
  - anon EXECUTE denial, RPC-only ledger writes, SELECT-own RLS, legacy revision trigger
- 기존 marketplace real-DB regression: `marketplace-acquire.spec.ts` **6/6**.
- Migration safety: 최종 migration chain `supabase db reset --no-seed` 연속 2회 성공.
- Rollback: down SQL을 local DB에 실제 적용하고 3 RPC/table/4 additive columns 제거 assertion **8/8**, 이후 fresh reset 및 persistence **17/17** 재통과.
- Applied-catalog security assertions **20/20**: `SECURITY DEFINER`, `search_path=public`, anon revoke/authenticated grant, SELECT-only RLS, direct DML denial, indexes/columns/triggers.
- Types/static: web `tsc -b --noEmit`, mobile `tsc --noEmit`, root-config targeted ESLint, shared/web DB type byte parity 통과.
- Production build: 3,238 modules, **3.23s** 성공(기존 chunk-size warning만 존재).
- 독립 SQL/security review: **APPROVED**, Blocker/High/Medium 없음. 발견된 Low `SQL NULL` vs JSON `null` non-sequential retry를 즉시 수정하고 regression test를 추가했다.
- 프로덕션 migration/deploy는 실행하지 않았다.
- 구현 commit: `54cb6da feat(study): add atomic rating persistence RPCs`
- PR: https://github.com/asdscv/ReeeeecallStudy/pull/336
- 원격 CI: 첫 실행의 Integration (Supabase)는 `db reset` 컨테이너 재시작 직후 upstream `Error status 502`로 실패했다(migration 160까지 적용 완료, test 미시작). 실패 job만 rerun한 뒤 Lint + Typecheck, Unit Tests, Integration (Supabase), Architecture Guard, Migration Safety, AI Credit Metering, Workers Builds **7 checks 전부 SUCCESS**.

### 구현 중 추가 hardening

- transaction 시작시각 `now()`가 advisory lock 획득 순서와 다를 수 있으므로 durable `session_sequence`로 latest undo를 결정한다.
- finalized/reopened session UUID에는 duplicate event retry만 허용하고 새 event를 `55000`으로 차단해 server aggregate가 stale해지지 않게 한다.
- finalize는 owned/active-shared deck access를 검증한다.
- Supabase CLI 2.107 fresh DB의 누락된 service-role defaults를 touched/regression-read tables의 explicit SELECT grant로 보정했다.
- DB Row types의 새 필드는 P5A rolling-client expand compatibility를 위해 optional로 노출하고, P5B에서 client cutover 후 required contract로 좁힌다.

## 7. Rollback

`supabase/rollbacks/160_study_rating_rpc_expand_down.sql`을 제공한다. P5B client cutover 전에만 안전하다. 함수/trigger/table/index/columns를 역순 제거한다. historical event-linked data가 생긴 뒤에는 down 실행 대신 forward fix가 원칙이다.

## 8. 완료 조건

- design commit이 migration/code보다 선행
- migration 160 + rollback + generated DB types
- local fresh reset 및 focused integration/security/net-zero Green
- existing integration, migration safety, typecheck/lint/build Green
- 독립 SQL/security review 승인
- PR 최종 CI 7개 Green, develop merge, DONE 이동, cleanup
