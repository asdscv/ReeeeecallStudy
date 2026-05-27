# Deck native_language → multi-select (native_languages[])

> **Version**: 1.0 · **Created**: 2026-05-27 · **Branch**: `worktree-native-language-multiselect`
> **트리거**: 사용자 — 공식덱 규칙 "앞면=학습언어, 뒷면=모국어". reverse 단어덱이 모국어=영어여야 하는데 비-영어로 잘못 태깅됨(#2 영어설명 / #3 영어권용 분류 누락). 덱 모국어를 **다중선택(array)** 으로.

## 근본 원인
- 현 `decks.native_language TEXT` = 마이그 091이 "항상 비-영어 쪽"으로 backfill.
- 그러나 reverse 단어덱(X→EN: front=외국어, back=영어)은 **영어가 설명/모국어 측** → native='en'이어야 함. 현재 'ko/ja…'로 잘못됨.
- 마켓 필터는 **client-side**(`select('*')` 후 JS `filterListings`/`getNativeLanguage`). → 컬럼 타입 in-place 변경 시 **배포된 구버전 클라이언트 깨짐**.

## 설계 (무중단·additive·SSOT)
신규 컬럼 `native_languages TEXT[]` 추가(기존 `native_language TEXT` 유지·동기). 클라이언트는 배열 우선, 단일 폴백 → 구/신 클라이언트 모두 안전.

### Backfill 규칙 (manifest source/target/category 기반)
| 덱 | 조건 | native_languages | single(보정) |
|---|---|---|---|
| forward (EN→X) | source='en' | `[target]` | target |
| reverse vocab (X→EN) | target='en' AND category≠conversation | `['en']` | en |
| reverse 회화 (X→EN) | target='en' AND category='conversation' | `[source]`(=ko) | ko |
| user deck | - | `[native_language]` if set | 유지 |
- single `native_language` = `native_languages[1]`로 보정 → **구버전 클라이언트도 즉시 교정**(reverse 단어덱 'ko'→'en').

### 아키텍처 원칙
- **SSOT**: 백필 규칙은 manifest 단일 출처. `getNativeLanguages()` 하나가 배열/단일/태그 폴백을 캡슐화(DIP — 호출부는 배열만 의존).
- **OCP/플러그인**: 헬퍼가 우선순위(array→single→tag) 캡슐화 → 소스 추가/변경이 호출부 무영향.
- **무중단(SoC)**: DB additive + 클라이언트 폴백 → 배포 순서 독립.

## 작업 (단계별 커밋)
- C1 mig 092: `native_languages TEXT[]`(decks+listings), CHECK(요소 ∈ 8langs), GIN, manifest backfill, single 보정. idempotent.
- C2 dry-run: prod read-only로 각 덱 native_languages 미리보기(forward 322=[X]/reverse vocab 322=[en]/conv 5=[ko]).
- C3 shared: types(native_languages), `getNativeLanguages()`, `filterListings` 교집합, isLanguageListing, deck-store create/update, marketplace-store carry-over.
- C4 official-decks: DeckMetadataBuilder가 native_languages 산출 + gateway write(신규 공식덱).
- C5 web+mobile deck edit: 모국어 단일→다중 선택 UI(native_languages 쓰기 + single=first 호환).
- C6 Zero-Defect 3-Phase 검증.

## 검증 게이트
- web tsc -b 0 / vitest 회귀 0 / mobile tsc 0
- backfill dry-run: 322/322/5 분포 일치, native_languages 요소 전부 허용집합
- 구버전 클라이언트 안전(단일 컬럼 유지·보정), 신버전 배열 우선
- 마켓 native 필터: reverse 단어덱이 en으로 필터됨(#3), ko 필터 시 뒷면-한국어 덱만(#2)
