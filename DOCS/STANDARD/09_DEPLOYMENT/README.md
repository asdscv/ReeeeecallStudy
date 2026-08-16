# 09. 배포와 릴리스

> **배포 표면이 4개고, 서로 다른 시스템이, 서로 다른 시각에 민다.**
> 이 문서의 규칙은 전부 그 비동기성에서 나온다.
>
> 절차의 상세는 `DOCS/DEPLOYMENT/README.md` 와 `DOCS/DEPLOYMENT/PROD-MIGRATION-RUNBOOK.md` 에 있다.
> 여기는 **규범**(무엇을 반드시 지켜야 하는가)만 적는다.

## 목차
- [1. 표면 4개와 배포 주체](#1-표면-4개와-배포-주체)
- [2. ★ 배포 순서 — 스키마가 먼저다](#2--배포-순서--스키마가-먼저다)
- [3. 브랜치와 릴리스 흐름](#3-브랜치와-릴리스-흐름)
- [4. 프로덕션 마이그레이션](#4-프로덕션-마이그레이션)
- [5. 엣지 함수와 시크릿](#5-엣지-함수와-시크릿)
- [6. 모바일 — OTA 인가 네이티브인가](#6-모바일--ota-인가-네이티브인가)
- [7. 릴리스 체크리스트](#7-릴리스-체크리스트-develop--main)
- [8. 함정](#8-함정)

---

## 1. 표면 4개와 배포 주체

| 표면 | 미는 주체 | 트리거 | CI 통과와의 관계 |
|---|---|---|---|
| 웹(Cloudflare Worker + SPA) | **저장소 밖의 Cloudflare Git 연동** | ★ **`develop` push** | ❌ **무관.** CI 가 빨개도 배포된다 |
| 모바일 | `.github/workflows/deploy-mobile.yml` → EAS | `main` push 중 `packages/mobile/**` `packages/shared/**` 변경 시 | 워크플로 자체 실패로만 |
| 엣지 함수 | **사람** `supabase functions deploy <name>` | 없음 | ❌ 머지로 반영되지 않는다 |
| DB | **사람** `scripts/apply-prod-migrations.sh` | 없음 | ❌ 파이프라인에 없다 |

`.github/workflows/` 에 `wrangler` 스텝은 0건이다 — 웹 배포를 CI 로 옮기지 않는 것이 현재 결정이다.

## 2. ★ 배포 순서 — 스키마가 먼저다

```
1) 프로덕션 마이그레이션 적용        ← 사람
2) 엣지 함수 배포 (변경분)           ← 사람
3) feature → develop PR 머지         ← ★ 웹이 여기서 즉시 나간다
4) develop → main PR 머지            ← 모바일 OTA 트리거 (+ 승격 게이트)
5) 모바일 OTA/네이티브 (자동/수동)
```

> ★ **`develop` 은 스테이징이 아니다.** Cloudflare Git 연동이 watch 하는 브랜치는 `main` 이 아니라
> **`develop`** 이다 — 실측(2026-08-17): 라이브 `reeeeecallstudy.xyz` 가 `origin/main` 에는 없고
> `origin/develop` 에만 있는 키(`ai-generate.json` 의 `wallet.freeQuizOnly`, `quiz.json` 의 `home.remove`)를
> 서빙하고 있었다. 이때 develop 은 main 보다 34 커밋 앞서 있었다.
> **웹에 영향이 있는 변경은 develop 머지 시점에 이미 전 사용자에게 나간다.**
>
> ⚠️ **그래서 승격 게이트는 웹보다 늦다.** `Migration promotion gate` 는 base 가 `main` 인 PR 에서만 돈다(§4).
> 즉 develop 머지로 웹이 이미 나간 **뒤에야** 마이그레이션 선서를 확인한다 — 웹에 대해서는
> 이 게이트가 사후 확인일 뿐 예방 장치가 아니다. 스키마를 1)에서 먼저 적용해야 하는 진짜 이유다.

**어기면 무슨 일이 나는가**: **develop 머지가 곧 웹 배포**이므로, RPC 가 없는 상태로 웹이 나가면
`append_daily_plan_items` 는 404, 새 반환 키는 `undefined` 로 렌더된다 — **전 사용자가 즉시**.
그리고 클라이언트에 RPC 타입 게이트가 없어([`../02_CLIENT §3`](../02_CLIENT/README.md)) 이걸 CI 가 잡을 방법이 없다.

**예외 — expand/contract**: 컷오버가 필요한 변경은 expand 를 승격 전에, **contract 는 컷오버 빌드가 서빙된 후에** 적용한다. 승격 게이트는 번호 하나만 받으므로 이 예외를 표현하지 못한다 → PR 본문에 순서를 산문으로 적는다.

## 3. 브랜치와 릴리스 흐름

```
feature/*  →  develop  →  main
                          └ 웹 즉시 배포 + 모바일 워크플로
```

- `develop` 은 **영구 브랜치**다. 머지할 때 `--delete-branch` 를 쓰지 않는다.
- `main` 에는 **develop 에서 PR 로만** 들어간다. (실측 2026-08-16, `origin/main` 최근 100 first-parent 중 6건이 머지 커밋이 아니다 — 5건은 feature 브랜치에서 main 으로 **직접 연 PR** 의 스쿼시 머지(#311~#315)고, 1건만 진짜 직접 푸시(`3e4f5989`, Cloudflare 재빌드 강제용 빈 커밋)다. 예외를 쓰면 이유를 커밋 메시지에 적는다.)
- **브랜치 보호·CODEOWNERS·PR 템플릿 파일은 저장소에 없다.** 규칙은 합의로만 유지된다.

## 4. 프로덕션 마이그레이션

| 규칙 | 근거 |
|---|---|
| **`supabase db push` 를 쓰지 않는다** | 파일명이 `NNN_name.sql` 이고 CLI 는 14자리 타임스탬프를 기대해서, 원격 버전을 전부 "로컬에 없음"으로 보고 history repair 를 제안한다 — 실행하면 적용된 것들이 reverted 로 표시된다 |
| `./scripts/apply-prod-migrations.sh --from N --to M` 를 쓴다 | 현재 버전이 정확히 `FROM-1` 이 아니면 실행을 거부하고, 파일 커밋 후에만 `schema_migrations` 에 기록한다. `--dry-run` 지원 |
| 인라인 SQL 대신 `supabase db query --file` | 인라인은 `--` 주석 때문에 실패한다 |
| main 을 목표로 하는 PR 이 새 마이그레이션을 싣는다면 **PR 본문에 `prod-migrations-applied: <최고 번호>`** | CI job `Migration promotion gate`. **선서지 측정이 아니다**(공개 저장소 CI 에 DB 자격증명을 두지 않기로 한 결정) |
| 되돌릴 때는 **의존성 역순**으로 실행한다 | 178 이 168 의 12인자 `persist_ai_remediation` 을 13인자로 교체했으므로 178 을 168 보다 먼저 되돌려야 한다(`scripts/dry-run-learning-migrations.sh:33-47`). 이 저장소의 유일한 실측 사례에서는 의존성 역순이 번호 역순과 일치하고, 런북도 "최신 번호부터 역순"을 지시한다(`PROD-MIGRATION-RUNBOOK.md:79`) — 다만 함수 시그니처를 교체하는 마이그레이션이 끼면 번호만 보고 순서를 정하면 안 된다 |

**프로덕션 스키마 버전은 git 에 없다.** 문서로 추적되는 유일한 장소가 `DOCS/OPS-READINESS.md` 다 — 적용 후 여기를 갱신한다.

## 5. 엣지 함수와 시크릿

- 배포는 **수동**: `supabase functions deploy <name> --use-api`.
- **`supabase secrets set` 은 `supabase/config.toml` 의 `[edge_runtime.secrets]` 블록도 함께 밀어 올린다.**
  로컬 `.env` 값이 프로덕션 키를 덮어써 **프로덕션 텍스트 생성이 401 로 죽은 사고**가 있었다.
  → **요청한 개수보다 많이 올라갔으면(count > 요청 수) 즉시 키 다이제스트를 확인한다.**
- 시크릿은 엣지 함수 안에서 `Deno.env` 로만 읽는다. **다만 service-role 키는 엣지 밖에도 있다** — Cloudflare Worker 가 `SUPABASE_SERVICE_KEY` 로 Supabase REST 를 직접 호출한다(`worker-modules/config.js:35`, `worker-modules/supabase-client.js:14-15`, `worker-modules/reminder-sender.js:48-53`). 키를 회전할 때 두 곳을 함께 돌려야 하는 이유다.
- `verify_jwt = false` 를 추가하는 것은 인증을 끄는 결정이다 → [`../11_SECURITY`](../11_SECURITY/README.md).

## 6. 모바일 — OTA 인가 네이티브인가

`deploy-mobile.yml` 의 `decide` job 이 `git diff HEAD^ HEAD` 로 판정한다:
`packages/mobile/(android|ios|app.json|app.config.js)` 가 바뀌면 **네이티브 빌드**, 아니면 **OTA**.

**여기서 나오는 규칙 3개**

1. **네이티브 모듈을 추가하면 판정 정규식이 그것을 보지 못한다.** `packages/mobile/package.json` 에 네이티브 모듈을 넣어도 OTA 로 판정된다 → 네이티브 모듈에 의존하는 UI 는 **런타임 존재 확인 뒤에** 켠다(`OWNER_GO_LIVE_SWITCH && Purchases != null`). 과거에 네이티브 모듈이 없는 설치본에 결제 UI JS 만 OTA 로 도달할 뻔했다 — 2026-07-29, `SUBSCRIPTION_UI_ENABLED` 가 하드코딩 `true` 인 것을 OTA 직전에 발견해 이 게이트를 넣고 막았다(`DOCS/TODO/HANDOFF-2026-07-29-billing-ui-deploy.md:153-160`). 그대로 나갔으면 **살 수 없는 가격표**가 렌더됐을 것이다(Apple 2.1(b) 리스크).
2. **`runtimeVersion.policy = "appVersion"`** 이라 버전을 올리는 순간 OTA 런타임이 갈라진다. 기존 설치(1.0.3)는 1.0.4 채널의 OTA 를 받지 못한다 — 구버전에 급히 고칠 게 있으면 그 런타임으로 따로 쏜다.
3. **이미 출시된 `expo.version` 으로 다시 빌드하면 EAS 는 `FINISHED` 를 답하는데 App Store Connect 에는 아무것도 올라가지 않는다.** Apple 이 비동기 ingest 에서 버리고 EAS 에는 흔적이 없다. Android 는 versionCode 만 올리면 통과해서 "안드로이드만 정상"이라는 비대칭이 생긴다. → 릴리스마다 `expo.version` 을 올린다.

모바일·shared 를 건드리지 않은 릴리스는 워크플로가 아예 트리거되지 않는다 →
`gh workflow run deploy-mobile.yml --ref main -f mode=ota` 로 수동 트리거.

## 7. 릴리스 체크리스트 (develop → main)

- [ ] CI 7개 job 전부 초록
- [ ] **프로덕션 마이그레이션 적용 완료** + `DOCS/OPS-READINESS.md` 갱신
- [ ] PR 본문에 `prod-migrations-applied: <N>`
- [ ] 변경된 **엣지 함수 배포 완료** (`supabase functions deploy`)
- [ ] 새 시크릿이 있으면 등록, 그리고 **덮어쓴 것이 없는지** 확인
- [ ] expand/contract 라면 contract 시점을 PR 본문에 적었다
- [ ] 모바일 변경이면 `expo.version` 을 올렸고, OTA/네이티브 판정이 의도와 같은지 확인
- [ ] 네이티브 모듈 의존 UI 는 런타임 가드 뒤에 있다
- [ ] `DOCS/TODO` 의 설계 문서를 `DOCS/DONE` 으로 이동

## 8. 함정

- **Cloudflare 빌드 환경변수가 커밋된 `.env.production` 을 덮어쓴다.** Vite 는 실제 env 를 `.env` 파일보다 우선한다. 옛 `VITE_LEMONSQUEEZY_VARIANTS` 가 남아 있어 **결제는 되고 지급은 안 되는** 상태가 됐고, 변수를 지워도 빌드가 트리거되지 않아 빈 커밋을 밀어야 했다. `VITE_SUPABASE_URL`/`ANON_KEY` 는 저장소에 없고 그 환경에만 있으니 지우면 사이트가 죽는다.
- **wrangler 의 named environment 는 상속되지 않는다.** `env.staging` 은 name/assets/vars/triggers 를 통째로 재선언한다 — 상위에 vars 를 추가하고 staging 에 복사하지 않으면 staging 만 조용히 다르게 동작한다.
- **`submit-mobile.yml` 은 존재하지 않는다.** `deploy-mobile.yml:133-134` 가 그 워크플로를 제출 게이트로 참조하지만 파일이 없다 — 스토어 제출은 수동이다.
- **service-role 키가 두 이름으로 쓰인다**(`SUPABASE_SERVICE_KEY` vs `SUPABASE_SERVICE_ROLE_KEY`). 하나만 회전하면 조용히 반쪽만 깨진다.
- **문서의 버전 표기가 실제와 어긋나 있다**(README 1.0.2 / STORE_SUBMISSION 1.0.3 / `app.json` 실제 1.0.4). 버전을 올릴 때 문서도 같이 고친다.

## 관련 문서
`DOCS/DEPLOYMENT/README.md` · `DOCS/DEPLOYMENT/PROD-MIGRATION-RUNBOOK.md` · `DOCS/DEPLOYMENT/STORE_SUBMISSION.md` · [`../04_DATABASE`](../04_DATABASE/README.md) · [`../12_MOBILE`](../12_MOBILE/README.md)
