# i18n: 공식덱 모국어 메타데이터 + 마켓플레이스 필터 + 전면 번역 보강

> **Version**: 1.0 · **Created**: 2026-05-28 · **Branch**: `worktree-i18n-deck-marketplace`
> **트리거**: 사용자 — (1) 공식덱 제목/설명이 전부 영어 → 모국어로. (2) 마켓 "고급" 토글을 "필터"로 바꾸고 카테고리·인증됨·모국어를 그 패널 안에서 필터. (3) 마켓/빠른학습/대시보드/덱버튼/카드템플릿/기록/업적 화면의 미번역·하드코딩 문자열을 web+mobile 8개 로케일 전부 자연스러운 번역으로.

## 근본 원인
1. **공식덱 메타**: `DeckMetadataBuilder`가 제목/설명을 **영어 고정** 생성(`LANG_NAME_EN`, `buildName`/`buildDescription`). prod 649덱 전부 영어. 체크섬은 CSV 카드행만 해시 → `apply` 재실행해도 제목 변경은 **noop**(전파 안 됨).
2. **마켓 필터**: web `SearchFilters`·mobile `MarketplaceScreen`이 카테고리·인증(verified)을 상단에 항상 노출, "Advanced(고급)" 토글 별도. 사용자는 "필터" 단일 토글 안에 카테고리·인증·모국어가 모이길 원함.
3. **미번역**: web은 `t(key,{defaultValue})` 폴백으로 누락키가 영어로 노출(sortTrending/sortTopRated/verifiedOnly/advancedFilters/resetFilters 등). mobile은 카드수("00 cards"/"New"/"Review")·카테고리/정렬 라벨이 **하드코딩**.

## 설계 (SoC · SSOT · 무중단)

### Task 1 — 공식덱 모국어 메타 (official-decks 패키지)
- **표시 언어 규칙**: 제목/설명 언어 = **언어쌍의 비영어 측**(`source==='en' ? target : source`) = 학습자 모국어. forward(en→X)·reverse(X→en)·conversation(ko→en) 모두 X(또는 ko). → 영어 제목 0.
- **SSOT 로컬라이즈 모듈** `DeckMetadataI18n.ts`: 8개 언어 × {카테고리 제목 템플릿, 방향 접미사, 설명}. 순수 데이터+`fill()` 포매터. `DeckMetadataBuilder`가 audience 언어로 제목/설명 산출(색/아이콘/태그/카드 불변 → 체크섬·필터 무영향).
- **방향 접미사**: ` ({src} → {tgt})` 를 모국어 언어명으로(예 ko: "(영어 → 한국어)"). forward/reverse 동일 베이스명 구분.
- **prod 반영**: 체크섬 noop 우회를 위해 신규 ops 경로 `relocalize` CLI 커맨드 + `gateway.updateMetadata(deckId,name,description)`. 모든 공식덱(deterministic id)에 대해 `decks.name/description` + `marketplace_listings.title/description` 직접 UPDATE(service-role, RLS 우회). 멱등·재실행 안전. 카드/체크섬/매니페스트 불변.
- **테스트**: DeckMetadataI18n 단위(8언어 forward/reverse/exam/conversation 스냅샷), builder가 영어 제목을 더 이상 만들지 않음 회귀.

### Task 2 — 마켓플레이스 "필터" 토글 (web + mobile)
- "Advanced/고급" → **"필터/Filter"** 리네임(i18n 키 `filters`). 토글 ON 시 패널에 **카테고리 · 인증됨(verified) · 모국어 · (기존 study level/학습언어/공유모드/기간/카드수/평점)** 노출.
- 상단 바: 검색 + 정렬 + 필터 토글(활성 개수 뱃지)만. 카테고리·인증 칩을 패널로 이동.
- mobile 카테고리/정렬을 i18n 키로 전환(하드코딩 제거). 카운트 뱃지에 study level/native 포함.

### Task 3 — 전면 번역 보강 (web public/locales 8 + mobile i18n/locales 8)
- web `marketplace.json`: `filters, resetFilters, verifiedOnly, sortTrending, sortTopRated, minCardCount, minRating, dateRange*, shareModeFilter, popularTags, category(헤더)` 등 누락 키 추가.
- mobile: `DecksListScreen`/`StudySetupScreen` 카드수("{{count}} cards","New {{count}}","Review {{count}}")·`MarketplaceScreen` 카테고리/정렬 라벨·카운트 i18n화.
- 대시보드 빠른학습 진입 섹션·다음 목표, 덱 Help/AI Generate/New Deck, 카드 템플릿 Front/Back/Filter/Created, 기록·업적 화면: web+mobile 양쪽 점검 후 누락키 보강 + ko/ja/zh/es/vi/th/id 자연어 번역.
- **게이트**: `translation-keys.test.ts`(web 8 로케일 키 parity) 통과 필수 → 신규 키는 8개 web 로케일 전부.

## 작업 (단계별)
- C1 official-decks: DeckMetadataI18n + builder + relocalize cmd/gateway + 테스트 → tsc/vitest green.
- C2 prod relocalize 적용(read 검증 → apply → 재검증). 영어 제목 0 확인.
- C3 마켓 필터 web+mobile 재구성 + i18n 키.
- C4 web 8로케일 marketplace 누락키 + mobile 하드코딩 제거.
- C5 대시보드/덱버튼/템플릿/기록/업적 web+mobile 점검·보강(8로케일).
- C6 Zero-Defect 3-Phase: tsc(web/mobile/official-decks) 0, web vitest 회귀0(vs main baseline), translation-keys parity 0 누락, mobile tsc 0.

## 검증 게이트
- web `tsc -b` 0 / web vitest 회귀 0(로컬 pre-existing 제외, COUNT 비교) / `translation-keys.test.ts` green
- mobile `tsc` 0
- official-decks `tsc` 0 / vitest green / 신규 i18n 테스트 green
- prod: `SELECT count(*) WHERE name ~ '[(]EN'` = 0 (영어 제목 잔존 0), 샘플 8언어 육안 확인

---
## 구현 결과 (2026-05-28 완료)

### Task 1 — 공식덱 모국어 메타 (완료 + prod 반영)
- `DeckMetadataI18n` SSOT(8언어 × LANG_NAMES 8×8 + 카테고리/방향/설명 템플릿). audienceLanguage = 비영어 측.
- `DeckMetadataBuilder` 영어 고정 buildName/Description 제거 → 로컬라이즈 모듈 사용. 색·아이콘·태그·카드·체크섬 불변(필터/매니페스트 무영향).
- `DeckImportGateway.updateMetadata` + Supabase/Pg 구현 + `relocalize` CLI 커맨드(`--dry-run` 지원). 카드/체크섬 불변, name/description + listing title 인플레이스 갱신 → 체크섬 noop 우회.
- **prod 적용**: service-role로 649덱 전부 갱신(updated 649 / missing 0 / failed 0). 영어 제목 0(SELECT 검증), listing/deck name parity 0 mismatch.
- 테스트: DeckMetadataI18n 7건 + 영어 방향 회귀 가드, builder 10건, executeUseCase 4건 — 모두 통과(110 pass).

### Task 2 — 마켓 필터 토글 통합 (완료 web + mobile)
- 'Advanced/고급' → 'Filter/필터' 리네임. 카테고리·인증됨(verified)·모국어를 상단에서 패널 안으로 이동(상단은 검색 + 정렬 + Filter 토글만).
- `countActiveFilters` 갱신: category 포함(패널로 이동했으므로 뱃지 반영). 마켓플레이스 discovery 테스트 198건 통과(parity 포함).
- 모바일도 동일 구조 + activeFilterCount에 category·native 포함, 카드 통계 행 i18n('00장 · 👁 N · 사용자 N명').

### Task 3 — 8개 로케일 자연스러운 번역 (web + mobile)
- web `marketplace.json` 8로케일: filters/categoryLabel/verifiedOnly/resetFilters/sortTrending/sortTopRated/minCardCount/minRating/dateRange*/shareModeFilter/allModes/popularTags 신설(기존 defaultValue 영어 폴백 제거).
- mobile 로케일: common.achievements/goals(웹에서 포팅 → 16 badge 맵·5 goal 카테고리), dashboard.quickStudy, decks.template.{title,subtitle,newBtn,empty,emptyDesc,summary,card.noStudyRecord}, study.setup.noDecks, history.tabs+sessionsPerDay, marketplace.filters/categoryLabel 추가.
- 모바일 컴포넌트 i18n 와이어업: Dashboard(Quick Study CTA + 덱 카드 stats), DecksList(Help/AI Generate/New Deck + 카드 stats + No study record), StudySetup(카드 stats + No decks yet), Achievements(전체 — useTranslation 신규), TemplatesList(Front/Back/Created summary + 헤더), StudyHistory(tabs + Session List + Today/Yesterday + sessionsPerDay + Unknown Deck).
- formatDateLabel은 i18next.t 사용 + toLocaleDateString 로케일도 i18n 언어에 맞춤.

### Zero-Defect 3-Phase 감사
- Phase 1: tsc/vitest/parity green, prod 적용 후 영어 제목 0 검증.
- Phase 2: countActiveFilters 변경 사이드 이펙트(테스트 갱신 후 198 pass), 마켓 필터 UX 동일 흐름 유지(검색 + 정렬은 상단, 필터만 패널 — 사이드 이펙트 0).
- Phase 3: 보안/메모리 — relocalize는 멱등·재실행 안전, service-role 직접 UPDATE는 기존 import_official_deck와 동일 권한, RLS 우회. 빈 listings 매칭은 무에러 no-op.
