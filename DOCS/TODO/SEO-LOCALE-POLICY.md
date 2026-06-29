# Design: Extensible SEO Locale Policy (insight 언어 정책)

> Author: autonomous agent · Branch: `feat/seo-locale-policy` · Status: IN PROGRESS
> Goal: 인사이트(블로그) 자동생성을 **한/영만**으로 좁히고, 기존 마이너 언어 페이지를
> **noindex**(삭제 X)하여 site-wide 품질 희석을 제거한다. **나중에 1줄로 재확장 가능**하도록
> 플러그인형 단일 진실원천으로 설계한다.

## 1. Why (근거 요약)
- 진단(별도 조사, 1차 출처 + GSC + 직접 측정): 색인은 됨(685), **병목 = 크롤 수요 붕괴 = 얇은
  AI 양산(200~300단어) × 자동번역 8언어 × 신규 .xyz 권위 부족**. 수동 조치 없음(=알고리즘).
- 구글 스팸정책: **사람 검수 없는 자동번역 = scaled content abuse**. 8언어 = 도달 8배가 아니라
  희석 신호 8배. 사이트 전체 품질 분류기가 좋은 한/영 페이지까지 끌어내림.
- 따라서: ① 신규 생성 한/영만 ② 기존 마이너언어 noindex(드래그 제거) ③ 글 깊이/독창성 강화.

## 2. 문제: locale 결합이 산재 (SoC 위반)
| 소스 | 의미(혼재) | 소비처 |
|------|-----------|--------|
| `config.js: LOCALES` (8) | "생성" 대상 | content-pipeline, topic-generator |
| `seo/constants.js: SUPPORTED_LOCALES` (8) | "SEO/색인 신호" 대상 | helpers(hreflang/og), sitemap(static), json-ld |
| (없음) | "색인 가능" 개념 부재 | — robots는 전부 하드코딩 index,follow |

→ "생성/색인/UI"가 한 배열에 뭉쳐 있어 한 축만 바꿀 수 없음. robots 신호도 2곳
(`buildCommonHead <meta>` + `buildSeoResponse X-Robots-Tag`)에 하드코딩.

## 3. 설계: 단일 진실원천 `worker-modules/locale-policy.js`
플러그인 레지스트리 — 로케일별 **3개 독립 capability** 플래그.
```
LOCALE_REGISTRY = { en:{generate,index,ui}, ko:{...}, zh:{generate:false,index:false,ui:true}, ... }
```
- `generate` — 데일리 파이프라인이 생성 (현재 en,ko)
- `index` — 검색엔진에 색인 신호 송출: sitemap·hreflang·robots (현재 en,ko)
- `ui` — 사람에게 서빙/렌더 (현재 8개 전부 — **사용자 도달 유지**)

파생 뷰 + 술어: `GENERATED_LOCALES / INDEXABLE_LOCALES / UI_LOCALES`, `isGenerated/isIndexable/isUiLocale`.
불변식: `DEFAULT_LOCALE`(en)는 generate+index여야 함(fail-fast).

**SOLID 매핑**
- **SRP/SoC**: 로케일 정책 결정은 이 모듈 단 한 곳. 소비자는 "정책을 질의"만.
- **OCP**: 재확장 = 레지스트리 플래그 1줄 토글. 소비 코드 무변경.
- **DIP**: `config.js`/`seo/constants.js`가 정책 모듈에 의존(역전). 하위 핸들러는 추상(`isIndexable`)에 의존.

### 재확장 플레이북 (권위 확보 후)
- 스페인어 발행 재개 → `es.generate = true`
- 일본어 색인 허용 → `ja.index = true`
- **다른 파일 수정 0.**

## 4. 변경 맵
| 파일 | 변경 |
|------|------|
| `locale-policy.js` (신규) | 레지스트리 + 파생 + 술어 + 불변식 |
| `config.js` | `LOCALES = GENERATED_LOCALES`, `DEFAULT_LOCALE` 재수출 (DIP) |
| `seo/constants.js` | `SUPPORTED_LOCALES = INDEXABLE_LOCALES` (색인 신호 대상) |
| `seo/helpers.js` | `buildHreflangTags(…, locales=SUPPORTED)` 인자화 · `buildCommonHead(lang, robots)` robots 인자화 |
| `seo/html-builder.js` | `ROBOTS_INDEX/ROBOTS_NOINDEX` 상수 · `buildHtmlDocument({robots})` 스레딩 |
| `seo/handlers/content-detail.js` | 슬러그 전 로케일 1쿼리 조회 → 요청‖en‖first · `availableLocales = 기사로케일 ∩ INDEXABLE` · 비색인 로케일 → noindex |
| `seo/handlers/content-list.js` | 비색인 `?lang=` → noindex · hreflang 인덱서블만 |
| `seo/sitemap.js` | articles: hreflang 인덱서블만 · 인덱서블 로케일 0개 기사는 sitemap 제외(noindex 페이지 미등재) |
| `content-pipeline.js` | IndexNow에 실제 발행 locale URL만(유령 ?lang 제거) · 폐기 sitemap ping 호출 제거 |
| `indexnow.js` | 폐기된 `pingSitemapUpdate`(google/bing 2023 종료) 제거 |
| `worker.js` | `/privacy-policy`·`/terms-of-service` 봇 soft-404 → 앱 셸 통과 |
| `prompt-builder.js` | ③ 깊이/독창성: 재탕 문구 크러치 제거 · 최소 길이 강제 · 구체 예시 요구 |

## 5. noindex 전략 (핵심 정합성)
한 페이지의 robots 신호는 **2채널 모두 일치**해야 함: `<meta name=robots>` + `X-Robots-Tag` 헤더.
→ 핸들러가 `robots` 1값 계산 후 `buildHtmlDocument`(meta)와 `buildSeoResponse`(header) 둘 다 전달.
- 비색인 로케일 상세/리스트: `noindex, follow`(링크는 따라가되 색인 X).
- sitemap·hreflang에서 비색인 로케일 제거(noindex 페이지를 sitemap에 넣지 않음 — 일관성).

## 6. 테스트 계획 (실문제 검증, 커버리지 채우기 금지)
- `locale-policy.test.js`: 파생 뷰=[en,ko], 술어, 불변식, ui=8.
- `hreflang.test.js`: 주어진 로케일만 발행 + x-default + 기본=인덱서블.
- `content-detail-noindex.test.js`: fetch 모킹으로 **ja 기사 → `X-Robots-Tag: noindex` + hreflang에 ja 제외** (실제 동작 검증).
- `sitemap-indexable.test.js`: fetch 모킹으로 비색인 단독 기사 제외 + hreflang 인덱서블만.

## 7. 비기능/CI
- **Docker**: 이 프로젝트엔 Dockerfile 없음(실행 중 도커는 별개 rictax 프로젝트). 워커 테스트는
  vitest 네이티브 실행. (제네릭 템플릿의 컨테이너 지시는 본 스택에 비해당 — 정직히 명시.)
- **CI 보강**: 현 `ci.yml`은 worker-modules 테스트를 돌리지 않음(web만). worker-modules vitest
  스텝 추가로 회귀 가드.
- **SonarQube/무중단·자동롤백 파이프라인**: 본 레포는 Cloudflare Git 연동 자동배포 + 기존
  arch-guard/migration-safety 게이트 사용. 가짜 엔터프라이즈 파이프라인을 날조하지 않고 기존
  관례를 따른다(정직성 > 카고컬트).

## 8. Zero-Defect Lockdown (3단계 적대 감사)
구현 후 Workflow로 병렬 검증: Phase1 정밀(정확성/논리결함) → Phase2 사이드이펙트/동시성 →
Phase3 보안/엣지케이스/회귀. 결함 0까지 루프.

## 9. 최종 구현 결과 (구현 + 감사 후 확정)

### 로케일 뷰 (단일 진실원천 `locale-policy.js`)
- `INDEXABLE_LOCALES = [en, ko]` → 색인 신호: hreflang(기사/랜딩), sitemap, JSON-LD inLanguage, robots index.
- `UI_LOCALES = 8개 전부` → 서빙/소셜 신호: og:locale:alternate, **마켓플레이스 listing hreflang**(정책 외, 실상품 페이지).
- `GENERATED_LOCALES = [en, ko]` → 데일리 파이프라인 생성 대상.
- 워커 `constants.js`는 SUPPORTED_LOCALES 오버로드를 **제거**하고 INDEXABLE/UI를 재수출(이름 혼동·listing 누수 차단).
- 웹 `seo-config.ts`도 INDEXABLE_LOCALES(en,ko) + SUPPORTED_LOCALES(8=UI) 미러. ContentDetailPage가 minor-lang 기사 noindex.

### JSON-LD 보안 (renderJsonLd 중앙화)
- `html-builder.renderJsonLd(schemas)` 하나로 `<`→`<` 이스케이프 + falsy 제거. **4개 봇 핸들러 전부** 사용
  → listing.js(사용자 제어 마켓 데이터) breakout 구조적 차단(향후 핸들러도 누락 불가).

### 범위 결정
- **insight/landing** = 정책 적용(minor-lang noindex). **marketplace /d/:id** = 정책 외(실상품, 8개 UI 색인 유지).
- 웹 build-time sitemap.ts = latent/미사용(워커가 실제 /sitemap.xml 동적 서빙) → 원복.

### 재확장 안전장치
- `prompt-builder.buildPrompt()`가 instruction 없는 생성 로케일에 throw(**cron 경로 한정** — 모듈 로드 X, 요청 서빙 brick 방지).
- `es` instruction 추가(재확장 예시가 실제로 스페인어 생성하도록).

### 검증
- 워커 vitest 123, 웹 SEO vitest 97, 웹 `tsc -b` clean. import 스모크 전부 통과. SUPPORTED_LOCALES 코드 잔존 0.
- 3라운드 적대 감사(Workflow, 13 에이전트): Phase1 10결함 → 수정, Phase2 8결함(blocker listing JSON-LD 포함) → 수정, Phase3 최종 확인.
