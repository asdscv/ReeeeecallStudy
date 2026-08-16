# 게이트 인벤토리 (SSOT)

> **이 표가 "무엇이 실제로 막히는가"의 단일 진실원이다.**
> 표준 문서의 모든 "게이트: …" 표기는 여기의 한 줄을 가리킨다.
> `.github/workflows/README.md` 는 현재 ci.yml 과 어긋나 있으니 **근거로 삼지 않는다**(→ §5 부채).
>
> 실측 기준 2026-08-16 · `.github/workflows/ci.yml` 550줄 · job 7개

## 1. CI job 7개

모든 job 은 서로 `needs` 없이 **병렬**로 돈다. Node 20 · pnpm 9.15.0 · `--frozen-lockfile`.

| # | job (`name`) | 스텝 | 실제로 막는 것 | 사정거리 밖 |
|---|---|---|---|---|
| 1 | **Lint + Typecheck** (`lint-typecheck`) | `Web typecheck` = `tsc -b --noEmit` | 웹 + **shared** 타입 오류 (shared 는 `tsconfig.app.json` 의 `include: ["src","../shared"]` 로 딸려 들어온다) | `packages/shared/tsconfig.json` 자체는 어디서도 실행되지 않음 → shared 의 `lib:["ES2022"]`(DOM 없음) 계약은 **아무도 검사하지 않는다** |
| | | `Web e2e typecheck` = `tsc -p tsconfig.e2e.json` | e2e 픽스처가 `any` 로 흘러내리는 것 | e2e **실행**은 하지 않음 |
| | | `Web lint` = `eslint .` | `packages/web` 의 eslint **에러** | `--max-warnings` 없음(현재 warning 5). shared·mobile·worker-modules·tools·scripts 는 **eslint 설정 자체가 없다** |
| | | `Mobile typecheck (regression guard for marketplace scope)` | 로그에 `MarketplaceDetail\|marketplace-store\|acquireDeck\|deck-store` 가 grep 될 때**만** | ⚠️ **그 밖의 모든 모바일 타입 오류를 통과시킨다** (`set +e` … `exit 0`) |
| 2 | **Migration promotion gate** (`migration-promotion`) | `Check migrations were applied before promoting` | base 가 `main` 인 PR 에서, PR 본문의 `prod-migrations-applied: N` 이 PR 이 싣는 최고 번호와 일치하는지 | **선서지 측정이 아니다.** 실제 프로덕션 적용 여부는 검증하지 않는다. develop 대상 PR·main 직접 푸시에서는 아예 안 돈다. ★ **웹은 develop 머지 시점에 이미 배포되므로 이 게이트는 웹에 대해 사후 확인이다** |
| 3 | **Unit Tests** (`unit-tests`) | `Vitest — full suite` (`packages/web`, 196파일 / 3,533테스트) | ★ **사실상 모노레포 전체의 불변식 게이트.** 파일시스템을 읽어 `supabase/functions`(15) · `supabase/migrations`(3) · `packages/mobile`(8)까지 검사한다 | `packages/mobile` 화면 로직, 엣지 핸들러 본체 |
| | | `Vitest — worker modules` (17파일 / 126테스트) | `worker-modules/` 로직 | `worker.js` 자체 |
| | | `i18n — mobile locale suite` = `npx tsx packages/mobile/src/i18n/i18n.test.ts` | 모바일 로케일 8종 검사(590 assert) | 모바일 단위 테스트 **6개 중 나머지 5개는 CI 에 없다** |
| | | `Upload coverage` | — | ⚠️ **영구 no-op**: `--coverage` 를 붙이는 곳이 없어 업로드할 파일이 생기지 않는다 |
| 4 | **Integration (Supabase)** (`integration-tests`) | Docker supabase 스택(CLI **2.95.4 핀**) + `tests/integration` 5 spec | RPC 실경로(권한 포함) | env 없으면 스킵되도록 설계됨 |
| 5 | **Architecture Guard** (`arch-guard`) | `Run arch checks` = `pnpm --filter @reeeeecall/web exec tsx ../../tools/check-arch.ts` | ① `packages/shared/lib/**` 의 supabase import ② 학습 엔진 6경로의 웹 재등장 | ⚠️ ①의 정규식이 **형제 import `./supabase` 를 놓친다**(현재 3파일 통과 중). `packages/shared/learning/**` 은 검사 대상이 아니다 |
| 6 | **Migration Safety** (`migration-safety`) | `db reset` + **idempotency check(2회)** | 마이그레이션 체인이 fresh DB 에 순서대로 적용되는가, 번호 중복 | 이미 적용된 마이그레이션의 **수정** 여부는 못 잡는다 |
| 7 | **AI Credit Metering (postgres-15)** (`ai-credit-tests`) | plain postgres:15 + `bootstrap-auth.sql` 셰임 + `psql -v ON_ERROR_STOP=1` 로 SQL 스위트 실행 | DB 계약(과금·한도·권한·삭제 순서 …) | ★ **글롭이 아니라 손으로 적은 목록**이다. 등록하지 않은 스위트는 영원히 안 돈다 |

## 2. ★ SQL 스위트 등록 — 이 저장소에서 가장 자주 새는 구멍

`supabase/tests/*.sql` 을 만들어도 `ci.yml` 에 스텝을 추가하지 않으면 **한 번도 실행되지 않는다.**

이미 일어난 일:
- `quiz_set_delete_test.sql` — mig 224 때 작성되고 231 때 갱신됐지만 스텝이 없어 안 돌았고, 그 사이 프로덕션에서 "푼 퀴즈 삭제"가 23503 으로 실패(28건 중 5건).
- 같은 커밋에서 **미등록 스위트 9개**가 한꺼번에 발견됐다(51개 중 40개만 등록돼 있었다).
- `refund_policy_test.sql` — #320 에 들어오고 한 번도 안 돌았다.

**현재 상태(2026-08-16)**: 54개 중 52개 등록 — `*_test.sql` 은 **전부** 등록돼 있다. 미등록 2개는 `learning_dry_run_check.sql`(스크립트 헬퍼)·`quiz_mobile_seed.sql`(시드)로 정상.

**등록 방법**: `ci.yml:383-401` 의 `for f in \` 묶음에 **1줄** 추가(현재 관례). 나머지 40개는 개별 step 으로 남아 있다.

**PR 전 자가 점검**
```bash
for f in supabase/tests/*_test.sql; do
  grep -q "$(basename "$f")" .github/workflows/ci.yml || echo "미등록: $f"
done
```

**또 하나의 함정**: 이 job 은 **DB 하나를 공유하며 순차 실행**하고 `ON_ERROR_STOP=1` 이다.
앞 스위트가 죽으면 뒤는 전부 skip 된다 — 잡의 마지막 스텝이던 스위트가 그 브랜치에서 단 한 번도 실행되지 않은 적이 있다.
그리고 스위트는 `ROLLBACK` 으로 끝나야 한다(현재 3개가 위반해 뒤 스위트의 전제를 바꿀 수 있다).

## 3. 게이트가 **없는** 것 (알고 있는 공백)

| 공백 | 위험 | 대응(현재) |
|---|---|---|
| **엣지 함수 13개**: 타입체크·린트·테스트·배포 전부 없음 | 결제 웹훅 4개·환불·AI 과금이 여기 산다. `ai-generate/index.ts`(1,535줄)를 import 하는 테스트 0 | 로직을 `_shared/` 순수 함수로 빼서 웹 vitest 가 직접 import |
| **Playwright e2e 38개 · 모바일 Appium e2e 14개** | 실행되지 않는다 — Playwright 는 `Web e2e typecheck` 로 타입체크만 되고, 모바일 Appium e2e 는 `packages/mobile/tsconfig.json` 의 `exclude: ["__tests__/e2e","wdio.*.ts"]` 때문에 **타입체크조차 되지 않는다** | 로컬 수동 |
| **모바일 단위 테스트 5/6** | 러너도 job 도 없음 | `npx tsx <file>` 수동 |
| **모바일 타입 회귀** | marketplace 스코프 밖은 통과 | — |
| **커버리지** | 어디서도 측정되지 않음(official-decks 는 임계치를 선언만) | — |
| **커밋 메시지 형식** | commitlint 없음 | 사람 |
| **워크플로 `${{ }}` 보간 금지** | 린터 없음. `ai-model-watch.yml:74` 가 이미 위반 중(`run:` 안 heredoc 에 `${{ steps.watch.outputs.body }}`, `issues: write` 보유) | [`../11_SECURITY`](../11_SECURITY/README.md) |
| **롤백 파일 존재/동작** | 롤백 74개 중 CI 가 실제로 되돌려보는 건 7개 | `scripts/dry-run-learning-migrations.sh` |
| **순환참조·import 계층** | madge/dependency-cruiser/eslint 규칙 전무 | — |
| **번들 크기 예산** | 없음 | — |
| **접근성** | `eslint-plugin-jsx-a11y` 없음 · Appium 스펙 미실행 · `packages/web/src/lib/a11y.ts` 는 프로덕션 소비자 0 | [`../14_UI §4`](../14_UI/README.md#4-접근성) |
| **디자인 토큰 웹↔모바일 동기화** | 웹은 `design-tokens` 를 import 하지 않고 hex 를 복사한다. 동기화 장치가 주석 3줄뿐이라 이미 어긋났다(`ratingColors.hard`) | [`../14_UI §1`](../14_UI/README.md#1-색과-토큰--지금-진실원이-셋이다) |
| **다크모드 회귀** | raw 팔레트 클래스는 `.dark` 에서 뒤집히지 않는데 이를 잡는 검사가 없다 | [`../14_UI §1`](../14_UI/README.md#1-색과-토큰--지금-진실원이-셋이다) |
| **shared 의 DOM 금지 계약** | 웹 CI 는 초록, 모바일 런타임에서 터진다(`packages/shared` 에서 `tsc -p tsconfig.json` 을 돌리면 현재 4파일이 DOM 때문에 깨진다: `adapters/crypto.ts`·`lib/persistence-id.ts`·`stores/auth-store.ts`·`stores/subscription-store.ts`) | — |

## 4. 게이트를 새로 만들 때

1. **동작 테스트로 볼 수 있나?** → 그러면 평범한 vitest 를 쓴다.
2. **소스 구조에 대한 주장인가?**(레지스트리 우회·죽은 export·사본 갈라짐) → `readFileSync` 로 소스를 읽는 가드를 쓴다. 표본은 `ai-hub-not-hardcoded.test.ts` · `*-no-dead-exports.test.ts` · `*-parity.test.ts`.
   - 스캔에서 **`.js` 를 제외**한다(gitignore 된 컴파일 트윈이 삭제된 reader 를 살려둔다).
   - 스캔 대상 목록을 하드코딩했다면 "새 화면이 생기면 여기에 추가" 를 헤더에 적는다.
3. **DB 계약인가?** → `supabase/tests/<name>_test.sql` + **`ci.yml` 등록**(§2).
4. **SQL 과 TS 양쪽에 사는 상수인가?** → 마이그레이션 파일 텍스트를 읽어 pin 한다(`learning-mastery-parity.test.ts` 표본). SQL 이 TS 를 import 할 수 없기 때문.
5. **서버 캡과 짝이 되는 클라 상수인가?** → 복사하지 말고 **서버 파일을 읽어 도출**한다(`quiz-batch-size.test.ts` 표본).
6. 만들었으면 **변이 테스트**로 확인한다: 규칙을 어겨보고 red 가 되는지, 되돌리면 green 인지. 그 사실을 커밋 본문에 적는다.
7. **이 문서에 한 줄 추가한다.**

## 5. 이 문서의 부채

- `.github/workflows/README.md` 가 stale 하다(job 5개로 기재, unit-tests 를 "informational" 이라고 설명 — 둘 다 사실이 아니다). **삭제하거나 이 문서를 가리키게 고친다.**
- SQL 스위트 등록이 개별 step 40개 + 묶음 루프 11개로 **두 방식이 공존**한다. 새 파일이 어디로 가야 하는지 규칙이 없다 → 전부 묶음 루프로 옮기는 것이 목표.
- `Upload coverage` 스텝이 no-op 이다. 커버리지를 실제로 측정하거나 스텝을 지운다.
