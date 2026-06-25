# i18n 추적항목 클린업: admin/api-docs 번역 + 모바일 전로케일 갭 + import RPC native_languages

> **Version**: 1.0 · **Created/Done**: 2026-05-28 · **Branch**: `worktree-i18n-tracked-cleanup`
> **트리거**: 사용자 — PR #142 리포트의 "남은 추적 항목" 3건을 모두 진행.

## 설계 원칙
- SSOT 유지(로케일 데이터·가드 테스트 단일 출처), 무중단(additive·idempotent), 회귀 차단(가드 강화).
- "테스트를 위한 테스트" 금지: 실제 fallback 버그를 막는 사용키 가드 + 실제 prod 검증.

## 작업 (3 items)

### Item 1 — web admin/api-docs i18n (8로케일)
- `AdminAuditPage`·`AdminUsersPage`·`AdminOfficialPage`·api-docs 가 `defaultValue`로 영어 노출하던 키: admin 57개 + api-docs 1개. 영어를 소스에서 추출(또는 키명에서 정확히 author) + 8로케일 자연어 번역.
- 관리자 대시보드는 운영자(주로 ko) 본인 화면 → ko 번역 가치 높음. parity 제약상 8로케일 모두 추가.
- `i18n-key-usage.test.ts` allowlist에서 `admin:`/`api-docs:` 제거 → 가드 전체 통과.

### Item 2 — 모바일 전 로케일 사용키 커버리지
- 측정: code-used 정적 키가 en=0·ko=0 누락이나 es/ja/zh/vi/th/id 각 40개 누락(= 6개 언어에서 fallback 영어 노출). errorBoundary·sessionKicked(세션 제한 UI)·account(삭제/로그아웃)·haptics·tts·study(session/rating/summary/setup) 등.
- 40키 × 6로케일 = 240값 자연어 보강.
- `i18n-key-usage` 모바일 검사를 en+ko → **전 8로케일**로 강화. 어떤 언어도 code-used 키에서 fallback 없도록 회귀 차단.

### Item 3 — import_official_deck가 native_languages 소비 (migration 095 + prod)
- 기존: RPC가 learning_language만 기록, native_languages는 backfill migration(091/092/094)으로만 채워짐 → 신규/재import 시 stale/NULL.
- 변경: 090 함수 body 충실 재현 + `v_native_langs := p_deck->'native_languages'`. decks·marketplace_listings INSERT/ON CONFLICT에 `native_languages` + scalar `native_language(=[1])` 기록. payload 누락 시 `COALESCE`로 기존값 보존, 빈배열 `NULLIF`.
- gateway는 이미 `native_languages`(=비영어 측, DeckMetadataBuilder)를 p_deck에 전송 → 경로 완성.
- prod 적용 + **self-rollback 라운드트립 검증**(테스트 manifest로 RPC 호출 → deck/listing 모두 native_languages=['ko']·scalar='ko' 확인 → RAISE로 롤백, residue 0). 통합 테스트에 native_languages 어서션 추가(CI).

## 검증 게이트 (모두 통과)
- official-decks `tsc` 0 / 110 unit tests
- web `tsc -b` 0 / mobile `tsc` 0
- web vitest 200 pass: i18n-key-usage(web en + mobile 전8로케일)·translation-keys(web 8로케일 parity)·marketplace-discovery
- prod: import_official_deck native_languages 라운드트립 OK(residue 0)

## Zero-Defect 3-Phase
- Phase 1: 측정→보강→재측정(web 누락 admin/api-docs만 남음=allowlist, mobile 0). RPC prod 검증.
- Phase 2: 사이드이펙트 — `filters`류 키 충돌 없음(이번엔 신규 충돌 0), translation-keys parity 유지(admin 8로케일 동시 추가), native COALESCE로 import noop/누락 시 기존값 보존(wipe 방지).
- Phase 3: 보안/엣지 — migration 095는 SECURITY DEFINER·search_path 고정(083/090 동일), service_role GRANT 유지. 빈 native_languages·payload 누락·재import(checksum noop) 엣지 모두 안전. self-rollback 검증으로 prod residue 0.

## 남은 추적 (저위험·후속)
- 모바일 로케일 dead-key/extra(~1908): code-미참조 orphan 키. 사용자-facing 무해(전 로케일 사용키는 본 PR로 커버). dynamic-key 오삭제 위험으로 보수적 prune은 별도 정리 권장.
- web `marketplace:categories.`: 동적 키 `t('categories.'+v)` 스캐너 아티팩트 → 가드 allowlist 1건 유지(실제 키 아님).
