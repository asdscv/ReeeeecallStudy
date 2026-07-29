# 카드 학습 무결성·스케줄링 하드닝 — Master Plan

작성일: 2026-07-29  
기준선: `origin/develop@af38ad8`  
상태: **ACTIVE — 순차 PR 실행 중**  
표준: `DOCS/STANDARD/ARCHITECTURE.md`

## 1. 목표와 완료 조건

카드 학습 모드 `srs`, `sequential_review`, `random`, `sequential`, `by_date`,
`cramming`의 감사에서 확인된 논리·무결성 결함을 독립 PR로 폐쇄한다.

완료 조건:

1. 잘못된 mode/rating/batch/time/filter가 store 경계에서 거부된다.
2. pagination 중간 오류가 partial success로 소비되지 않는다.
3. 기존 덱의 누락된 `learning_steps`가 `[1, 10]`으로 동작한다.
4. cramming은 한 round당 unique card를 한 번만 평가하고 missed set만 다음 round로 이동한다.
5. SRS learning 재출제는 카드 수가 아니라 `next_review_at`으로 eligibility를 결정한다.
6. 순차 모드는 duplicate `sort_position`과 재정렬 후에도 카드를 영구 누락하지 않는다.
7. rating event, SRS state, study log는 서버 트랜잭션에서 원자적·멱등하게 저장된다.
8. undo는 DB SRS/log/session 상태까지 보상하며 stale undo를 거부한다.
9. study session 저장은 client session UUID로 멱등하고 cursor update와 원자적이다.
10. 웹과 모바일은 하나의 shared 학습 구현을 사용한다.
11. 최신 `develop`에서 unit/integration/typecheck/build/smoke/net-zero/dry-run이 통과한다.

프로덕션 배포와 원격 migration 적용은 범위 밖이다. PR merge까지만 수행한다.

## 2. 공통 실행 규칙

- 각 페이즈는 최신 `origin/develop`에서 만든 독립 branch/worktree 하나를 사용한다.
- 코드 전에 `DOCS/TODO/STUDY-HARDENING-PHASE-*.md`를 설계 커밋한다.
- Red test → 구현 → targeted test → strict typecheck/build → 부수효과 감사를 수행한다.
- 완료 시 phase 문서를 `DOCS/DONE/STUDY-HARDENING/`으로 이동하고 실행 증거를 기록한다.
- 경로를 명시해 stage하며 `git add .`/`-A`, amend, force push를 사용하지 않는다.
- PR은 `develop` 대상으로 만들고 CI 확인 후 merge한다. 다음 페이즈는 merge된 최신 develop에서 시작한다.
- 기존 전체 lint/shared standalone tsc 부채는 baseline과 비교하되 새 오류는 허용하지 않는다.
- DB 함수는 `SECURITY DEFINER SET search_path = public`, `auth.uid()` 검증,
  `REVOKE ... FROM PUBLIC, anon`, authenticated explicit grant를 필수로 한다.

## 3. 페이즈/PR 지도

| Phase | Branch 권장명 | 핵심 범위 | Schema |
|---|---|---|---|
| P0 | `docs/study-learning-hardening-plan` | master plan | 없음 |
| P1 | `fix/study-guardrails` | 입력 검증, fail-closed pagination, fallback, mobile progress | 없음 |
| P2 | `fix/cramming-true-rounds` | true round mastery | 없음 |
| P3 | `fix/srs-due-queue` | timestamp-based learning eligibility | 없음 |
| P4 | `fix/sequential-cursor-safety` | tie-safe batch + cyclic starvation prevention | 없음 |
| P5A | `feat/study-rating-rpc-expand` | additive event/revision/session schema + RPC | migration 160 |
| P5B | `feat/study-rating-rpc-cutover` | client rating을 새 RPC로 전환 | 없음 |
| P5C | `chore/study-rating-rpc-contract` | legacy log write 경로 제거·권한 축소 | migration 161 |
| P6 | `feat/study-persistent-undo` | persistent undo + idempotent finalize/cursor | P5A RPC 사용 |
| P7 | `refactor/study-shared-source` | web local 구현을 shared re-export로 축소 | 없음 |
| P8 | `test/study-hardening-lockdown` | 통합 smoke/net-zero/dry-run, master doc DONE | 필요 시 test-only |

P5A/P5B/P5C는 expand → cutover/backfill → contract 3-PR 패턴이다. P5A merge 후에도
기존 클라이언트가 동작하며, P5C는 P5B가 develop에 안정적으로 머지된 뒤에만 수행한다.

## 4. P1 — Guardrails

### 설계

- `packages/shared/lib/study-validation.ts`
  - `isStudyMode`, `normalizeStudyConfig`, `normalizeRatingForMode`
  - mode별 허용 rating: SRS=`again|hard|good|easy`, cramming=`got_it|missed`
    (`known|unknown`은 명시적으로 변환), 단순 모드=`known|unknown|next|viewed`
  - finite batch, valid local date range, finite non-negative time, filter payload 검증
- `rateCard`는 `phase==='studying'`, `isFlipped`, valid normalized rating을 확인한다.
- `fetchAllRows`를 shared 순수 helper로 추출하고 어느 페이지든 오류면 throw한다.
- `getSteps`는 missing/empty일 때 `DEFAULT_SRS_SETTINGS.learning_steps`를 복사해 반환한다.
- 모바일 cramming 진행률은 attempts/unique가 아니라 `masteryPercentage()`를 사용하고 0..100으로 clamp한다.

### Tests

- invalid mode/rating/NaN/negative/filter/date
- page 2 failure throws and partial rows are not returned
- legacy settings Good → learning 10분 step
- cramming repeated attempts progress <=100
- 기존 학습 test 전체

### Rollback

코드-only revert. DB 데이터 변화 없음.

## 5. P2 — True Cramming Rounds

### Invariants

- 한 round의 시작 queue에는 unique unmastered card만 존재한다.
- 각 카드는 한 round에 정확히 한 번 평가된다.
- `missed`는 current round queue에 삽입하지 않고 next-round set에 기록한다.
- round 종료 시 missed set이 비었으면 complete, 아니면 round++ 후 새 queue를 만든다.
- `masteredInRound`는 최초 `got_it` round이며 단조 증가하지 않는다.
- time limit은 평가 전/후 모두 complete 조건으로 유지한다.

### Tests

- `a got_it, b missed` 후 round 2 queue=`[b]`
- b가 round 2에서 missed면 round 3
- snapshot/restore가 current round와 missed set을 보존
- shuffle은 round별 대상 set만 섞음
- attempts, mastery, hardest cards, remaining/total 통계
- web/mobile progress 0..100

### Rollback

manager 코드와 테스트 revert. SRS/DB에는 영향 없음.

## 6. P3 — Timestamp-based SRS Learning Queue

### 정책 결정

세션은 미래 due card를 조기 표시하거나 10분 동안 강제로 붙잡지 않는다. queue는:

1. 초기 due 카드와 new/review를 즉시 eligible로 둔다.
2. learning 결과의 `next_review_at`을 delayed min-order queue에 넣는다.
3. 매 `currentCard()`/`isComplete()`에서 `dueAt <= clock()`만 eligible로 승격한다.
4. 즉시 eligible 카드가 없고 delayed 카드만 미래라면 현재 세션을 정상 완료한다.
5. 사용자는 `next_review_at` 이후 다음 SRS 세션에서 해당 카드를 받는다.

이 정책은 표시된 1/10분을 지키면서 세션 대기를 강제하지 않는다. 고정 `REQUEUE_GAP`과
`MAX_REQUEUE_PER_CARD`는 제거한다. manager는 test용 clock injection을 지원한다.

### Tests

- 10분 결과는 9:59에 미노출, 10:00에 노출
- 1-card는 세션이 끝나도 next session due data가 유지됨
- due learning이 review/new보다 우선
- snapshot/restore delayed queue 보존
- fake clock/DST와 무관한 absolute timestamp 비교

### Rollback

queue manager revert. 저장된 `next_review_at` 형식은 기존과 동일하다.

## 7. P4 — Sequential Cursor Safety

DB schema를 즉시 바꾸지 않고 두 불변조건으로 영구 누락을 제거한다.

1. **Tie-safe batch:** batch 경계가 `sort_position` 동률 group을 자르지 않는다.
   요청 크기를 넘더라도 마지막 position과 같은 카드는 모두 포함한다.
2. **Cyclic starvation prevention:** 현재 cursor 이후 대상이 없지만 이전 위치에 eligible 카드가
   있으면 stable `(sort_position,id)` 순서로 wrap한다. new cursor도 한 번의 wrap을 허용하되
   같은 session에서 ID 중복은 제거한다.

정렬 comparator는 항상 `(sort_position ASC, id ASC)`로 결정적이다. reorder/insert로 cursor
앞에 이동한 카드는 다음 wrap에서 반드시 선택된다.

### Tests

- duplicate position이 batch boundary에 있어도 모두 포함
- cursor 앞에 삽입/재정렬된 new/review card가 wrap에서 회수
- wrapped queue에 duplicate ID 없음
- empty/suspended/all-consumed/max position edge

### Rollback

builder/helper revert. DB cursor 값은 기존 integer라 호환된다.

## 8. P5A — Persistence Expand (migration 160)

### Additive schema

- `cards.srs_revision BIGINT NOT NULL DEFAULT 0`
- `user_card_progress.srs_revision BIGINT NOT NULL DEFAULT 0`
- `study_logs.rating_event_id UUID NULL`
- `study_sessions.client_session_id UUID NULL`
- `study_rating_events`
  - `id UUID PRIMARY KEY` (client event id)
  - `user_id`, `session_id`, `card_id`, `deck_id`, `study_mode`, `rating`, `srs_source`
  - `expected_revision`, `applied_revision`
  - `previous_srs JSONB`, `new_srs JSONB`
  - `review_duration_ms`, `status applied|undone`, timestamps
  - unique `(user_id,id)`, indexes on `(user_id,session_id)` and `(user_id,card_id,created_at)`
- unique partial/index:
  - `study_logs.rating_event_id` when non-null
  - `study_sessions(user_id,client_session_id)` when non-null

RLS: `study_rating_events`는 SELECT own만 허용하고 직접 INSERT/UPDATE/DELETE 정책은 두지 않는다.

### Revision compatibility

BEFORE UPDATE trigger는 SRS 필드가 변하고 caller가 revision을 명시적으로 증가시키지 않은
구버전 direct write일 때 revision을 `OLD+1`로 올린다. 새 RPC는 lock 후 정확히 `OLD+1`을
명시한다. migration 자체는 기존 row를 rewrite하지 않는다(default 0).

### RPCs introduced but not yet required by clients

- `apply_study_rating(...) RETURNS JSONB`
  - auth/card/deck/mode/rating/source 검증
  - event ID insert로 concurrent retry serialize
  - SRS mode이면 target row `FOR UPDATE`, expected revision 검증, state update
  - event + `study_logs` insert를 같은 transaction에서 commit
  - duplicate event는 저장된 결과 반환, undone event는 재적용하지 않음
- `finalize_study_session(...) RETURNS JSONB`
  - client session UUID 기준 upsert
  - applied events로 cards/ratings/duration 집계
  - cursor before/after 검증 및 `deck_study_state` update와 session upsert 원자화
- `undo_study_rating(p_event_id UUID) RETURNS JSONB`
  - latest applied event 및 current revision 확인
  - previous SRS 복원하되 revision은 다시 +1
  - 연결 log 삭제, event status=undone
  - finalized session이 있으면 aggregate/cursor를 안전하게 reopen/restore

세 함수는 session UUID 기반 advisory transaction lock을 같은 lock order로 사용해
finalize/undo race를 직렬화한다.

### Security/integration tests

- anon execute denied, cross-user/card-deck mismatch denied
- owned/progress source atomic apply
- duplicate concurrent event exactly one log/revision increment
- stale revision: no event/log/state partial write (net-zero)
- invalid payload: net-zero
- apply then undo: previous state restored, revision monotonic, log removed
- duplicate undo idempotent
- finalize retry exactly one session row
- finalize/undo race invariant

### Rollback

`supabase/rollbacks/160_study_rating_rpc_expand_down.sql` 제공. P5B 이전에만 안전하게 실행한다.

## 9. P5B — Client Cutover

- session 시작 시 `crypto.randomUUID()` 호환 helper로 session UUID 생성.
- 매 rating에 event UUID를 생성하고 `apply_study_rating`을 **await**한다.
- RPC 성공 전 queue/currentIndex/stats를 진행하지 않는다.
- transient 응답 불명 시 같은 event UUID로 retry할 수 있다.
- stale revision이면 session을 fail-closed하고 카드/progress를 refetch한다.
- Supabase `{error}`는 throw 가능한 domain error로 변환한다.
- local card에 returned revision/new state를 반영한다.
- non-SRS 모드도 log event를 RPC 하나로 기록한다.
- legacy 직접 update + `insert_study_log` Promise.all 경로를 제거한다.

### Tests

- RPC pending 동안 두 번째 rating 차단
- RPC error 시 manager/index/stats 불변
- retry same event id
- stale revision reload path
- owned/progress payload parity
- cramming/non-SRS log-only path

### Rollback

P5A RPC가 additive이므로 client PR만 revert하면 기존 경로로 복귀한다.

## 10. P5C — Persistence Contract (migration 161)

P5B merge 후 수행:

- legacy `insert_study_log` execute를 authenticated에서 revoke하고 함수 drop 또는 internal-only 처리
- direct `study_logs` INSERT policy 제거; SELECT own/admin만 유지
- 새 함수 grants와 anon denial을 재검증
- nullable historical rows는 유지하며 새 event-linked row에 대한 invariant constraint/index를 강화
- dead client helper/타입 제거

구버전 앱 호환이 필요한 기간이 확인되면 함수 drop 대신 revoke 시점을 문서화하되, 이 작업에서는
web/mobile 동시 shared client가 develop에 있으므로 contract를 적용한다.

## 11. P6 — Persistent Undo & Session Idempotency Cutover

- `LastRatedCard`에 event ID/applied revision을 저장한다.
- `undoLastRating`을 async로 바꾸고 `undo_study_rating` 성공 후에만 local snapshot을 restore한다.
- undo pending/error 동안 UI 중복 동작을 차단한다.
- 완료 화면 undo는 동일 client session을 reopen하며 기존 session row를 중복 생성하지 않는다.
- `endSession`은 `finalize_study_session`만 호출한다.
- session aggregate는 서버 applied event에서 계산하고 client count를 신뢰하지 않는다.
- sequential cursor before/after가 session finalize와 같은 transaction에서 저장된다.

### Tests

- apply→finalize→undo→re-rate→finalize: session row 1개, log 1개, 올바른 SRS
- finalize/undo reordered network completion
- stale undo conflict는 local restore 금지
- duplicate finalize/undo retry
- zero-applied-event session 미생성

## 12. P7 — Shared Single Source

- shared `StudyState`, config/stats/last-rating 타입을 export한다.
- web-only pause 상태는 실제 호출처가 없으므로 제거한다.
- web local files는 삭제하거나 import compatibility re-export만 남긴다:
  - `srs`, `study-queue`, `cramming-queue`, `study-session-utils`, `srs-access`
  - `stores/study-store`
- 웹 product code는 `@reeeeecall/shared/...`를 직접 import한다.
- 웹 Vitest는 shared implementation을 mock/test하며 mobile typecheck도 같은 source를 소비한다.
- parity guard는 local 파일에 구현 코드가 다시 생기면 실패한다.

### Tests

- shared store unit tests
- web adapter smoke
- import architecture guard
- web/mobile typecheck
- 기존 6-mode suites

## 13. P8 — Lockdown

최신 develop 통합 worktree에서 수행:

1. 학습 targeted Vitest 전체
2. full web Vitest (기존 baseline 실패와 신규 실패 구분)
3. web `tsc -b --noEmit`, mobile `tsc --noEmit`
4. 핵심 ESLint + 전체 lint baseline 비교
5. web production build
6. local Supabase fresh reset 2회(migration idempotency)
7. study integration tests
8. study smoke SQL:
   - valid owned/progress apply
   - finalize
   - undo/re-rate
9. **net-zero assertions:** invalid/stale/cross-user rating 후 card/progress/event/log/session count 불변
10. **dry-run assertions:** read-only preview/validation 경로가 DB fingerprint를 변경하지 않음
11. git diff/status와 migration/schema drift 확인

Master 문서의 모든 checkbox와 PR/commit/test evidence를 채운 뒤
`DOCS/DONE/STUDY-HARDENING/2026-07-29-study-learning-integrity-hardening.md`로 이동한다.

## 14. 위험과 대응

| 위험 | 대응 |
|---|---|
| old/new client 동시 SRS write | revision trigger + P5A/P5B/P5C 순차 merge |
| RPC response loss 후 중복 평가 | client event UUID PK idempotency |
| 오래된 event undo가 최신 상태 덮음 | latest-event + revision check, monotonic revision |
| finalize/undo deadlock | 동일 advisory session lock, 고정 row lock order |
| future learning card 조기 표시 | absolute due eligibility, injected clock tests |
| tie group이 매우 커 batch 초과 | 누락 방지를 우선; overflow count를 테스트/문서화 |
| web/shared mock 경로 변화 | P7 parity guard + product import smoke |
| migration test 환경 부재 | Docker/Supabase 확인 후 없으면 postgres-15 assertion path 병행 |

## 15. 진행 체크리스트

- [x] P0 master design 작성
- [ ] P1 guardrails
- [ ] P2 cramming true rounds
- [ ] P3 SRS due queue
- [ ] P4 sequential safety
- [ ] P5A persistence expand
- [ ] P5B rating cutover
- [ ] P5C persistence contract
- [ ] P6 persistent undo/session idempotency
- [ ] P7 shared single source
- [ ] P8 lockdown + master doc DONE
