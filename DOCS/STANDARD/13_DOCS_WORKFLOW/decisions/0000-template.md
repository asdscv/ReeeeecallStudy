# NNNN. <결정을 명령형 한 문장으로>

- **Status**: Proposed | Accepted | Superseded by [NNNN](NNNN-....md) | Deprecated
- **Date**: YYYY-MM-DD
- **Deciders**: @handle (72시간 무응답이면 `lazy-consensus`)
- **Related**: PR #..., 마이그레이션 NNN, 이전 ADR [NNNN](NNNN-....md)
- **Category**: 01_ARCHITECTURE | 04_DATABASE | 09_DEPLOYMENT | ...

## Context

문제 상황과 제약. **이 결정이 왜 지금 필요한지**, 대안이 왜 부족한지.
가능하면 측정값을 인용한다 — 프로덕션 실측 수치, 위반 건수, 사고 기록, 테스트 통계.
(이 저장소의 마이그레이션 헤더와 커밋 본문이 그런 서술의 표본이다.)

## Decision

채택한 선택지를 한 문단으로.

이어서 구현 세부:

- 추가/변경/삭제되는 규칙과 그것이 사는 표준 문서 경로
- **새로 생기는 게이트** — 테스트 파일명 또는 CI job/step 이름. 없으면 "없음"이라고 정확히 적는다
- 기존 위반 건수와 처리 방안 (즉시 수정 / baseline 래칫 / 부채 표 등재)
- 마이그레이션 일정 (있다면)

## Consequences

### 긍정
-

### 부정 / 비용
-

### 되돌리는 법
이 결정을 되돌리려면 무엇을 해야 하는가. 되돌릴 수 없다면 그렇게 적는다.

## Follow-up

- [ ] `DOCS/STANDARD/<카테고리>` 갱신
- [ ] `DOCS/STANDARD/07_TESTING/GATES.md` 에 게이트 등재
- [ ] `DOCS/STANDARD/01_ARCHITECTURE/modular_composition.md §7` 부채 표 갱신
