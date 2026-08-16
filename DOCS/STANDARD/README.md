# ReeeeecallStudy 코딩 표준

> 이 저장소의 **모든 변경이 따라야 하는 규범**. 일반론이 아니라 **이 코드베이스에서 실제로 관찰된 관례**와
> **실제로 일어난 사고**에서 뽑았다. 코드가 바뀌면 이 문서도 같은 PR 에서 바뀐다.
>
> 작성 2026-08-16 · 근거: 코드베이스 전수 조사(14개 영역) + git log 200건 + CI 정의
> · 초안의 사실 주장 838건을 코드와 대조해 115건을 정정한 뒤 확정했다.

---

> ## ★제1원칙 = 모듈식 → [`01_ARCHITECTURE/modular_composition.md`](01_ARCHITECTURE/modular_composition.md)
> **능력을 모듈로 쪼갠다 · 소비자는 필요한 것만 골라 쓴다 · 모듈은 공유 범위만큼 위로 올린다.**
>
> 다른 모든 규칙보다 앞선다. 새 코드를 쓰기 전에 **"이건 어느 층의 모듈인가"** 를 먼저 답한다.
>
> ### ★확장 메커니즘 5종도 그 문서 §8 한 곳에 있다
> **커널 · 플러그인 레지스트리 · 포트&어댑터+DI · 이벤트 버스 · 파이프 앤 필터**
> — 선택 기준표 + 메커니즘별 (언제 쓰나 / 코드 SSOT / 확장 비용 / 게이트 / 안티패턴).

---

## 이 표준의 두 가지 원칙

**1. 규칙마다 게이트를 적는다.**
모든 규칙에는 "이걸 어기면 무엇이 빨개지는가"가 붙어 있다. 없으면 **`없음`** 이라고 정확히 적는다 —
없다는 사실 자체가 필요한 정보이기 때문이다. 게이트의 실제 사정거리는 한 곳에 모여 있다:
→ **[`07_TESTING/GATES.md`](07_TESTING/GATES.md) (SSOT)**

**2. 어긋난 것을 숨기지 않는다.**
"지켜야 한다"와 "지켜지고 있다"는 다른 주장이다. 현재 어긋난 것은 각 문서에 인라인으로 표시돼 있고,
**부채 표**를 따로 가진 문서는 네 곳이다 — 아키텍처 [`01_ARCHITECTURE/modular_composition.md §7`](01_ARCHITECTURE/modular_composition.md#7-지금-어긋나-있는-것-부채-목록--늘어나면-안-되고-줄어들기만-한다) ·
게이트 [`07_TESTING/GATES.md §5`](07_TESTING/GATES.md#5-이-문서의-부채) · 문서 [`13_DOCS_WORKFLOW §7`](13_DOCS_WORKFLOW/README.md#7-지금-어긋나-있는-것) · UI [`14_UI`](14_UI/README.md#이-문서의-부채). **부채는 줄어들기만 한다.**

## 카테고리

| # | 문서 | 무엇을 정하는가 |
|---|---|---|
| **01** | [**ARCHITECTURE**](01_ARCHITECTURE/README.md) | ★제1원칙 · 계층과 경계 · 확장 메커니즘 5종 · [확장점 인벤토리](01_ARCHITECTURE/extension_points.md) |
| **02** | [CLIENT](02_CLIENT/README.md) | zustand 스토어 · TTL 캐시 · 데이터 접근 · 에러 표면화 · 화면 계층 |
| **03** | [SERVER_CONTRACT](03_SERVER_CONTRACT/README.md) | 엣지 함수 표준형 · RPC 계약 · **에러 코드 어휘** |
| **04** | [DATABASE](04_DATABASE/README.md) | 마이그레이션 · DEFINER RPC · RLS/GRANT · SQL 어서션 · 성능 |
| **05** | [AI_AND_MONEY](05_AI_AND_MONEY/README.md) | 제공자/모델 · 예약→과금/해제 · 가격과 무료 정책 · 프롬프트 |
| **06** | [RESILIENCE](06_RESILIENCE/README.md) | 실패를 삼키지 않기 · opsGate · fail-open/closed · 재시도 · 멱등 |
| **07** | [TESTING](07_TESTING/README.md) | 테스트 종류 · **구조 테스트 3종** · 변이 테스트 · **[GATES.md](07_TESTING/GATES.md)** |
| **08** | [CODE_QUALITY](08_CODE_QUALITY/README.md) | 타입체크 명령 · eslint · 네이밍 · 커밋 메시지 · 툴체인 핀 |
| **09** | [DEPLOYMENT](09_DEPLOYMENT/README.md) | 표면 4개 · **배포 순서** · 마이그레이션 승격 · OTA vs 네이티브 |
| **10** | [I18N](10_I18N/README.md) | 8로케일 × 2플랫폼 · Hermes ICU · 복수형 · DB 문자열 |
| **11** | [SECURITY](11_SECURITY/README.md) | 인증/인가 · 결제·환불 · 시크릿 · CI 인젝션 · PII |
| **12** | [MOBILE](12_MOBILE/README.md) | 런타임 제약 · SecureStore · 네비게이션 · 실기기 확인 |
| **13** | [DOCS_WORKFLOW](13_DOCS_WORKFLOW/README.md) | 문서 라이프사이클 · frontmatter · [ADR 템플릿](13_DOCS_WORKFLOW/decisions/0000-template.md) |
| **14** | [UI](14_UI/README.md) | 디자인 토큰 · 테마/다크모드 · 접근성 · 토스트/확인/폼 · 성능 |

기능 설명서(규범 아님): [`AI-HUB.md`](AI-HUB.md) — AI 학습 허브의 구조와 확장 절차.

## 상황별 진입점

| 하려는 일 | 먼저 읽을 곳 |
|---|---|
| 새 기능을 어디에 둘지 모르겠다 | [01 §2 계층](01_ARCHITECTURE/modular_composition.md#2-계층--모듈이-살-수-있는-자리) → [§8 선택 기준표](01_ARCHITECTURE/modular_composition.md#8-확장-메커니즘-5종--쪼갠다를-어떤-형태로-하나) |
| 항목 하나(메뉴·도메인·제공자·가격)를 추가한다 | [확장점 인벤토리](01_ARCHITECTURE/extension_points.md) |
| DB 를 바꾼다 | [04](04_DATABASE/README.md) → [09 §2 배포 순서](09_DEPLOYMENT/README.md#2--배포-순서--스키마가-먼저다) |
| 돈이 움직이는 코드를 만진다 | [05](05_AI_AND_MONEY/README.md) + [11 §3](11_SECURITY/README.md#3-결제--돈을-만드는-경로) |
| 문자열을 추가한다 | [10](10_I18N/README.md) |
| 화면을 만든다 (색·테마·접근성·토스트) | [14](14_UI/README.md) |
| 테스트를 어디에 어떻게 쓸지 모르겠다 | [07](07_TESTING/README.md) → [GATES.md](07_TESTING/GATES.md) |
| 릴리스한다 | [09 §7 체크리스트](09_DEPLOYMENT/README.md#7-릴리스-체크리스트-develop--main) |
| PR 을 올리기 직전이다 | [07 §7 Definition of done](07_TESTING/README.md#7-definition-of-done) |

## 이 저장소의 성격 (표준을 읽기 전 배경)

- **모노레포**: `packages/{shared,web,mobile,official-decks}` + `supabase/{migrations,functions,rollbacks,tests}` + `worker-modules/` + `tools/` + `tests/`
- **런타임 4개**가 서로 다른 시각에 배포된다(웹 자동 / 모바일 / 엣지 수동 / DB 수동) → [09 §1](09_DEPLOYMENT/README.md#1-표면-4개와-배포-주체)
- **규약을 문서가 아니라 테스트로 박는다.** 소스 텍스트를 읽는 가드 테스트가 표준 도구다 → [07 §3](07_TESTING/README.md#3-구조-테스트-3종)
- **커밋과 마이그레이션 헤더가 사후분석 리포트다.** 프로덕션 실측 수치를 남긴다 → [08 §5](08_CODE_QUALITY/README.md#5-커밋-메시지)

## 이 표준을 고치는 법

→ [13 §5](13_DOCS_WORKFLOW/README.md#5-표준-문서이-폴더를-고칠-때)
요약: 규칙에는 게이트 칸을 채우고, 게이트를 만들었으면 `GATES.md` 에 등재하고, 어긴 코드를 남겼으면 부채 표에 적는다.
