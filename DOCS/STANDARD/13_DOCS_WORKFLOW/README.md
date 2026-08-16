# 13. 문서 워크플로

> 설계 문서의 라이프사이클과 `DOCS/` 폴더의 책임을 정한다.
> **현재 상태를 먼저 밝힌다**: `DOCS/` 의 md 104개(이번 표준 트리 19개 제외 시 85개) 중 YAML frontmatter 를 가진 파일은 **0개**이고,
> 메타 표기가 최소 4가지로 갈려 있다. 아래 §3 은 **앞으로 새로 쓰는 문서**에 적용한다.

## 목차
- [1. 폴더 책임](#1-폴더-책임)
- [2. 라이프사이클](#2-라이프사이클)
- [3. Frontmatter (신규 문서부터)](#3-frontmatter-신규-문서부터)
- [4. 파일명](#4-파일명)
- [5. 표준 문서(이 폴더)를 고칠 때](#5-표준-문서이-폴더를-고칠-때)
- [6. ADR](#6-adr)
- [7. 지금 어긋나 있는 것](#7-지금-어긋나-있는-것)

---

## 1. 폴더 책임

| 폴더 | 용도 | 라이프사이클 적용 |
|---|---|---|
| `DOCS/STANDARD/` | **영구 규범.** "무엇을 반드시 지켜야 하는가" | ❌ (status 없음) |
| `DOCS/DEPLOYMENT/` | 운영 절차서(런북) | ❌ |
| `DOCS/MOBILE/` | 모바일 가이드 시리즈 | ❌ |
| `DOCS/PAYMENTS/` | 결제 도메인 문서 | ❌ |
| `DOCS/TODO/` | **진행 중** 워크스트림 설계 문서 | ✅ |
| `DOCS/DONE/` | 머지 완료 워크스트림 | ✅ |

**판단 기준 한 문장**: *"이 문서는 특정 작업이 끝나면 의미가 다하나?"* → 예 = `TODO`/`DONE`, 아니오 = 나머지.

**규범과 설명서를 섞지 않는다.** `DOCS/STANDARD/AI-HUB.md` 는 한 기능의 설명서 겸 회고라 장르가 다르다 —
그 안의 **불변식**("버스는 의도만 나르고 돈은 나르지 않는다", "브리지는 정확히 한 번 마운트")은
[`01_ARCHITECTURE`](../01_ARCHITECTURE/modular_composition.md) 와 [`05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md) 로 올라와 있고, 문서 자체는 **확장 사례**로 남긴다.

## 2. 라이프사이클

```
설계 착수 → DOCS/TODO/<문서>.md 작성
         → PR 본문에서 그 문서를 인용
         → 머지 시 git mv DOCS/TODO/... DOCS/DONE/...
```

- 큰 워크스트림은 `DOCS/DONE/<AREA>/` 하위 폴더로 묶는다(`LEARNING-ENGINE`, `STUDY-HARDENING`, `OFFICIAL-DECKS`, `MARKETPLACE_ACQUIRE`, `PLAN`, `SEO`).
- **머지되면 옮긴다.** `TODO` 에 완료 표시가 붙은 문서가 남아 있으면 `TODO` 가 TODO 를 뜻하지 않게 된다(현재 10개 중 4개가 머리말에 완료 표시를 달고 있고, 그중 하나는 아예 "BOTH MERGED" 라고 적혀 있다).
- 핸드오프 문서(`HANDOFF-YYYY-MM-DD-*.md`)도 같은 규칙을 따른다. **git 에 추적시킨다** — 추적되지 않은 핸드오프는 다음 사람에게 존재하지 않는다.

## 3. Frontmatter (신규 문서부터)

`DOCS/TODO/`, `DOCS/DONE/` 의 새 `.md` 는 다음으로 시작한다.

```yaml
---
status: in_progress      # draft | in_review | approved | in_progress | implemented | deprecated
author: <email>
created: 2026-08-16      # ISO date
updated: 2026-08-16      # >= created
related_prs: ['#495']    # 빈 리스트 허용
---
```

- 기존 문서를 소급 변환하지 않는다. **고치는 김에** 붙인다.
- `DOCS/STANDARD/` 에는 붙이지 않는다(영구 문서).

## 4. 파일명

| 종류 | 형식 | 예 |
|---|---|---|
| 시점이 있는 설계·핸드오프 | `YYYY-MM-DD-kebab-case.md` / `HANDOFF-YYYY-MM-DD-slug.md` | `2026-08-01-compare-evaluate-feasibility.md` |
| 상시 유지 문서 | `SCREAMING-KEBAB.md` | `AI-MONETIZATION-REMAINING.md` |
| 순서 있는 시리즈 | `NN-NAME.md` 또는 `PHASE-N-NAME.md` | `00-MASTER.md` … `13-TESTING.md` |
| 표준 카테고리 | `NN_CATEGORY/README.md` | `04_DATABASE/README.md` |

## 5. 표준 문서(이 폴더)를 고칠 때

> **표준은 코드가 바뀔 때 같이 바뀐다.** 문서와 코드가 어긋나면 그 문서는 다음 사람을 틀리게 만든다 —
> 실제로 `DOCS/STANDARD/ARCHITECTURE.md` 의 *"Web re-exports shared stores/lib"* 한 줄이 사실이 아닌 채로 남아 있었다(실제로는 3가지 방식이 공존).

- 규칙을 추가/변경하면 **게이트 칸을 반드시 채운다.** 게이트가 없으면 `없음` 이라고 정확히 적는다 — 없다는 사실 자체가 정보다.
- 게이트를 새로 만들었으면 [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) 에도 줄을 추가한다.
- 규칙을 어기는 코드를 남겼으면 [`../01_ARCHITECTURE/modular_composition.md §7`](../01_ARCHITECTURE/modular_composition.md#7-지금-어긋나-있는-것-부채-목록--늘어나면-안-되고-줄어들기만-한다) 부채 표에 줄을 추가한다.
- **다른 저장소의 문서 경로를 인용하지 않는다.** 이 저장소에는 존재하지 않던 `DOCS/STANDARD/NN_*` 경로를 인용하던 곳이 4개 파일 있었다(`tools/check-arch.ts:5`, `tests/integration/README.md:3`, `supabase/migrations/081_marketplace_acquire_atomic.sql:4`, `DOCS/DONE/MARKETPLACE_ACQUIRE/DESIGN.md:12` — 마지막 것은 스스로 "(rictax repo)" 라고 적어 두었다). 이제 실재한다.
- 굵은 구조 변경(폴더 신설·규칙 폐기)은 ADR 로 남긴다(§6).

## 6. ADR

되돌리기 어렵거나 여러 카테고리에 걸치는 결정은 `DOCS/STANDARD/13_DOCS_WORKFLOW/decisions/NNNN-<slug>.md` 로 남긴다.
템플릿: [`decisions/0000-template.md`](decisions/0000-template.md)

**ADR 로 남길 만한 것**: 배포 파이프라인 변경 · 새 결제 채널 · 레지스트리 3벌 통합 · 웹/모바일 스토어 단일화 · 엣지 함수 CI 도입 · 표준 카테고리 신설.
**남기지 않아도 되는 것**: 평범한 버그 수정, 규칙의 문구 다듬기.

## 7. 지금 어긋나 있는 것

| 부채 | 규모 |
|---|---|
| YAML frontmatter 0/104, 메타 표기 4가지 혼재 | 신규 문서부터 §3 적용 |
| `DOCS/TODO` 에 완료 문서가 남아 있음 | 10개 중 4개(1개는 "BOTH MERGED") |
| 추적되지 않은(`??`) 핸드오프 문서 | `HANDOFF-2026-07-29-billing-ui-deploy.md` |
| `.github/workflows/README.md` 가 ci.yml 과 어긋남 | → [`../07_TESTING/GATES.md §5`](../07_TESTING/GATES.md) |
| 루트 `README.md` 가 Vite 스타터 템플릿 그대로 | 제품 설명이 없다 |
| `DOCS/OPS-READINESS.md` 가 현재 상태와 이력을 한 표에 겹쳐 담음 | 취소선 + ✅ 덧칠 |

## 관련 문서
[`../README.md`](../README.md) · [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md)
