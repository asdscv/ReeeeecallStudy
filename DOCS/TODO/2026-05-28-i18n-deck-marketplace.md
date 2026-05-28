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
