# Study Hardening Phase 7 — Shared Single Source

상태: DESIGN — implementation pending

기준선: `origin/develop@7195c50` (P6 merged + web vitest baseline green)

## 1. 문제

학습 로직이 **두 벌** 있다. `packages/web/src/{lib,stores}` 의 사본과 `packages/shared/{lib,stores}` 의
원본이다. P5B~P6 동안 모든 변경을 두 파일에 수동으로 미러링했고, 커밋마다 "dual-store pitfall"
주석을 달아야 했다. 실제 현재 차이:

| 파일 | 상태 |
|---|---|
| `lib/study-queue.ts`, `lib/cramming-queue.ts`, `lib/study-session-utils.ts`, `lib/srs-access.ts` | byte-identical |
| `lib/srs.ts` | 주석 2줄만 차이 |
| `stores/study-store.ts` | web 에만 pause/resume 상태(+`rateCard` 의 `isPaused` 가드) |

web 의 pause 기능은 **호출처가 없다** (`grep pauseSession\|resumeSession\|isPaused` → product code 0건).
즉 web 사본이 보유한 유일한 고유 동작은 죽은 코드다.

미러링은 조용히 깨지는 종류의 부채다. P5B 시점에 web 사본만 고치고 shared 를 놓치면
mobile 이 이전 동작을 유지하고, 테스트는 web 사본만 검증하므로 아무것도 실패하지 않는다.

## 2. 결정

web 의 학습 구현 사본을 **삭제**하고 web product code 와 테스트가 `@reeeeecall/shared/...` 를
직접 import 한다. 호환용 re-export 껍데기도 두지 않는다 — 껍데기를 남기면 mock 경로가 다시
둘로 갈리고(#342 에서 68개 테스트를 깨뜨린 원인이 정확히 그것이다) 어느 쪽을 mock 해야 하는지
매번 판단해야 한다.

삭제 대상:

- `packages/web/src/lib/srs.ts`
- `packages/web/src/lib/study-queue.ts`
- `packages/web/src/lib/cramming-queue.ts`
- `packages/web/src/lib/study-session-utils.ts`
- `packages/web/src/lib/srs-access.ts`
- `packages/web/src/stores/study-store.ts`

pause/resume 는 shared 로 옮기지 않는다. 호출처 없는 상태를 단일 소스에 심으면 그때부터
mobile 까지 유지해야 하는 계약이 된다. 필요해지면 그 시점에 shared 에 설계해 넣는다.

## 3. 영향 범위

product code (import 경로만 변경):

- `components/study/CrammingSetupPanel.tsx`, `components/study/NoCardsDue.tsx`
- `components/study/SrsRatingButtons.tsx`
- `pages/QuickStudyPage.tsx`, `pages/StudySetupPage.tsx`, `pages/StudySessionPage.tsx`

테스트: `stores/__tests__/study-store-*.test.ts` 6종은 store 가 shared 가 되므로

- import 를 shared 경로로 바꾼다.
- **mock 경로를 shared 로 옮긴다** (`@reeeeecall/shared/lib/supabase`,
  `.../lib/rate-limit-instance`, `.../lib/srs`, `.../lib/srs-access`). web 경로만 mock 하면
  실제 (초기화되지 않은) shared client 가 호출되어 조용히 0-call 로 실패한다.

## 4. Parity guard

`tools/check-arch.ts` (CI "Architecture Guard" job) 에 규칙을 추가한다:

> `packages/web/src` 안에 삭제 대상 6개 모듈의 구현 파일이 다시 생기면 실패한다.

경로 존재 자체를 금지한다(re-export 껍데기도 불허). 이렇게 하면 사본이 다시 자라는 순간
CI 가 막는다 — 사람이 미러링을 기억해야 하는 상태로 되돌아가지 않는다.

## 5. Tests

- 기존 학습 store suite 6종(6 mode 커버) 전부 Green — shared 구현을 대상으로 실행됨을 확인
- `lib/__tests__` 의 srs/queue/cramming/session-utils suite Green (이미 shared 를 import 하는 것도 있음)
- web 전수 vitest Green (128 files 기준, #342 에서 gate 로 승격됨)
- web `tsc -b --noEmit`, mobile `tsc --noEmit`, `vite build`
- Architecture Guard: 규칙 추가 후 통과 + 일부러 사본을 만들었을 때 실패하는지 확인

## 6. 완료 조건

- 설계 commit 선행
- web 사본 6개 삭제, product/테스트 import 전환, parity guard 추가
- 위 테스트 전부 Green, 신규 lint/tsc 오류 0
- 독립 review
- PR 최종 CI 7 checks green, develop merge, 문서 DONE 이동, worktree 정리
- 프로덕션 배포·migration 없음 (이 페이즈는 DB 변경 없음)
