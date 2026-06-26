# 간편 만들기 필드갯수 재설계 + AI 키 안내 (완료)

> **Date**: 2026-06-26 · **Status**: ✅ 완료·prod 배포(web 빌드 + mobile OTA)
> **PR**: #171(develop) → #172(main) · 마이그 없음(클라 전용)

## 배경 (고객 피드백)
간편 만들기(Quick Create)가 언어별 프리셋(영어 단어 / 중국어 단어)이라 제한적 → "언어가 아니라 **필드 갯수**로 고르게 하면 되지 않나". + 덱 **설명** 추가. + AI 자동생성 페이지에 "프로바이더별 본인 API 키 입력 필요" 안내.

## 변경

### 1. 간편 만들기 = 필드 갯수 프리셋
- `packages/shared/lib/default-templates.ts` **재작성**: `QUICK_PRESETS`(f1b1~f1b4 = 앞1·뒤1~앞1·뒤4) + `presetFieldSpecs(preset)` + `buildPresetTemplate(preset)`. 구 `presetIdForTemplate`/`fieldLabelId` 제거(타 소비처 없음).
- **시드 템플릿 의존 제거**: 제출 시 `template-store.findOrCreatePresetTemplate(preset)` — 안정 이름 `간편 카드 (1·N)` + `UNIQUE(user_id,name)` 재사용, 동시성 레이스 폴백 재조회 → `createDeck({name, description, default_template_id})` → `createCards`.
- **덱 설명(선택)** 입력 추가(`createDeck`는 이미 `description` 지원).
- 카드 입력 라벨 = **위치 기반**(앞면 / 뒷면 / 뒷면 2 …), 저장 필드명과 일치.
- web `QuickCreateModal.tsx` + mobile `QuickCreateScreen.tsx` 동일 적용. 기존 디자인 테마 + testid(`qc-deck-name`/`qc-card-0-0`/`qc-submit`) 유지. 첫 프리셋에 "기본" 뱃지.
- 구 시드 템플릿(기본/영어/중국어, mig 097)은 기존 유저에게 잔존하나 **간편 만들기에서 더는 노출 안 함**(다른 덱이 쓰는 중일 수 있어 삭제 안 함).

### 2. AI 자동생성 안내
- web `ConfigStep.tsx` 상단 정보 배너(`ai-generate.config.apiKeyNotice`, 8개 언어).
- mobile `AIGenerateScreen.tsx` 안내(해당 화면은 기존부터 useTranslation 없는 전체 하드코딩 영문 → 안내도 영문 일관).

### 3. i18n
- `decks.quickCreate`: `deckDescription`(+Placeholder), `presetSummary`("앞면 {{front}} · 뒷면 {{back}}"), `basicLabel`, `fields.frontN`/`backN` — 8 web + 8 mobile.
- `ai-generate.config.apiKeyNotice` — 8 web.

## 독립 적대적 감사 → HIGH 2건 수정
1. `selectPreset`가 `createdTemplateId`뿐 아니라 **`createdDeckId`도 리셋**: 부분 실패 후 프리셋 전환→재시도 시 구 shape 템플릿으로 만든 덱 재사용 → `deck.default_template_id`(구)와 카드(신) 불일치 방지. (web+mobile)
2. 성공 후 **`useDeckStore.getState().invalidate('templates')`**: 신규 템플릿은 template-store에 기록 → deck-store의 별도 templates 캐시는 stale → 특히 mobile CardEdit가 deck-store에서 템플릿 해석 시 fallback 기본템플릿으로 카드 저장되는 버그 방지. (web+mobile)

## 검증
- 타입체크 0(web/mobile), i18n 파리티+사용키 138/138, 신규 빌더 단위 테스트 `default-templates.test.ts` 5/5, card-store-bulk 8/8(공유경로 mock 보강), e2e testid 보존.
- CI 6/6(#171, #172). 배포: web Cloudflare 빌드 success + mobile EAS OTA success.

## 남은 nit(미수정·기록)
- mobile `AIGenerateScreen`은 화면 전체가 하드코딩 영문(pre-existing) — 추후 i18n화 시 안내도 포함.
- `createCards` 멀티청크(>200장) 부분실패 재시도 중복은 기존 `card-store` 동작이며 간편만들기는 통상 <200장.
