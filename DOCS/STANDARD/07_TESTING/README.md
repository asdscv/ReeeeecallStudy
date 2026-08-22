# 07. 테스트 전략

> **이 저장소의 테스트는 두 종류다.** 하나는 동작을 검증하고, 다른 하나는 **소스 구조를 검증한다.**
> 후자가 이 저장소의 특징이며, 확장점을 만들면 함께 만드는 것이 규칙이다(제1원칙 R5).
>
> **어떤 게이트가 실제로 무엇을 막는지는 → [`GATES.md`](GATES.md) (SSOT)**

## 목차
- [1. 테스트 종류와 러너](#1-테스트-종류와-러너)
- [2. 어디에 두나](#2-어디에-두나)
- [3. 구조 테스트 3종](#3-구조-테스트-3종)
- [4. SQL 어서션 스위트](#4-sql-어서션-스위트)
- [5. 변이 테스트 — 이 저장소의 완료 조건](#5-변이-테스트--이-저장소의-완료-조건)
- [6. 테스트 하네스 함정](#6-테스트-하네스-함정)
- [7. Definition of done](#7-definition-of-done)

---

## 1. 테스트 종류와 러너

| 종류 | 러너 | 위치 | CI |
|---|---|---|---|
| 웹/공유 단위·통합 | vitest ^4 (설정은 `packages/web/vite.config.ts`) | `packages/web/src/**/__tests__/` | ✅ `Vitest — full suite` |
| Worker 모듈 | vitest (`worker-modules/vitest.config.js`) | `worker-modules/__tests__/` | ✅ |
| Supabase 통합 | vitest (`tests/integration/vitest.config.ts`) | `tests/integration/*.spec.ts` | ✅ Docker 스택 |
| DB 계약 | **psql** (`ON_ERROR_STOP` + `ASSERT`) | `supabase/tests/*.sql` | ✅ 단, **등록 필수** |
| 모바일 단위 | **`npx tsx <file>` 손수 스크립트** | `packages/mobile/src/**/*.test.ts` | ⚠️ 6개 중 1개만 |
| official-decks | vitest ^3 (자체 설정) | `packages/official-decks/__tests__/` | ✅ 별도 워크플로 |
| 웹 e2e | Playwright | `packages/web/e2e/tests/*.spec.ts` | ❌ 타입체크만 |
| 모바일 e2e | WebdriverIO + Appium | `packages/mobile/__tests__/e2e/specs/` | ❌ |

**`packages/shared` 의 테스트도 `packages/web/src/**/__tests__/` 에 둔다.** shared 안에는 테스트 파일을 두지 않는다(러너가 없어 그냥 실행되지 않는다). 실측: shared 안 `*.test.*` 0개.

**Docker 스택이 필요한 것은 `Supabase 통합` 한 줄뿐이고, 그것도 `pnpm test:integration` 으로만 돌린다.** 이 저장소의 `.env` 는 전부 호스팅 프로젝트를 가리키므로 `pnpm dev` / `build` / `test` / `dev:mobile` 은 Docker 와 무관하다. `pnpm test:integration` 과 `pnpm db:verify` 는 `scripts/local-supabase.sh` 를 거쳐 **스택을 띄우고, 돌리고, 반드시 내린다** — 자세한 이유는 6절.

**vitest 스코프마다 별도 config 를 두고 include 를 그 디렉터리로 좁힌다.** 루트에서 `**/*.spec.ts` 를 돌리면 모바일 wdio spec 14개가 딸려와 전부 `describe is not defined` 로 죽는다.

## 2. 어디에 두나

- 소스 옆 `__tests__/` 디렉터리 (292개 중 243개). 파일명 `<모듈명>.test.ts(x)`.
- e2e 만 `.spec.ts`.
- 새 회귀 테스트를 **기존 파일에 계속 얹지 않는다.** `quiz-mistakes-i18n.test.ts` 는 이름이 퀴즈 오답노트인데 실제로는 (a) 영어 번들 한글 유출 (b) 업적 62 id × 8 언어 × 2 플랫폼 검사를 함께 담고 있어 **파일명이 내용을 더 이상 설명하지 못한다.** 새 축이면 새 파일을 만든다.

## 3. 구조 테스트 3종

동작 테스트로는 절대 안 잡히는 것들이 있다. 하드코딩된 목록은 완벽하게 렌더되고, 읽는 사람 없는 export 는 컴파일된다.

| 종류 | 무엇을 막나 | 표본 | 복제 대상 |
|---|---|---|---|
| **not-hardcoded** | 화면이 레지스트리를 우회해 목록을 직접 타이핑 | `ai-hub-not-hardcoded.test.ts` · `learning-domains-not-hardcoded.test.ts` | 새 레지스트리 |
| **no-dead-exports** | 읽는 사람 없는 export/어댑터 멤버 | `ai-hub-kernel-no-dead-exports.test.ts` · `learning-kernel-no-dead-exports.test.ts` | 새 커널 디렉터리 |
| **parity** | 런타임 경계로 복제한 두 사본이 갈라짐 | `quiz-answer-field-parity.test.ts` · `server-card-answer-parity.test.ts` · `server-prompts-parity.test.ts` | 새 복제본 |

**추가 패턴 2개**
- **SQL↔TS 상수 pin**: SQL 이 TS 를 import 할 수 없으므로 **마이그레이션 파일 텍스트를 읽어** 상수를 대조한다(`learning-mastery-parity.test.ts` 가 mig 183 의 `AND interval_days >= N` 을 읽는다).
- **서버 캡 도출**: 클라이언트 상수를 복사하지 않고 **서버 파일을 읽어 도출**한다(`quiz-batch-size.test.ts`). 클라와 서버가 각각 옳은데 기능은 죽어 있던 사고의 대응.

**작성 규칙**
- 스캔에서 `.js` 를 제외한다 — gitignore 된 컴파일 트윈이 삭제된 reader 의 심볼을 살려둔다.
- `supabase/functions/ai-generate/index.ts` 는 리터럴 NUL 바이트 때문에 셸 grep 이 건너뛴다. `readFileSync` 기반은 영향 없다.
- 부채를 허용해야 하면 **명시적 baseline 파일**로 만들고 "목록은 줄어들기만 한다"를 주석에 적는다(`plural-debt.json` 표본, 현재 106건).

## 4. SQL 어서션 스위트

형식·함정은 [`../04_DATABASE §4`](../04_DATABASE/README.md#4-sql-어서션-스위트) 에 있다. 여기서는 **한 가지만 반복한다**:

> **파일을 만들었으면 `.github/workflows/ci.yml` 에 등록한다.** 글롭이 아니다.
> 등록을 잊으면 테스트는 통과하는 것도 실패하는 것도 아니고, **존재하지 않는다.**

## 5. 변이 테스트 — 이 저장소의 완료 조건

수정이 회귀를 실제로 잡는지 **직접 깨보고** 확인하며, 그 사실을 커밋 본문에 적는다. 이건 관행이 아니라 이 저장소의 문화다:

- "마이그레이션 237 없이 실패, 237 적용 후 통과"
- "ko 에서 `enrichment.groundedHint` 를 지우면 exit 1, 되돌리면 exit 0"
- "복수형 쌍의 **절반만** 지워도 실패한다"
- "가격 행 하나를 지우면 그 이름으로 실패한다"

**왜 필수인가**: 테스트를 초록으로 되돌리는 최소 수정이 그 테스트를 **무의미하게** 만들 수 있다.
실제로 한 토큰만 고치면 CI 는 초록인데 어서션이 아무것도 검증하지 않는 상태가 된 적이 있다(픽스처가 5장뿐이라 `OFFSET 99999` 가 항상 빈 결과였다).

## 6. 테스트 하네스 함정

- **Node 22+ 는 자체 `localStorage`/`sessionStorage` 전역을 갖고 jsdom 것을 가린다.** 로컬에서만 21개가 깨졌고 CI(Node 20)는 멀쩡했다. `packages/web/src/test/setup.ts` 가 MemoryStorage 로 우회한다.
- **`packages/shared/lib/supabase.ts` 는 import 시점에 키가 없으면 throw 한다.** 이를 transitively import 하는 모든 스위트가 CI 에서만 죽었다 → `vite.config.ts` 의 `test.env` 가 더미 값을 주입한다.
- **supabase mock 경로를 잘못 고르면 mock 이 안 먹는다**(웹 로컬 모듈 vs shared 모듈). 현재 두 방식이 공존한다.
- **`download-file.test.ts` 가 스위트를 간헐적으로 빨갛게 만든다.** fake timer 없이 `downloadFile()` 을 부르는 4개 테스트가 실제 `setTimeout(…,100)` 을 남기고, `restoreAllMocks()` 이후 진짜 `removeChild` 가 터져 **다른 파일**에 uncaught exception 으로 귀속된다. 이 job 에는 재시도가 없으므로 무관한 PR 이 랜덤하게 빨개진다. → 실타이머를 남기는 테스트는 fake timer 로 감싼다.
- **`supabase start` 가 만든 컨테이너는 `restart: unless-stopped` 다 — 한 번 띄우면 "계속 켜지는" 것이 정상 동작이다.** 이후 Docker 엔진이 뜨는 모든 순간(다른 프로젝트, 소켓 액티베이션이 잡아챈 `docker ps` 한 번)에 스택 전체가 되살아난다. 2026-08-21 에 이 저장소 컨테이너 11개가 아무도 안 쓰는 채로 40시간 상주해 있었다. 그래서 스택은 `pnpm test:integration` / `pnpm db:verify` 처럼 **끝나면 내려가는 명령으로만** 띄운다. 손으로 띄워야 하면 `pnpm db:up` 을 쓴다 — `supabase start` 와 달리 restart 정책을 `no` 로 되돌려 두므로 다음 엔진 기동 때 부활하지 않는다.
- **컨테이너를 내려도 호스트 RAM 은 돌아오지 않는다.** macOS Virtualization VM 은 한 번 부풀면 상한(`MemoryMiB`, 기본 8GB)까지 잡은 메모리를 반납하지 않는다. 실측: 컨테이너 0개인데 VM 프로세스 RSS 8,446MB. 스택을 다 내렸는데도 RAM 이 안 줄면 그건 버그가 아니라 이것이니, **Docker Desktop 자체를 종료**해야 회수된다.
- **Playwright 는 테스트마다 새로 로그인한다**(Supabase 는 사용자당 활성 세션 1개). `fullyParallel: false`, `workers: 1`. `e2e/auth.setup.ts` 는 정반대 전략의 **고아 파일**이니 그것을 규칙으로 오인하지 않는다.
- **e2e 자격증명이 없으면 로그인을 조용히 건너뛴다** → 실패가 "설정 없음"이 아니라 "화면에 요소 없음"으로 나타난다.

## 7. Definition of done

머지 전에 다음이 전부 참이어야 한다.

- [ ] `pnpm --filter @reeeeecall/web exec tsc -b --noEmit` 통과 (`-p tsconfig.json` 은 **무동작**이다)
- [ ] `pnpm --filter @reeeeecall/web lint` 에러 0
- [ ] `pnpm --filter @reeeeecall/web test` 전체 통과
- [ ] i18n 게이트 통과 (웹 parity + 정적 키 + 모바일 스위트)
- [ ] DB 계약을 바꿨으면 SQL 스위트 작성 + **`ci.yml` 등록** + 롤백 파일
- [ ] 확장점을 만들었으면 우회 가드 테스트 동반 (제1원칙 R5)
- [ ] 런타임 경계로 복제했으면 parity 테스트 동반 (제1원칙 R4)
- [ ] **변이 테스트로 새 테스트가 실제로 회귀를 잡는지 확인**하고 커밋 본문에 적었다
- [ ] 모바일 화면을 건드렸으면 **시뮬레이터/실기기로 눈으로 확인**했다 (→ [`../12_MOBILE`](../12_MOBILE/README.md))
- [ ] 설계 문서를 `DOCS/TODO` 에 썼고 머지 시 `DOCS/DONE` 으로 옮긴다 (→ [`../13_DOCS_WORKFLOW`](../13_DOCS_WORKFLOW/README.md))
- [ ] 부채를 남겼으면 [`../01_ARCHITECTURE/modular_composition.md §7`](../01_ARCHITECTURE/modular_composition.md#7-지금-어긋나-있는-것-부채-목록--늘어나면-안-되고-줄어들기만-한다) 표에 줄을 추가했다
