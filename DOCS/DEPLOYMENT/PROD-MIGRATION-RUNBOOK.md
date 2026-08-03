# 프로덕션 마이그레이션 적용 런북

**순서가 중요합니다. 마이그레이션이 먼저, 웹 배포가 나중입니다.**
main에 push하면 Cloudflare가 자동 배포되므로, 스키마가 뒤처진 상태로 코드가 나가면
학습 화면이 깨집니다(`get_goal_knowledge`의 새 키가 `undefined`, "더 하기"가 404).

## 왜 `supabase db push`가 아닌가

이 저장소는 `NNN_name.sql`(181, 182…)로 번호를 매기는데 CLI는
`<14자리 타임스탬프>_name.sql`을 기대합니다. 둘을 대응시키지 못해서 `db push`는 이미
적용된 원격 버전을 전부 "로컬에 없음"으로 보고하고 **history repair를 제안**합니다 —
그대로 실행하면 적용된 마이그레이션이 reverted로 표시됩니다. 번호 규칙은 이 저장소의
관례이고 CI의 psql 루프도 같은 규칙을 쓰므로, 배포 경로도 CLI와 싸우지 않고 같은 관례를
따릅니다.

## 필요한 것

**데이터베이스 비밀번호** — Supabase 대시보드 → Project Settings → Database.
service-role 키가 아니고, CLI 액세스 토큰도 아닙니다. 이 값은 저장소에도 이 머신의
키체인에도 없습니다.

```bash
export PROD_DB_URL='postgresql://postgres.ixdapelfikaneexnskfm:<PASSWORD>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'
```

## 실행

```bash
# 1) 먼저 읽어보기 — 아무것도 적용하지 않습니다
./scripts/apply-prod-migrations.sh --from 181 --to 185 --dry-run

# 2) 적용
./scripts/apply-prod-migrations.sh --from 181 --to 185
```

스크립트는 **정확히 180에 있지 않으면 실행을 거부합니다.** 건너뛰기도 재적용도
"아마 괜찮을 것"도 없습니다.

## 그 다음

```bash
# 3) develop → main (웹 자동 배포)
gh pr create --base main --head develop --title "release: adaptive schedule + paywall"
gh pr merge --merge

# 4) 모바일: 이번 변경은 JS 전용(로케일 + 화면)이라 OTA로 충분
gh workflow run deploy-mobile.yml --ref main -f mode=ota
```

## 실패하면

각 마이그레이션 파일은 자체 `BEGIN`/`COMMIT`을 가지므로 **범위 전체는 하나의 트랜잭션이
아닙니다.** 스크립트는 파일이 커밋된 뒤에만 버전을 기록하므로, 중간에 죽어도 history는
정확하고 `--from <다음 번호>`로 이어서 실행하면 됩니다.

되돌리려면 `supabase/rollbacks/`의 대응 파일을 **최신 번호부터 역순으로** 실행하고,
`supabase_migrations.schema_migrations`에서 해당 버전을 지우십시오.

## 이 절차의 검증

`fr` 템플릿에서 prod와 같은 상태(스키마 180 + history 1..180)의 로컬 DB를 만들어
스크립트로 181→185를 적용한 뒤, SQL 스위트 6종을 전부 통과시켰습니다:
`goal_knowledge` · `goal_workload` · `mastery_definition` · `append_plan` ·
`learning_smoke` · `learning_net_zero`. dry-run·잘못된 `--from` 거부·재실행 거부도 확인.
