# 모바일 로케일 완전 parity + 별칭 인식 가드

> **Version**: 1.0 · **Created/Done**: 2026-05-28 · **Branch**: `worktree-i18n-dead-en-parity`
> **트리거**: 사용자 — PR #144 리포트의 마지막 보류 항목(dead-en 39키) 진행.

## 근본 원인 (정밀 재조사)
직전 라운드 "dead-en 39키(미참조)"로 보류했으나, 전수 조사(코드 참조·동적 템플릿/concat·labelKey 상수) 결과 **일부는 실제 사용 중**이었음:
- 원인: `i18n-key-usage` 스캐너가 다중/별칭 `useTranslation`(예 `const { t } = useTranslation('decks')` + `const { t: tm } = useTranslation('marketplace')`)을 모호 처리해 bare key를 통째로 skip → DeckEditScreen `edit.*`가 누락 분석에서 빠짐.
- 결과: edit.*(10) + Settings tts.*(2)가 en+ko에만 있고 6개 언어에 없어 fallback. `marketplace.nativeLanguage.multiHint`는 코드 사용인데 en 포함 전 로케일 누락.

## 작업
- **분류**: 39키 → USED 12(fill) / DEAD 27(prune). 안전성: 각 키에 대해 (a) 별칭 인식 t-call (b) 동적 패턴(`modes.${}`, `sections.${}` 등) (c) 정확 인용 리터럴(labelKey 상수)을 전수 확인. paranoid concat-prefix 검사로 `stats.${}`/`detail.${}` 동적 생성 없음 확인.
- **Fill**: USED 12키 → es/ja/zh/vi/th/id 자연어 보강. multiHint → 전 8로케일(en 포함) 추가.
- **Prune**: DEAD 27키 → 보유 로케일 전부 제거.
- **결과**: 모바일 8로케일 ↔ en **완전 parity (missing 0 / extra 0)**.
- **가드**: 스캐너 별칭 인식(distinct alias→ns 해석; 동일 별칭 다중 ns는 모호→bare skip, false positive 0). 모바일 orphan/guide 부분검사 → **전체 parity 검사**로 통합(웹 translation-keys 동급).

## 검증 게이트 (모두 통과)
- web `tsc -b` 0 / mobile `tsc` 0 / 96 모바일 로케일 JSON 유효
- web vitest 138 pass: i18n-key-usage(별칭인식 web en·mobile static all-8·**mobile full parity**) + translation-keys(web 8 parity)
- DB/prod 변경 없음

## Zero-Defect 3-Phase
- Phase 1: 별칭 인식 분석기로 USED/DEAD 정밀 분류. 정확 인용 리터럴 교차검증으로 labelKey 상수(tts.deviceVoice) 사용 포착.
- Phase 2: 사이드이펙트 — 별칭 스캐너가 same-alias-rebind(landing+auth 동일 파일)에서 false positive 발생 → 모호 별칭 skip 규칙으로 해결(0 false positive). prune은 코드 미참조+동적 불일치 전수 확인분만.
- Phase 3: parity 가드가 양방향(missing/extra) 전 네임스페이스 드리프트를 잠금. 신규 키 누락·orphan·구조 드리프트 모두 CI 차단.

## 결과
4라운드에 걸친 i18n 추적 항목 **전부 해소**. 모바일 로케일은 이제 웹과 동일하게 en 기준 완전 parity가 CI로 강제되며, 별칭 인식으로 다중 ns 사용 사각지대까지 커버.
