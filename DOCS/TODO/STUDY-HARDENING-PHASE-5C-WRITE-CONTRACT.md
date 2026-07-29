# Study Hardening Phase 5C — Contract: Remove Legacy Write Paths

상태: DESIGN — implementation pending

기준선: `origin/develop@223c418` (P5A migration 160 + P5B client cutover merged)

## 1. 목적

P5B 이후 정상 학습 경로는 `apply_study_rating` / `finalize_study_session` / `undo_study_rating`만
사용한다. 그런데 DB 권한은 여전히 P5A 이전 상태라, 클라이언트가 **RPC를 우회해** SRS/log/session/cursor를
직접 쓸 수 있다. revision·event·집계 무결성이 권한으로 강제되지 않으면 P5A/P5B의 보장은 규약일 뿐이다.

P5C는 3-PR 패턴(expand → cutover → contract)의 contract 단계로, 우회 경로를 실제로 닫는다.

프로덕션 migration은 실행하지 않는다. local reset/integration 및 CI까지만 검증한다.

## 2. 닫을 우회 경로

| 경로 | 현재 | P5C 이후 |
|---|---|---|
| `cards` SRS 6 컬럼 직접 UPDATE | authenticated 가능 | column-level로 차단 |
| `user_card_progress` SRS 6 컬럼 직접 UPDATE | authenticated 가능 | column-level로 차단 |
| `study_logs` INSERT/UPDATE/DELETE | authenticated 가능 | 차단 (SELECT만) |
| `insert_study_log` RPC | authenticated EXECUTE | 제거 |
| `study_sessions` INSERT/UPDATE/DELETE | authenticated 가능 | 차단 (SELECT만) |
| `deck_study_state` cursor 3 컬럼 UPDATE | authenticated 가능 | column-level로 차단 |
| `srs_revision` 직접 UPDATE | authenticated 가능 | 차단 |

전체 테이블 UPDATE를 뺏지 않는다. 카드 편집(`field_values`, `tags`, `sort_position`, `template_id`)과
batch size 조정은 계속 필요하므로 **column-level GRANT**로 필요한 컬럼만 남긴다.

## 3. 선행 조건: 남은 두 개의 정당한 직접 write를 RPC로 옮긴다

권한을 먼저 뺏으면 아래 두 기능이 깨진다. 같은 migration에서 대체 경로를 제공한 뒤 축소한다.

### 3.1 cramming metadata (P5B가 남긴 직접 update)

P5B의 `endSession`은 finalize 후 `study_sessions.metadata`를 병합 update한다. `study_sessions`
INSERT/UPDATE를 닫으려면 metadata가 finalize 안으로 들어가야 한다.

`finalize_study_session`에 `p_metadata jsonb DEFAULT NULL`을 추가한다.

- 함수 signature가 바뀌므로 **기존 6-인자 버전을 DROP하고 7-인자 버전을 생성**한다.
  (P5B 클라이언트는 named parameter로 호출하므로 배포 순서상 잠시 6-인자 호출이 남을 수 있다 →
  기존 6-인자 오버로드도 함께 유지해 7-인자 버전에 위임한다. 오버로드 유지가 rolling 배포 안전판이다.)
- `metadata.study_persistence`는 서버가 소유한다. 클라이언트 metadata는 그 위에 병합하되
  `study_persistence` 키는 클라이언트가 덮어쓸 수 없다.
- idempotent 재호출 비교 대상에서 클라이언트 metadata는 제외한다(집계·cursor·payload만 비교).

### 3.2 `resetSRS` (card-store의 SRS 초기화)

`cards` SRS 컬럼 UPDATE를 닫으면 `resetSRS`가 깨진다. 대체 RPC를 추가한다.

```sql
reset_card_srs(p_card_id uuid) RETURNS jsonb
```

- `SECURITY DEFINER SET search_path = public`, `auth.uid()` 필수, PUBLIC/anon revoke.
- 소유 카드는 `cards`, 구독 카드는 호출자의 `user_card_progress` 행을 초기화한다.
- 초기값: `srs_status='new'`, `ease_factor=2.5`, `interval_days=0`, `repetitions=0`,
  `next_review_at=NULL`, `last_reviewed_at=NULL`.
- revision은 **감소시키지 않고** `OLD+1`로 올린다(P5A monotonic 계약 유지).
- 반환값에 `applied_revision`을 담아 클라이언트가 로컬 revision을 맞춘다.
- 해당 카드에 남아 있는 `applied` rating event는 `status='undone'`으로 만들지 않는다.
  reset은 undo가 아니라 새 상태 전이이므로, 이후 `undo_study_rating`은 revision 불일치로
  `PT409`가 되어 fail-closed된다(설계된 동작).

## 4. Migration 161 구성

1. `finalize_study_session(uuid,uuid,text,timestamptz,jsonb,jsonb,jsonb)` 생성 + 6-인자 오버로드 유지.
2. `reset_card_srs(uuid)` 생성.
3. `DROP FUNCTION insert_study_log(...)` (모든 시그니처).
4. 권한 축소:
   - `REVOKE UPDATE ON public.cards FROM authenticated;`
     `GRANT UPDATE (field_values, tags, sort_position, template_id, updated_at) ON public.cards TO authenticated;`
   - `REVOKE UPDATE ON public.user_card_progress FROM authenticated;` (남길 컬럼 없음)
   - `REVOKE INSERT, UPDATE, DELETE ON public.study_logs FROM authenticated;`
   - `REVOKE INSERT, UPDATE, DELETE ON public.study_sessions FROM authenticated;`
   - `REVOKE UPDATE ON public.deck_study_state FROM authenticated;`
     `GRANT UPDATE (new_batch_size, review_batch_size, updated_at) ON public.deck_study_state TO authenticated;`
   - `deck_study_state` INSERT는 유지(세션 부트스트랩).
   - anon은 이미 모든 대상에서 write 불가여야 하며, 명시적으로 다시 REVOKE한다.
5. `ALTER DEFAULT PRIVILEGES`는 건드리지 않는다(migration 103의 신규 테이블 정책 유지).

`service_role`은 운영/복구/edge function 용도로 유지한다. RLS는 그대로다 — 권한은 RLS의 대체가
아니라 상위 게이트다.

## 5. 클라이언트 변경

- `endSession`: metadata를 `finalize_study_session`의 `p_metadata`로 전달하고 직접 update를 제거한다.
- `card-store.resetSRS`: `reset_card_srs` RPC 호출로 교체하고 반환 revision을 반영한다.
- 두 store(shared/web) mirror 동일성을 유지한다.
- DB Row 타입: P5A에서 rolling 호환용으로 optional로 둔 필드 중
  `cards.srs_revision`, `user_card_progress.srs_revision`은 서버가 항상 채우므로 유지하되,
  타입 축소는 별도 PR로 미룬다(런타임 계약 변화가 없어 이 PR의 위험만 키운다).

## 6. TDD 및 검증

`tests/integration/study-persistence-contract.spec.ts` (신규, real DB):

1. authenticated가 `cards` SRS 컬럼을 직접 UPDATE하면 거부되고 값이 그대로다.
2. authenticated가 `cards.field_values`/`tags`는 여전히 UPDATE할 수 있다.
3. authenticated가 `user_card_progress` SRS 컬럼을 직접 UPDATE하면 거부된다.
4. authenticated가 `study_logs`에 INSERT/UPDATE/DELETE할 수 없고 SELECT는 된다.
5. `insert_study_log`가 존재하지 않는다.
6. authenticated가 `study_sessions`에 INSERT/UPDATE할 수 없다.
7. authenticated가 `deck_study_state` cursor 컬럼을 UPDATE할 수 없고 batch size는 가능하다.
8. `apply_study_rating` → `finalize_study_session(p_metadata)`가 여전히 동작하고 metadata가
   `study_persistence`를 보존한 채 병합된다.
9. 클라이언트 metadata가 `study_persistence`를 덮어쓰지 못한다.
10. finalize 재호출이 metadata 유무와 무관하게 idempotent하다.
11. `reset_card_srs`가 소유 카드를 초기화하고 revision을 증가시킨다.
12. `reset_card_srs`가 구독 카드의 progress 행만 초기화하고 publisher 카드를 건드리지 않는다.
13. `reset_card_srs`가 타인 카드에 대해 `42501`이다.
14. reset 이후 이전 event의 `undo_study_rating`은 `PT409`로 fail-closed된다.
15. 기존 `study-persistence.spec.ts` 17건이 전부 통과한다(회귀).

추가 검증: fresh reset 2회, marketplace integration, catalog 권한 assertion(컬럼 단위 포함),
web/mobile typecheck, targeted lint, 학습 회귀 tests, production build.

## 7. Rollback

`supabase/rollbacks/161_study_write_contract_down.sql`을 제공한다. 권한을 되돌리고
`insert_study_log`를 복구하며 신규 함수를 제거한다. 단, 권한 복구는 보안 완화이므로
운영에서는 forward fix를 원칙으로 한다.

## 8. 완료 조건

- 설계 commit이 migration/code보다 선행
- migration 161 + rollback + 클라이언트 cutover
- local fresh reset 2회, contract/persistence/marketplace integration Green
- catalog 권한 assertion Green
- typecheck/lint/학습 회귀/build Green
- 독립 review 승인(서비스 throttle 시 자체 3단계 감사로 대체하고 그 사실을 기록)
- PR 최종 CI 7 checks green, develop merge, 문서 DONE 이동, worktree 정리
- 프로덕션 배포·migration 실행 없음
