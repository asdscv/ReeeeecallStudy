# 01. 아키텍처 원칙

> ## ★제1원칙 = 모듈식 → [`modular_composition.md`](modular_composition.md)
> **능력을 모듈로 쪼갠다 · 소비자는 필요한 것만 골라 쓴다 · 모듈은 공유 범위만큼 위로 올린다.**
>
> 이 README 의 계층·경계 규칙은 **한 모듈 안의** 구조 규칙이고,
> 제1원칙은 **모듈의 경계와 위치**를 정한다. 충돌하면 제1원칙이 우선한다.
>
> ### ★확장 메커니즘 5종도 그 문서 §8 한 곳에 있다
> **커널 · 플러그인 레지스트리 · 포트&어댑터+DI · 이벤트 버스 · 파이프 앤 필터** —
> 선택 기준표 + 메커니즘별 (언제 쓰나 / 코드 SSOT / 확장 비용 / 게이트 / 안티패턴).
> → [`modular_composition.md §8`](modular_composition.md#8-확장-메커니즘-5종--쪼갠다를-어떤-형태로-하나)

## 목차

- [1. 런타임 4개, 배포 단위 4개](#1-런타임-4개-배포-단위-4개)
- [2. 의존 방향](#2-의존-방향)
- [3. 경계를 지키는 장치](#3-경계를-지키는-장치)
- [4. 이 저장소가 아키텍처를 강제하는 방식 — 소스를 읽는 테스트](#4-이-저장소가-아키텍처를-강제하는-방식--소스를-읽는-테스트)
- [5. 관련 문서](#5-관련-문서)

---

## 1. 런타임 4개, 배포 단위 4개

같은 제품이 **서로 다른 시각에, 서로 다른 시스템이 미는** 네 런타임 위에서 돈다.
아키텍처 판단의 대부분은 여기서 나온다.

| 런타임 | 코드 | 배포 주체 | 배포 시점 |
|---|---|---|---|
| 웹 SPA + Worker | `packages/web`, `worker.js`, `worker-modules/` | Cloudflare Git 연동 | ★ **`develop` push 즉시** (CI 결과와 무관) |
| 모바일 | `packages/mobile` | `.github/workflows/deploy-mobile.yml` → EAS | `main` push (OTA) 또는 스토어 심사 |
| 엣지 함수 | `supabase/functions/` (Deno) | **사람이 수동** `supabase functions deploy` | 머지와 무관 |
| DB | `supabase/migrations/` | **사람이 수동** `scripts/apply-prod-migrations.sh` | 웹 배포보다 **먼저** |

**여기서 파생되는 불변식 3개** (자세히는 [`../09_DEPLOYMENT`](../09_DEPLOYMENT/README.md)):

1. **스키마는 코드보다 앞선다.** ★ **develop 머지가 곧 웹 배포**이므로(main 이 아니다), RPC 가 없는 상태로 웹이 나가면 전 사용자가 404 를 본다. **develop 은 스테이징이 아니다.**
2. **엣지 함수는 `packages/` 를 import 할 수 없다.** 복제하고 parity 테스트로 묶는다(제1원칙 R4).
3. **모바일에는 옛 네이티브 바이너리가 남아 있다.** JS 만 OTA 로 도달하는 설치본이 존재하므로, 네이티브 모듈에 의존하는 UI 는 런타임 존재 확인(`Purchases != null`) 뒤에 켠다.

## 2. 의존 방향

```
packages/web ─┐                         supabase/functions ── (packages 참조 불가)
              ├─→ @reeeeecall/shared ──→ types
packages/mobile┘        │                worker-modules ───── (workspace 밖)
                        ├─ stores  (유스케이스 · supabase 접근은 여기까지)
                        ├─ lib     (순수 도메인 · supabase 금지 — 현재 stats.ts/storage.ts 2건 위반, §3 형제 import 구멍)
                        ├─ learning(도메인 모듈 · 자체 에러 계약)
                        ├─ adapters(포트만 · 외부 import 0 · index.ts 만 형제 포트 타입을 type-import)
                        └─ types
```

- **역참조 0건**이 현재 실측이다(shared → web/mobile, web ↔ mobile 모두 0).
- `packages/official-decks` 는 shared 를 전혀 참조하지 않는 **독립 CLI** 다. 클린 아키텍처 4층(domain/application/infrastructure/presentation) + PascalCase 파일이라는 **다른 규약**을 쓰며, 그 예외는 인정된 것이다. 앱 코드에서 import 하지 않는다.

**계층별 상세 표와 R1~R5 규칙** → [`modular_composition.md §2, §4`](modular_composition.md#2-계층--모듈이-살-수-있는-자리)

## 3. 경계를 지키는 장치

| 경계 | 강제 수단 | 강도 |
|---|---|---|
| L2 도메인이 supabase 를 import 하지 않음 | `tools/check-arch.ts` Rule 1 (CI `arch-guard`) | ⚠️ 형제 import `./supabase` 구멍 있음 |
| 학습 엔진 단일 소스 | `tools/check-arch.ts` Rule 2 | 강함 (파일 존재만으로 exit 1) |
| 타입 경계 | `tsc -b --noEmit` (CI `lint-typecheck`) | 웹+shared 만. 모바일은 사실상 게이트 아님 |
| 확장점 우회 금지 | `*-not-hardcoded.test.ts` | 지정된 화면 파일만 |
| 커널 죽은 export | `*-no-dead-exports.test.ts` | 커널 3디렉터리만 |
| 런타임 복제본 동기화 | `*-parity.test.ts` | 지정된 4쌍만 (shared↔엣지 복제 3 + SQL↔TS 상수 1) |
| 순환참조 | **없음** | — |
| import 계층 규칙(eslint) | **없음** | — |

> **읽는 법**: "게이트 있음"은 *그 규칙 전체가 지켜진다*는 뜻이 아니라 *그 게이트가 검사하는 범위 안에서만 지켜진다*는 뜻이다. 각 게이트의 실제 사정거리는 [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) 에 한 줄씩 적혀 있다.

## 4. 이 저장소가 아키텍처를 강제하는 방식 — 소스를 읽는 테스트

동작 테스트로는 볼 수 없는 규칙이 있다.

- "메뉴가 레지스트리를 읽는가" → 하드코딩된 목록도 **완벽하게 렌더된다**.
- "커널에 읽는 사람 없는 export 가 있는가" → 컴파일러는 export 를 문제 삼지 않는다.
- "두 사본이 갈라졌는가" → 각자의 테스트는 각자의 사본만 본다.

그래서 `readFileSync` 로 **소스 텍스트를 읽어 검사하는 테스트**가 `packages/web/src/lib/__tests__/` 에 산다.
이건 특이한 관행이 아니라 이 저장소의 **표준 도구**다. 새 확장점에는 같은 종류의 가드를 복제한다(제1원칙 R5).

작성 시 지켜야 할 것:
- 스캔에서 `.js` 를 제외한다(gitignore 된 컴파일 트윈이 삭제된 reader 를 살려둔다).
- `supabase/functions/ai-generate/index.ts` 와 `packages/shared/learning/adapters/domain-adapters.ts` 는 파일에 **리터럴 NUL 바이트**가 있어 셸 `grep` 이 바이너리로 취급하고 건너뛴다. 이 두 파일을 보려면 `grep -a` 또는 `readFileSync` 기반 테스트를 쓴다.
- 스캔 대상 목록(`SCAN_ROOTS`/`MENU_SURFACES`)을 파일에 하드코딩할 때는, **새 화면이 생기면 목록에 추가해야 한다**는 사실을 헤더 주석에 적는다.

## 5. 관련 문서

| 주제 | 문서 |
|---|---|
| 제1원칙·확장 메커니즘 5종·부채 목록 | [`modular_composition.md`](modular_composition.md) |
| 확장점 실물 인벤토리(등록 절차·비용) | [`extension_points.md`](extension_points.md) |
| 클라이언트 상태·캐시 | [`../02_CLIENT`](../02_CLIENT/README.md) |
| 엣지/RPC 계약 | [`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) |
| DB·마이그레이션 | [`../04_DATABASE`](../04_DATABASE/README.md) |
| 게이트 인벤토리 | [`../07_TESTING/GATES.md`](../07_TESTING/GATES.md) |
| AI 허브 확장 사례(기능 문서) | [`../AI-HUB.md`](../AI-HUB.md) |
