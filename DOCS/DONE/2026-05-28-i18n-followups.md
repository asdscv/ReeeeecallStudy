# i18n 후속작업: 모바일 잔여 하드코딩 + 사용키 가드 + 공식덱 native_languages 정합

> **Version**: 1.0 · **Created**: 2026-05-28 · **Branch**: `worktree-i18n-followups`
> **트리거**: 사용자 — 직전 PR(#141) 마무리 리포트의 후속 권고를 "싹다 동일한 수준으로" 진행.

## 범위 (A·B·C·D)

### A — 모바일 잔여 하드코딩 i18n (자연어 8로케일)
- `CardEditScreen` (i18n 전무): 헤더(Edit/New Card), 필드 라벨/플레이스홀더(Front/Back/Question or term…), Tags, Save/Add/Add & Create Another, Alert(Error/empty/saveError) → `decks.cardEdit.*`.
- `TemplateEditScreen` (i18n 전무): 헤더, Template Name, Fields, Field name/desc, Up/Down/Remove, TTS, + Add Field, Front/Back Layout, Card Preview, No fields…, Save/Create/Saving, 기본 필드명 Front/Back, Alert 8종 → `decks.template.*` 확장.
- `StudySetupScreen`: Alert(Select a Deck/No Cards/Error) + Shuffle → `study.setup.*` 확장.

### B — 모바일 i18n "사용키 커버리지" 가드 (parity 대체)
- 현 모바일 로케일은 **구조적 드리프트**(en↔비-en 키셋 상이, 리팩터 잔재, dead key) — 총 missing 768 / extra 1908. ko만 en과 완전 일치. → 웹식 strict parity 테스트는 현실적으로 불가(품질 저하 없는 2676키 정리는 별도 프로젝트).
- 대신 **사용키 존재 가드**: 모바일 소스의 정적 `t('literal')` 키(+namespace 추론)가 `en`·`ko` 로케일에 실제 존재하는지 검증. "코드가 참조하는데 로케일에 없는 키"(영어/raw 폴백 버그) 회귀 차단. dead key/extra는 무시(가드 대상 아님). 동적(템플릿리터럴) 키·ns 추론 불가 파일은 skip(false positive 0).

### C — 웹 i18n 사용키 가드 (defaultValue 마스킹 방지)
- 웹 소스 정적 `t('literal')`/`t('ns:key')` 키가 `en` 로케일에 존재하는지 검증(웹은 8로케일 parity 유지 중 → en 존재 = 전 로케일 존재). `defaultValue`로 누락키가 영어로 새는 패턴 회귀 차단.
- B·C는 web vitest 한 파일(`i18n-key-usage.test.ts`)에 통합(모바일은 자체 vitest 없음 → fs로 모바일 소스/로케일 스캔). 기존 레거시 누락은 명시 allowlist로 grandfather(있을 경우), 신규 누락은 fail.

### D — 공식덱 native_languages 표시언어 정합 (코드 + prod)
- 문제: reverse 단어덱(X→en)은 콘텐츠가 영어 어휘인데 native_languages=['en']으로 태깅(2026-05-27 결정) → 제목은 비영어(학습자 모국어)로 표시 → 마켓 native 필터와 표시언어 불일치(한국어 사용자가 native=ko 필터 시 ko→en reverse 덱이 안 보임).
- 결정: **native = 언어쌍의 비영어 측(학습자 모국어)으로 통일** = 표시언어와 정합. reverse 단어덱도 X로. (이 덱들은 영어 어휘 학습용이므로 영어권 대상 분류가 부정확했음.)
- 변경: `DeckMetadataBuilder` nativeLanguages 규칙(reverse vocab `['en']`→`[source]`) + 테스트 갱신. migration 093(공식 reverse vocab 덱 native_language/native_languages 재backfill, idempotent) + prod 적용.

## 작업
- C1 A: locale 키 8로케일 author + 3개 화면 wire → mobile tsc 0.
- C2 D: builder + 테스트 + mig093 + prod 적용 + 검증(reverse vocab native=비영어).
- C3 B/C: i18n-key-usage 테스트 + 누락 fix/allowlist → web vitest green.
- C4 Zero-Defect 3-Phase.

## 검증 게이트
- mobile `tsc` 0 / official-decks `tsc`+vitest green / web `tsc -b`+vitest green(신규 가드 포함)
- prod: 공식 reverse vocab 덱 native_language = 비영어 측, 마켓 native 필터 정합 육안 확인

---
## 구현 결과 (2026-05-28 완료)

### A — 모바일 잔여 하드코딩 (완료)
- `CardEditScreen`(i18n 전무)·`TemplateEditScreen`(i18n 전무, 메인+LayoutSection+CardPreview)·`StudySetupScreen` i18n 와이어업. decks.cardEdit(17키)·decks.template 확장(~58키, style 칩·Alert 8종·기본 필드명 포함)·study.setup 확장 — 8로케일 자연어. mobile tsc 0, 세 화면 잔여 0.

### D — native_languages 표시언어 정합 (완료 + prod)
- `DeckMetadataBuilder`: nativeLanguages = 비영어 측 통일(reverse vocab `['en']`→`[source]`). 테스트 갱신. migration 094(idempotent) 작성 + prod 적용: reverse vocab 322덱 native 'en'→모국어, 분포 ko=97/그외 92(합 649), native='en' 잔존 0. import RPC는 native_languages 미소비(2026-05-27 결정대로 backfill migration이 SSOT).

### B/C — 사용키 커버리지 가드 + 누락키 보강 (완료)
- `i18n-key-usage.test.ts`(web vitest): 정적 t() 키 존재 검증 ratchet(web=en, mobile=en+ko). 동적/모호 skip → false positive 0.
- 측정: 초기 web 131 / mobile 20 누락(defaultValue로 영어 노출). **web 75 / mobile 20 보강(8로케일)** 후 가드 통과. admin·api-docs(~56, 내부 도구)는 allowlist(ratchet 유지).
- `filters` 키 충돌(PR1의 string vs `filters.reset`) → `{label,reset}` 객체로 재구성 + 컴포넌트 `t('filters.label')`.
- 게이트: web tsc -b 0 / mobile tsc 0 / web vitest(i18n-key-usage·translation-keys parity·marketplace-discovery) green / official-decks 110 pass.

### B 범위 결정 (strict parity 대신 used-key 가드)
- 모바일 로케일은 구조적 드리프트(en↔비-en 키셋 상이, dead key) — 총 missing 768 / extra 1908(ko만 en 일치). strict full-parity 강제는 ~2676키 정리(품질 저하 없는 번역) 필요 → 별도 프로젝트. 본 PR은 "코드가 실제 쓰는 키" 커버리지로 회귀를 차단(더 직접적인 버그 클래스 방어).

### 잔여 추적 (allowlist, 후속)
- web `admin:*`(~55)·`api-docs:*`(1): 내부 도구 화면. defaultValue 영어 노출. 별도 i18n 패스 권장.
- 모바일 로케일 구조적 드리프트(dead key/extra 1908): 코드-참조 키 추출 후 dead key prune + 비-ko 로케일 정렬 별도 작업.
