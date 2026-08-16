# 04. 데이터베이스 — 마이그레이션 · RPC · RLS · 성능

> 데이터 접근의 기본 단위는 테이블이 아니라 **`SECURITY DEFINER` RPC** 다.
> 실측(2026-08-16): 고유 함수 290개 중 270개가 DEFINER, 그중 `search_path` 미고정 0개.
> 마이그레이션 233개(최신 240), SQL 어서션 스위트 54개.

## 목차
- [1. 마이그레이션 파일 규약](#1-마이그레이션-파일-규약)
- [2. 함수(RPC) 작성 규약](#2-함수rpc-작성-규약)
- [3. 권한 — GRANT/REVOKE 와 RLS](#3-권한--grantrevoke-와-rls)
- [4. SQL 어서션 스위트](#4-sql-어서션-스위트)
- [5. 성능 규칙](#5-성능-규칙)
- [6. 롤백](#6-롤백)
- [7. 함정](#7-함정)

---

## 1. 마이그레이션 파일 규약

| 규칙 | 게이트 |
|---|---|
| 파일명 `supabase/migrations/NNN_snake_case.sql` — 3자리 제로패딩 연번. **번호 재사용 금지**, 결번은 허용 | CI `migration-safety` (`db reset` 2회, 중복 번호는 duplicate key 로 죽는다) |
| **적용된 마이그레이션은 절대 수정하지 않는다.** 새 번호를 추가한다 | 없음 (사람이 지킨다) |
| 푸시 전 `git fetch origin develop` 후 최고 번호를 **다시** 확인한다 | CI 가 잡지만 재작업이 생긴다 |
| 본문은 `BEGIN;` … `COMMIT;` 한 트랜잭션 | 없음 (191번 이후 49/49 준수) |
| 파일 머리에 **서술형 헤더**: 무엇이 어떻게 깨졌나 · 프로덕션 실측 수치 · 왜 이 형태여야 하나 | 없음 (190번 이후 50/50, 중앙값 30줄) |
| 롤백 `supabase/rollbacks/NNN_name.down.sql` 을 짝으로 만든다 | 없음 (178~239 연속 준수) |
| 계약이 바뀌면 `supabase/tests/<name>_test.sql` 을 만들고 **`ci.yml` 에 등록** | 등록 자체엔 게이트 없음 → §4 |

**서술형 헤더가 규약인 이유**: 이 저장소의 마이그레이션 헤더는 사후분석 리포트다. `236_learner_card_schedule_uses_its_indexes.sql` 은 "왜 SQL 함수가 인라이닝되지 않으면 느려지는가"를 5,988ms/20,743버퍼 vs 4.4ms/32버퍼 실측과 함께 남겼다. **다음 사람이 같은 함정을 피하는 유일한 장치**이므로 길이를 아끼지 않는다.

**새 마이그레이션 템플릿** → `supabase/migrations/238_filler_pool_is_actually_random.sql`
(한국어 서술 헤더 → `BEGIN` → `CREATE OR REPLACE`(DEFINER + search_path) → `auth.uid()` 널 가드 → errcode → REVOKE/GRANT → `COMMIT`)

## 2. 함수(RPC) 작성 규약

```sql
CREATE OR REPLACE FUNCTION public.my_thing(p_deck_id uuid)
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public          -- ★ DEFINER 면 필수
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  ...
END $$;

REVOKE EXECUTE ON FUNCTION public.my_thing(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_thing(uuid) TO authenticated;
COMMENT ON FUNCTION public.my_thing(uuid) IS '계약을 한 문장으로';
```

| 규칙 | 비고 |
|---|---|
| 클라이언트가 부르는 함수는 `SECURITY DEFINER` + `SET search_path = public` | 실측 미고정 0개 |
| **사용자 id 를 인자로 받지 않는다** — `auth.uid()` 로 읽는다 | `my_*` 패턴(mig 232). 신규 함수의 기본형 |
| 불가피하게 `p_user_id` 를 받으면 IDOR 가드 필수 | 필수 인자: `IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN RAISE ...`<br>선택 인자(COALESCE): `IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND ...` |
| 시그니처 변경은 `DROP FUNCTION IF EXISTS public.f(old_sig);` 먼저 | 오버로드가 남으면 PostgREST 가 엉뚱한 쪽을 고른다 |
| 예외는 `RAISE EXCEPTION '<영문>' USING errcode = '<코드>'` | 어휘는 [`../03_SERVER_CONTRACT §3`](../03_SERVER_CONTRACT/README.md#3-에러-어휘--sqlstate--code--http) |
| 의미가 미묘하면 `COMMENT ON FUNCTION` 으로 계약을 남긴다 | 현재 23/232 — 늘려야 할 관행 |
| 동시성 있는 카운터·한도·지갑은 `pg_advisory_xact_lock(<고정키>, hashtext(user))` + `FOR UPDATE` | 실측 25회/16파일 |
| 함수 접두사: `_`=내부 헬퍼(36) · `admin_`=관리자 가드(42) · `get_`/`set_` · `my_`=auth.uid 전용 | `admin_` 42개 중 35개가 `is_admin()`, 나머지 7개는 인라인 `profiles.role='admin'` 검사 |

## 3. 권한 — GRANT/REVOKE 와 RLS

**전제**: mig 103 의 `ALTER DEFAULT PRIVILEGES` 때문에 **새로 만든 테이블은 anon/authenticated 에게 DML GRANT 를 자동으로 받는다.** 그래서 신규 테이블의 실질 보호는 **RLS** 다.

| 대상 | 권한 형태 |
|---|---|
| 사용자용 RPC | `REVOKE ... FROM PUBLIC, anon;` + `GRANT ... TO authenticated;` |
| 내부 헬퍼 | `REVOKE ... FROM PUBLIC, anon, authenticated;` (DEFINER 함수가 여전히 호출한다) |
| 엣지 전용(과금·정산·해제) | `GRANT ... TO service_role;` |
| 계량·과금·정책 테이블 | `ENABLE ROW LEVEL SECURITY` + **정책 0개**(deny-all). 접근은 DEFINER RPC 로만. 필요하면 `REVOKE ALL ON <table> FROM PUBLIC, anon, authenticated;` 도 함께 |
| 사용자 소유 콘텐츠 테이블 | RLS `auth.uid() = user_id` 정책 |

실측: RLS ON 79테이블 중 **22개가 deny-all**(ai_credit_*, ai_pricing_*, ai_free_allowances, quiz_questions, quiz_run_items, tts_usage, system_flags …).

**검증은 권한이 아니라 효과로 한다.** deny-all 테이블도 테이블 GRANT 는 살아 있으므로 `has_table_privilege` 로 "막혔다"를 검사하면 실패한다. **실제로 읽히는지**를 검사한다(`supabase/tests/public_plan_limits_test.sql:110-116`).

**`is_admin()` 은 소비자 78곳의 커널이다** — 라이브 스키마 실측으로 이 함수를 부르는 함수 75개 + RLS 정책 3개(`profiles`·`subscriptions`·`admin_audit_logs`). 고칠 때는 그 사실을 먼저 센다.
(마이그레이션 파일을 grep 하면 194줄이 나오지만 그건 **재정의 히스토리**이지 소비자 수가 아니다.)

## 4. SQL 어서션 스위트

```sql
\set ON_ERROR_STOP on
BEGIN;
-- 고정 UUID 시드
DO $$ BEGIN
  ...
  ASSERT <조건>, 'FAIL: <무엇이 틀렸는지>';
END $$;
RAISE NOTICE '<파일명>: all assertions passed';
ROLLBACK;
```

| 규칙 | 비고 |
|---|---|
| pgTAP 이 아니라 **순수 psql** 을 쓴다 | 실측 54개 중 52개가 `ON_ERROR_STOP`, 49개가 `ROLLBACK` 종결 |
| 파일을 만들었으면 **`.github/workflows/ci.yml` 의 `ai-credit-tests` 잡에 등록**한다 | ★ 글롭이 아니다. 등록 안 하면 영원히 안 돈다 |
| 새 파일은 `ci.yml:383-401` 의 `for f in \` 묶음에 1줄 추가 | 나머지 40개는 개별 step (혼재) |
| 역할 흉내는 **단수형** `set_config('request.jwt.claim.sub', ..., true)` | CI 셰임(`bootstrap-auth.sql`)이 읽는 키가 단수형이다. 복수형 `request.jwt.claims` 만 지우면 여전히 소유자로 인증된 상태 |
| 반드시 `ROLLBACK` 으로 끝낸다 | 한 DB 를 공유해 순차 실행하므로, 남긴 행이 뒤 스위트의 전제를 바꾼다(현재 3개가 위반) |
| 가드가 실제로 동작하는지 **변이 테스트**로 확인한다 | "가드를 지우면 red, 되돌리면 green" 을 커밋 본문에 적는다 |

**테스트를 무의미하게 만드는 4가지 (실제 사례)**
1. **우연히 통과**: 픽스처 카드가 5장뿐이라 `OFFSET 99999` 가 항상 빈 결과 → 어서션이 아무것도 검증하지 않음.
2. **`now()` 가 트랜잭션 내내 고정**이라 타임스탬프가 전부 같아져 경계 검증이 무의미 → `created_at` 을 명시적으로 계단 배치.
3. **STATEMENT 트리거는 0행 삭제에도 발화**하므로, 픽스처를 앞선 삭제 케이스보다 **뒤에** 놓아야 재현된다.
4. `RAISE EXCEPTION 'Unauthorized'` 를 errcode 없이 던지고 테스트가 `EXCEPTION WHEN OTHERS THEN NULL` 로 감싸면 **가드를 지워도 통과**한다 → 결과를 플래그에 담아 블록 밖에서 assert.

## 5. 성능 규칙

이 저장소가 실제로 다친 지점만 적는다.

| 규칙 | 근거 |
|---|---|
| **`WHERE` 절 안에 `CASE` 를 쓰지 않는다.** 플래너가 통짜 불리언으로 보고 어느 가지도 인덱스로 내리지 못한다 | 376,000행 스캔 · 7.6초/호출 (mig 235/236) |
| SQL 언어 함수가 인라이닝되려면 **단일 SELECT · SECURITY DEFINER 아님 · SET 절 없음 · CTE 없음**. 하나라도 어기면 제네릭 플랜 하나로 굳는다 | 22행 반환에 7.8초 → 0.21초 (mig 236) |
| 호출 형태가 여러 개면 plpgsql 로 바꿔 **형태별로 문장을 분리**한다 | mig 236 |
| 인덱스는 마이그레이션 안에서 만들고 `CONCURRENTLY` 는 쓰지 않는다(트랜잭션 안) | 실측 CONCURRENTLY 0회 |
| 표본 랜덤은 `DISTINCT` → 셔플 → `LIMIT` 순서. 바깥에 `ORDER BY random()` 을 두면 **순서만 랜덤**해진다 | 429장 덱에서 오답 보기가 늘 같은 40개 (mig 238) |
| 느린 쿼리를 고쳤으면 헤더에 **before/after 실측치**를 남긴다 | mig 235·236 이 표본 |

## 6. 롤백

- 롤백은 **"직전 상태를 그대로 복원"** 이지 개선이 아니다.
- 파일명은 `NNN_name.down.sql` (레거시 3개만 `_down.sql` — 새로 만들지 않는다).
- **되돌릴 때는 번호 역순이 아니라 의존성 역순**이다. 예: 178 이 168의 12인자 함수를 13인자로 교체했으므로 178 을 168보다 먼저 되돌려야 한다(`scripts/dry-run-learning-migrations.sh:32-47`).
- CI 가 실제로 apply→rollback→잔여물 0→복원을 도는 것은 **7개(165·167·168·169·178·181·182)뿐**이다. 나머지 롤백은 검증되지 않은 채 있다.

## 7. 함정

- **`supabase db push` 를 쓰지 않는다.** 이 저장소는 `NNN_name.sql` 인데 CLI 는 14자리 타임스탬프를 기대해서, 원격 버전을 전부 "로컬에 없음"으로 보고 history repair 를 제안한다 — 실행하면 적용된 것들이 reverted 로 표시된다. 프로덕션 적용은 `scripts/apply-prod-migrations.sh --from N --to M`.
- **중복 번호는 두 CI 잡이 다르게 판정한다.** psql for-루프는 그냥 둘 다 적용하고, `db reset` 은 duplicate key 로 죽는다. 그래서 로컬에서 psql 루프만 재현하면 초록으로 보인다.
- **프로덕션 스키마 버전은 git 에 없다.** 양방향 사고가 실제로 났다 — 프로덕션에 먼저 적용하고 파일을 커밋하지 않아 클린 DB 가 깨진 적, 반대로 applied 로 기록됐는데 컬럼이 없어 모든 SRS 평가가 42703 으로 롤백된 적. 승격 게이트는 **선서일 뿐 측정이 아니다** → [`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md).
- **같은 자식 테이블에 CASCADE 와 SET NULL 이 서로 다른 부모로부터 걸리면** 부모 삭제가 23503 을 낸다(발화 순서에 달려 프로덕션 28건 중 5건만 실패했다). 호출자가 삭제 순서를 명시한다(mig 237).
- **Supabase CLI 는 2.95.4 로 핀되어 있다.** 2.107.0 부터 `db reset` 이 anon/authenticated 에 기본 DML 을 주지 않아 통합 테스트가 `permission denied` 로 깨진다.
- **CI 의 `auth.uid()` 는 셰임이다**(`.github/scripts/bootstrap-auth.sql`). 로컬·프로덕션과 인증 해석이 다를 수 있다.
- **클라이언트는 RPC 를 건너뛰고 PostgREST 로 테이블에 직접 POST 할 수 있다.** 그래서 RPC 안에만 있는 규칙(카드 한도 등)은 우회 가능하고, mig 136 이 statement-level 트리거로 백스톱을 놨다. **새 한도 규칙은 RPC 와 트리거 양쪽을 고려**한다.

## 관련 문서
[`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) · [`../05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md) · [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) · [`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md) · `DOCS/DEPLOYMENT/PROD-MIGRATION-RUNBOOK.md`
