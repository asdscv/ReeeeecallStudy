# 모바일 로케일 구조 드리프트 정합 + 가드 강화

> **Version**: 1.0 · **Created/Done**: 2026-05-28 · **Branch**: `worktree-i18n-locale-align`
> **트리거**: 사용자 — PR #143 리포트의 "남은 항목"(모바일 dead-key/extra ~1908 정리 + 가드 아티팩트) 진행.

## 근본 원인
- 모바일 8개 로케일이 구조적으로 드리프트: en↔비-en 키셋 상이(dead key, 리팩터 잔재). 특히 Guide(가이드) 화면은 `t(\`sections.${id}.${field}\`)` 동적 렌더 → 정적 가드가 커버 못 함. en+ko만 신구조, es/ja/zh/vi/th/id는 구구조 → 6개 언어 가이드가 영어 fallback.
- `i18n-key-usage` 스캐너가 `t('categories.'+v)`의 리터럴 프리픽스 `categories.`를 키로 오인 → allowlist 1건 잔존.

## 설계 (안전 원칙)
- **참조 원칙**: en은 fallback·개발 로케일 → 코드가 렌더하는 모든 키는 en에 존재. ∴ "en에 없는 로케일 키"는 현재 코드가 렌더하지 않음 ⇒ dead ⇒ prune 안전.
- **동적 키 정밀 해석**: Guide의 `SECTION_KEYS`×`ITEM_KEYS`(코드 config)에서 정확한 렌더 키셋 산출 → 광범위 정규식 대신 정확 집합으로 prune/verify.
- **fallback 0 우선, prune은 보수적**: 사용 키(정적+템플릿+concat)는 전 로케일 채움. dead-en 키 중 동적 네임스페이스 잔여분은 en 보존(오삭제 위험 회피).

## 작업
- **Fill**: 사용 키(동적 포함) 누락 분석 → Guide 49키(15 아이콘/이미지=en복사, 34 텍스트=8로케일 번역) 등 6로케일 294값 보강. 결과 used-key 누락 0.
- **Prune**: Guide `sections.*` 비-유효(구구조) 522키(전 로케일, en 포함) + en에 없는 orphan 906키(비-en) 제거. 결과 extra(orphan)=0.
- **Guard**: 스캐너 trailing-dot(concat) 키 무시 → web allowlist 완전 비움. 신규 (1)모바일 orphan 0 (2)guide 8로케일 parity 검사 추가.

## 검증 게이트 (모두 통과)
- web `tsc -b` 0 / mobile `tsc` 0 / 96 모바일 로케일 JSON 유효
- web vitest 139 pass: i18n-key-usage(web en·mobile 전8 static·mobile orphan 0·guide parity)·translation-keys(web 8 parity)
- 드리프트: extra(orphan)=0, used-key fill=0. 잔여 dead-en 39키(미참조, 무해, en 보존).
- DB/prod 변경 없음(로케일 데이터 + 테스트만).

## Zero-Defect 3-Phase
- Phase 1: 동적-키 분석기로 fill/prune 근본 산출. en 가이드 필수키 완비 검증([]).
- Phase 2: 사이드이펙트 — prune은 "en에 없는 키"만(참조 원칙) + Guide는 코드 config 정확집합. 사용 키 오삭제 0(fill 재검 0). 96 JSON 유효.
- Phase 3: 잔여 dead-en 39키는 동적 t() 네임스페이스라 en에서 prune 시 오삭제 위험 → 보존(무해). 가드가 재드리프트(orphan 재유입·guide 갭) 차단.

## 잔여 추적 (저위험)
- dead-en 39키(decks/marketplace/settings/study/history, 미참조): en-only 잉여. 동적 사용 확정 시 en에서 prune 가능하나 위험 대비 이득 낮아 보류. orphan=0·used fallback=0이라 사용자 영향 없음.
