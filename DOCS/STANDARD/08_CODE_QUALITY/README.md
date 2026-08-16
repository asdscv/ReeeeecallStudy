# 08. 코드 품질 — 타입 · 린트 · 네이밍 · 커밋

## 목차
- [1. 타입체크 — 명령 형태가 패키지마다 다르다](#1-타입체크--명령-형태가-패키지마다-다르다)
- [2. ESLint](#2-eslint)
- [3. 네이밍](#3-네이밍)
- [4. 파일·산출물 위생](#4-파일산출물-위생)
- [5. 커밋 메시지](#5-커밋-메시지)
- [6. 툴체인 핀](#6-툴체인-핀)

---

## 1. 타입체크 — 명령 형태가 패키지마다 다르다

| 패키지 | 명령 | 왜 |
|---|---|---|
| `packages/web` | **`tsc -b --noEmit`** | `tsconfig.json` 이 `"files": []` + `references` 뿐인 솔루션 파일이라 **`tsc -p tsconfig.json --noEmit` 은 0개 파일을 검사하는 무동작**이다. `-b` 여야 530파일을 본다 |
| `packages/web` e2e | `tsc -p tsconfig.e2e.json` | 앱 tsconfig 에 넣으면 픽스처가 `any` 로 흘러내린다 |
| `packages/official-decks` | `tsc -p tsconfig.json --noEmit` | references 없이 include 만 있어 `-p` 가 정상 |
| `packages/mobile` | `tsc --noEmit` | ⚠️ CI 에서 `set +e` + grep 으로 감싸져 **사실상 게이트가 아니다** |
| `packages/shared` | — | 자기 tsconfig 를 실행하는 스크립트도 CI 스텝도 **없다**. 웹 `tsconfig.app.json` 의 `include: ["src","../shared"]` 로만 검사된다 |

> **로컬에서 통과했는데 CI 가 터진다면 `-p` 를 썼는지 먼저 본다.**

**엄격도가 통일되어 있지 않다**(현 상태 기록):
- web: `strict` + `noUnusedLocals`/`noUnusedParameters` + `verbatimModuleSyntax` + `erasableSyntaxOnly` + `noUncheckedSideEffectImports`
- official-decks: `strict` + `noUnusedLocals`/`noUnusedParameters` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride`. **web 의 상위집합이 아니다** — `verbatimModuleSyntax` 는 명시적으로 `false` 이고 `erasableSyntaxOnly`·`noUncheckedSideEffectImports` 는 아예 없다
- mobile: `strict` 만 / shared: `strict` + `verbatimModuleSyntax` (+ `lib: ["ES2022"]`)

새 패키지는 **web 수준 이상**으로 시작한다. 기존 패키지의 엄격도를 올리는 것은 별도 작업으로 한다.

**`packages/shared` 의 숨은 계약**: `lib: ["ES2022"]`(DOM 없음)을 선언하지만 아무도 검사하지 않는다.
shared 에 `window`/`document`/`localStorage`(및 `Crypto`/`CryptoKey` 같은 DOM 타입)를 쓰면 **웹 CI 는 초록이고 모바일 런타임에서 터진다**(현재 4파일이 위반: `adapters/crypto.ts`, `lib/persistence-id.ts`, `stores/auth-store.ts`, `stores/subscription-store.ts`). 플랫폼 API 가 필요하면 `packages/shared/adapters` 포트를 쓴다.

## 2. ESLint

- 설정은 저장소에 **하나**뿐이다: `packages/web/eslint.config.js` (flat, tseslint **비 type-aware** recommended).
- 대상도 `packages/web` 뿐. `shared`·`mobile`·`worker-modules`·`tools`·`scripts` 는 린트되지 않는다.
- `packages/official-decks` 의 `lint` 스크립트는 **설정 파일이 없어 실행하면 죽는다**. 그 워크플로의 "Lint + Typecheck" job 도 typecheck 만 돈다 → 스크립트를 지우거나 설정을 추가한다(부채).

| 규칙 | 비고 |
|---|---|
| 의도적으로 안 쓰는 바인딩은 **`_` 접두** (인자·변수·catch·구조분해 전부) | 개별 예외 주석 19개를 다는 대신 규칙으로 인정했다 |
| `any` 는 사실상 금지. 필요하면 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 를 명시 | 현재 웹 전체 3곳 |
| 에러 0 이 게이트. **warning 은 통과한다**(`--max-warnings` 없음) | 현재 5건(`react-hooks/exhaustive-deps` 4건 + 쓸모없어진 disable 주석 1건 — `CreditLedgerList.tsx:71`) — 늘리지 않는다 |

## 3. 네이밍

| 대상 | 규칙 | 예 |
|---|---|---|
| React 컴포넌트·페이지·화면 | `PascalCase.tsx` | `DashboardPage.tsx`, `AIGenerateScreen.tsx` |
| shadcn/ui 프리미티브 | 소문자 (원본 관례 유지) | `button.tsx`, `dialog.tsx` |
| 그 밖의 모듈 | `kebab-case.ts` | `card-face-resolver.ts` |
| 훅 | `useXxx.ts` | `useLocale.ts` |
| 스토어 | `<name>-store.ts` | `deck-store.ts` |
| 마이그레이션 | `NNN_snake_case.sql` | `239_free_allowance_is_data.sql` |
| SQL 테스트 | `<name>_test.sql` | `quiz_set_delete_test.sql` |
| 롤백 | `NNN_name.down.sql` | (레거시 3개만 `_down.sql`) |
| Worker 모듈 | `kebab-case.js` (**TS 아님**) | `content-pipeline.js` |

`packages/official-decks` 는 클린 아키텍처 4층 + PascalCase 클래스 파일이라는 **다른 규약**을 쓴다. 인정된 예외이며, 다른 패키지로 번지게 하지 않는다.

**shared 내부 상대 import 확장자**: `packages/shared/learning/**` 은 `.ts` 를 명시하고(그래서 모바일 tsconfig 가 `allowImportingTsExtensions` 를 켰다), `packages/shared/lib/**` 은 생략한다. **디렉터리의 기존 방식을 따른다.**

## 4. 파일·산출물 위생

- 빌드 산출물은 커밋하지 않는다(`dist` 는 루트 `.gitignore` 한 줄).
- **`packages/shared` 소스 옆의 컴파일 `.js`/`.d.ts`/`.js.map` 트윈은 절대 커밋 금지.** Metro/Vite 가 소스에서 해석하는 구조라, 낡은 `.js` 가 최신 `.ts` 를 가린다. 현재 로컬에 29개 실재한다.
- 저장소 루트에서 `tsc` 를 돌리지 않는다 — 루트 tsconfig 에 include/files/references 가 없어 디자인 목업까지 글롭하고 `tsconfig.tsbuildinfo` 를 흘린다(그 파일은 루트 `.gitignore` 에 없다).
- 루트에 임시 산출물(CSV·이미지·JSON 덤프)을 쌓지 않는다. 작업 파일은 `.gitignore` 되는 경로나 저장소 밖에 둔다.

## 5. 커밋 메시지

```
type(scope): 무엇이 잘못돼 있었는지를 완결된 문장으로

증상 — 실제 에러 문자열/스크린샷/프로덕션 수치를 그대로 인용.
원인 — 왜 그렇게 됐는지.
수정 — 무엇을 바꿨는지.
검증 — 무엇을 돌렸고 몇 개가 통과했는지. 변이 테스트 결과.

Co-Authored-By: ...
```

| 규칙 | 실측 |
|---|---|
| 제목은 `type(scope): 서술문`. **명령형이 아니라 결함의 진술문** | 최근 200건 중 130건이 이 형식(스코프 없는 `type:` 7건까지 더하면 137건) |
| type 은 8종: `feat` `fix` `docs` `test` `chore` `ci` `perf` `security` | fix 59 · feat 48 · docs 11 · test 8 · chore 5 · ci 4 · perf 1 · security 1 |
| scope 는 제품 영역명. 둘이 걸치면 `+` 로 잇는다 | `learning` 49 · `quiz` 26 · `ai` 14 · `fix(dashboard+mobile)` |
| 한국어·영어 모두 허용 | 한국어 30/200 (컨벤셔널 형식 137건 기준으로는 27건) |
| 본문은 사후분석 리포트 — **프로덕션 실측 수치를 넣는다** | 중앙값 36줄(평균 42줄) |
| **변이 테스트 결과를 본문에 적는다** | → [`../07_TESTING §5`](../07_TESTING/README.md#5-변이-테스트--이-저장소의-완료-조건) |
| AI 가 쓴 커밋은 `Co-Authored-By:` 트레일러 | |

**게이트는 없다**(commitlint 없음). 이 형식은 순전히 자기규율이며, 그래서 **본문의 수치가 곧 다음 사람의 유일한 단서**다.

제목 예:
- `fix(quiz): 429장짜리 덱인데 오답 보기는 늘 같은 40개에서 나왔습니다`
- `fix(billing): a model with no price row charged the learner 43x`
- `ci(i18n): run mobile's i18n suite — it gated nothing, and it reads screen source`

## 6. 툴체인 핀

| 도구 | 값 | 비고 |
|---|---|---|
| Node | 20 (CI) | 로컬 22+ 는 `localStorage` 전역 때문에 테스트가 다르게 동작한다 |
| pnpm | 9.15.0 (`ci.yml`, `deploy-mobile.yml`) / **10.32.1 (`official-decks.yml`)** | ⚠️ 불일치. 루트에 `packageManager` 필드가 없어 로컬은 아무 버전 |
| Supabase CLI | **2.95.4 핀** | 2.107.0+ 는 `db reset` 이 anon/authenticated DML 을 안 줘서 통합 테스트가 깨진다 |
| vitest | web ^4 / official-decks ^3 | |
| pnpm linker | `node-linker=hoisted` + `shamefully-hoist=true` | **미선언 의존성도 해석된다**(shared 가 react 를 선언하지 않고 쓴다). 링커를 되돌리거나 패키지를 독립 배포하는 순간 깨진다 |

**버전을 올릴 때는 왜 올리는지와 무엇을 확인했는지를 커밋 본문에 적는다.**

## 관련 문서
[`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) · [`../01_ARCHITECTURE`](../01_ARCHITECTURE/README.md) · [`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md)
