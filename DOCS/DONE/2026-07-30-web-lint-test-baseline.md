# Web Lint & Test Baseline — Zero-Debt Cleanup

상태: DONE — PR #342 (test baseline) + PR #345 (lint baseline)

기준선: `origin/develop@7195c50` → `97a5399` (학습 하드닝 P8 완료 직후)

## 1. 왜

`develop` 의 CI 는 두 개의 escape hatch 를 달고 있었다.

- `Vitest — full suite (informational)` : `continue-on-error: true`, 실제로 **75 fail + 6 suite 로드 실패**
- `Web lint (informational)` : `continue-on-error: true`, **148 error**

둘 다 "기존 부채" 라는 이름으로 방치됐고, 그래서 **새 결함이 들어와도 CI 가 초록**이었다.
실제로 두 부채 안에 진짜 제품 결함이 숨어 있었다(§3, §4).

## 2. 결과

| 항목 | before | after |
|---|---|---|
| web vitest | 75 fail / 14 파일 실패 (CI), 96 fail (로컬 node 26) | **130 files / 2187 tests 전부 통과** |
| web eslint | 148 error / 6 warning | **0 error / 4 warning** |
| e2e 타입체크 | 존재하지 않음 (어떤 tsconfig 에도 미포함) | `tsconfig.e2e.json` + `pnpm typecheck:e2e`, 통과 |
| CI 게이트 | vitest·lint 둘 다 informational | 둘 다 **필수**, e2e typecheck 추가 |

## 3. 테스트 baseline (PR #342)

세 가지 harness 결함이 75건 전부를 설명했다. 제품 버그로 분류된 실패는 0건이었다.

1. **mock 경로 불일치 (68건)** — store 6종이 `web/src/lib/supabase` 만 mock 했지만 해당 store 는
   shared 의 re-export 이고 shared 는 shared client 를 import 한다. mock 이 안 걸려 전부 0-call 실패.
2. **테스트 env 부재 (6 suite)** — `lib/supabase.ts` 가 import 시점에 throw. 셸에 `VITE_*` 를
   export 해둔 개발자 머신에서만 통과. vitest 에 더미 값을 주어 환경 의존을 끊었다.
3. **node 26 localStorage (21건)** — 내장 글로벌이 jsdom 것을 가려 로컬에서만 깨졌다.

**mock 이 실제로 적용되자 드러난 제품 결함**: `auth-store.initialize()` 가 로그인 후 부수효과를
세션 설정과 같은 try 에서 실행해, device adapter throw 하나가 **서버가 승인한 세션을 지웠다**.
부수효과에 자체 catch 를 주고 회귀 테스트로 고정했다(red 확인 후 green).

낡은 기대값 7건(layout-styles 시맨틱 토큰, guide-content 의 삭제된 api 섹션, i18n 스캐너의
인라인 `{ ns }` 미인식)도 정리했고, 스캐너를 고치자 **비영어 사용자에게 영어 defaultValue 가
노출되던 키 2건**이 드러나 함께 수정했다.

## 4. Lint baseline (PR #345)

148건을 규칙별로 나눠 각각 다른 방식으로 닫았다. **`eslint-disable` 은 한 건도 쓰지 않았다.**

### 4-1. 실제 결함 6건 (commit 1)

- `SessionDetailPage.getCardPreview` 가 순수 함수에서 `useTranslation` 호출 — 렌더 중 호출이라
  우연히 동작했을 뿐, 조건부 호출이면 hook 순서가 깨진다.
- `PersonalAnalyticsPage` 의 effect 가 loader 5개를 선언 전에 참조 — hoisting 으로 돌지만
  React Compiler 가 컴포넌트 최적화를 포기한다.
- `PublisherDashboardPage` 의 `useMemo` 의존성이 컴파일러 추론과 불일치 → 최적화 skip.
- `StudyCard` 의 빈 `catch {}` 2곳, `SettingsPage` 의 `false ? … : …` 죽은 분기.
- Playwright fixture 의 두 번째 인자명이 `use` 라서 React `use` hook 으로 읽혀 rules-of-hooks 4건.

### 4-2. set-state-in-effect 24건 (commit 2)

렌더 중 파생 / React 공식 "previous render 값 비교" 패턴 / 타이머·async 콜백 유지로 전환했다.
기계적 변환을 검토하다 **prev 값을 현재 값으로 seed 하면 effect 의 첫 실행이 사라진다**는
공통 함정을 6곳에서 잡았다.

- `SwipeGuide` 는 visible=true 로 마운트하면 힌트가 아예 안 보였다(신규 테스트로 red 확인).
- `DeckFormModal` / `TemplateFormModal` 은 edit 대상으로 마운트하면 빈 폼이 떴다.
- `ExportModal` / `ImportModal` 은 열린 상태로 마운트하면 초기화를 건너뛰었다.
- `GuidePage` 는 마운트 시점에 이미 URL 에 있던 딥링크 해시를 무시했다.

두 곳은 추적 복사본보다 나은 형태로 바꿨다: `SessionKickedOverlay` 는 "진입 지연 경과" 를
파생값으로 바꿔 reduced-motion 사용자가 아예 화면을 못 보던 문제까지 해결했고, `ConfigStep` 은
무효 덱 선택을 사후 clear 대신 파생으로 없애고 `useImage` 의존성을 복원했다.

### 4-3. 모듈 분리 7건 (commit 3)

컴포넌트 파일이 상수·조회 테이블·타입·테스트 seam 을 함께 export 하고 있었다. fast refresh 가
깨지는 것은 물론, 숫자 하나 읽으려고 비-UI 코드가 React 모듈을 import 했다.

- `lib/card-limit.ts` — 표시용 unlimited sentinel + 판별 함수
- `lib/deck-settings.ts` — 덱 색/아이콘/SRS 필드 메타 + 두 덱 폼이 공유하는 `DeckSettingsFormValues`
- `lib/achievement-icons.ts` (JSX 없음) + `components/achievements/AchievementIcon.tsx`
- `lib/auth-callback-hash.ts` — 모듈 로드 시 해시 캡처와 테스트 전용 override

### 4-4. no-unused-vars 19건 (commit 4)

16건은 코드베이스가 의도적으로 쓰는 `_` 접두 규약이었다 → lint 설정에 규약을 명시.
나머지 3건은 진짜 dead binding 이라 삭제(미사용 fixture, 미사용 import, write-only `testDeckId`).

### 4-5. no-explicit-any 84건 (commit 5, 6)

**제품 4건이 잠재 결함이었다.** 비운 `<input type="number">` 를 `'' as any` 로 `number` state 에
넣고 있었고, 타입을 `number | ''` 로 바꾸자 소비 지점이 드러났다:

- `ConfigStep` 은 빈 문자열을 `cardCount` 로 서버에 보냈다.
- `SettingsPage` 는 `daily_new_limit` 으로 저장했다.
- `DeckSettingsForm` 은 `srsSettings.max_interval_days` 에 썼다.

`lib/numeric-input.ts` 로 "빈 상태를 가진 숫자 입력" 을 한 번만 모델링했다.
`MarketplacePage` 의 `(listing as any).badge_type` 캐스트는 그냥 낡은 것이었다(store 는 이미
`OfficialListing` 을 반환한다).

나머지 79건은 테스트·e2e 였고, 전부 "타입이 없어서" 였다:

- `lib/seo/json-ld.ts` 로 schema.org 출력을 모델링하고 11개 빌더에 리턴 타입을 달자
  content-seo 테스트의 캐스트 42건이 **한 줄도 남지 않고** 사라졌다. 테스트가 캐스팅하던 이유는
  제품이 무엇을 만드는지 말하지 않았기 때문이다.
- e2e 는 fixture 를 `any` 로 적어 뒀다 → page object 와 `Page` 타입으로 교체.
- pre-migration row 를 만드는 테스트는 `PreMigrationTemplate` 타입으로 **의도를 문서화**했다.

### 4-6. e2e 타입 커버리지 (신규)

e2e 가 **어떤 tsconfig 에도 포함돼 있지 않았다** — 그래서 fixture 가 `any` 로 흘러도 아무도
몰랐다. `tsconfig.e2e.json` + `pnpm typecheck:e2e` 를 추가하고 CI 에 넣었다. 현재 clean.

## 5. 남은 것

- eslint **warning 4건** (`react-hooks/exhaustive-deps` 3 + 사용되지 않는 disable 지시자 1).
  error 가 아니고, 의존성 추가가 동작을 바꿀 수 있는 자리라 이번 범위에서 제외했다.
  게이트는 error 기준이므로 부채가 다시 쌓이지는 않는다.
- e2e 실행 검증은 이 환경에서 불가(dev server + 실제 Supabase 필요). e2e 변경은 lint 와
  신규 타입체크로만 검증했다 — 문서에 명시한다.
- 대부분의 컴포넌트에 component test 가 없어 §4-2 리팩토링의 회귀 근거는
  tsc + 전수 vitest + build 에 의존한다. 가장 위험한 두 곳(SwipeGuide, ReviewForm)에는
  테스트를 새로 넣었고, 실제로 그중 하나가 회귀를 잡아냈다.
