# Study Hardening P1 — Guardrails

작성일: 2026-07-29  
기준선: `origin/develop@c4a593f`  
브랜치: `fix/study-guardrails`  
상태: ACTIVE

## 목표

1. store 경계에서 mode/config/rating을 검증한다.
2. pagination 중간 오류를 partial success로 반환하지 않는다.
3. legacy 덱의 누락/빈 `learning_steps`를 `[1, 10]`으로 fallback한다.
4. 모바일 cramming 진행률이 attempts 때문에 100%를 넘지 않게 한다.

## 설계

### 입력 검증

`packages/shared/lib/study-validation.ts`를 단일 정책 소스로 추가한다.

- `isStudyMode(value)`
- `normalizeStudyConfig(config)`
  - UUID 형식이 아닌 deck id는 현재 fixture/legacy 호환을 위해 non-empty string만 요구한다.
  - `batchSize`는 finite integer로 clamp한다.
  - `by_date`는 유효한 ISO timestamp pair와 start<=end를 요구한다.
  - cramming time은 `null` 또는 finite non-negative number만 허용한다.
  - filter별 숫자/태그 payload를 검증하고 새 객체로 정규화한다.
- `normalizeRatingForMode(mode,rating)`
  - SRS: `again|hard|good|easy`
  - cramming: `got_it|missed`, UI alias `known→got_it`, `unknown→missed`
  - 기타: `known|unknown|next|viewed`

`initSession`은 정규화 실패 시 fail-closed completed/empty 상태와 명시적 error를 사용한다.
`rateCard`는 `phase==='studying'`, `isFlipped`, `isRating===false`, valid rating을 모두 확인한다.
잘못된 호출은 queue/manager/stats/DB를 변경하지 않는다.

### Pagination

`packages/shared/lib/fetch-all-rows.ts`로 helper를 추출한다. 각 page builder는 `{data,error}`를
반환하며 어느 page에서든 error이면 page/context를 포함한 `Error`를 throw한다. 기존 row는
반환하지 않는다. shared/web store 모두 helper를 사용한다.

### Learning steps

`getSteps`는 missing 또는 empty에서 `DEFAULT_SRS_SETTINGS.learning_steps`의 복사본을 사용한다.
명시적 custom steps는 유지한다. 입력 settings를 mutation하지 않는다.

### Mobile progress

`useStudy`는 cramming일 때 `crammingManager.masteryPercentage()`를 사용하고 모든 mode 결과를
`0..100`으로 clamp한다. header의 attempts/unique 표기는 별도 통계라 유지하되 progress bar의
의미는 완료율로 고정한다.

## TDD

- validation unit: mode별 valid/invalid, alias, NaN/Infinity/negative, malformed filter/date
- pagination unit: 1 page, multi page, page 1/2 error, null data, exact page boundary
- SRS: missing/empty/custom learning steps
- store: unflipped/wrong phase/invalid rating에서 manager·DB 무호출
- mobile progress helper: 3 attempts/2 unique에서도 <=100
- 기존 study suites, web/mobile typecheck, build, targeted lint

## Rollback

코드-only revert. DB schema/data 변화 없음. pagination 오류가 사용자에게 노출되는 것은
의도한 fail-closed 동작이며 partial progress로 학습하는 것보다 안전하다.

## 완료 증거

- [ ] Red tests 추가
- [ ] 구현 green
- [ ] targeted/full study tests
- [ ] web/mobile typecheck
- [ ] production build
- [ ] targeted lint/diff check
- [ ] PR CI green
- [ ] `DOCS/DONE/STUDY-HARDENING/PHASE-1-GUARDRAILS.md` 이동
