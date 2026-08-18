# 핸드오프 — billing/settings UI 배포 (2026-07-29) — ✅ 완료

> **배포 완료.** `feat/mobile-iap-integration` → develop(#316) → main(#317) 머지됨.
> main HEAD = `277c847`. 아래는 완료 기록 + 남은 후속 1건.

---

## 결과 요약

| 단계 | 상태 |
|---|---|
| CI 실패 1건 진단·수정 | ✅ `1c7e80c` |
| PR #316 (feat → develop) | ✅ 7/7 그린, 머지됨 (`2f947b6`) |
| PR #317 (develop → main) | ✅ 7/7 그린, 머지됨 (`277c847`) |
| 웹 프로덕션 배포 | ✅ 라이브 검증됨 |
| 모바일 | ✅ EAS 네이티브 빌드 2건 큐잉 (스토어 제출 X) |
| 프로덕션 DB | ✅ migs 148–155 **이미 적용돼 있었음** — 이번 배포에 DB 작업 없음 |

---

## 1. CI 실패 — 해결 (`1c7e80c`)

`AI Credit Metering (postgres-15)`가 유일한 red였고, **원인은 stale 테스트 2건**이었음.
마이그레이션·제품 코드는 무변경(변경 파일 = 테스트 2개뿐).

### 1-a. `payment_edgecase_test.sql` P-L4

`_owned_card_limit(top-plan user) = 2e9` 어서션을 **mig 148**(상위 플랜 100,000 캡)이 무효화.

⚠️ **함정**: 같은 블록의 두 번째 어서션 `get_active_card_threshold() IS NULL`은 mig 148 이후에도
계속 통과함 — 단, **다른 이유로**. 픽스처가 카드 5장뿐이라 `OFFSET 99999`가 빈 결과를 내서 NULL이지,
`>= 1e9` 센티널 조기반환 때문이 아님. 즉 `2e9 → 100000` 한 토큰만 고치면 **CI는 초록인데
테스트는 아무것도 검증하지 않는 상태**가 됨(캡이 6 이상이면 무조건 통과).

그래서 mig 148이 실제로 주장하는 바로 재조준함:
카탈로그 행이 유한 캡 / `grant_subscription`이 그 값을 구독 행에 복사 / 실효 한도가 1e9 **미만** /
미터가 `is_unlimited=false` / **캡을 넘기면 아카이브 경계가 실제로 생성됨**(2e9 시절엔 구조적으로 불가능).

- `created_at`을 명시적으로 계단 배치함 — `now()`는 트랜잭션 내내 고정이라 기존 DEFAULT로는
  카드 5장의 타임스탬프가 전부 같아져 경계 검증이 무의미해짐.
- `2e9 → threshold NULL` 센티널 경로는 **유실 안 됨**: `card_limit_guard_test.sql`이 어드민 분기
  (mig 139)로 커버하며 같은 잡에서 **더 먼저** 돌고 통과함.

### 1-b. `billing_sku_catalog_test.sql` — 한 번도 실행된 적 없던 스위트

잡의 **마지막 스텝**이라 앞 스텝이 실패할 때마다 skip → 이 브랜치에서 **단 한 번도 실행된 적 없음**.
mig 155가 비활성화한 mig-151 플레이스홀더(`sub_5k_monthly_v2`)를 조회하고 있었고,
`resolve_store_product`는 `is_active=false`를 제외하므로 NULL 반환.

post-155 SKU 4종을 고정함 — iOS는 bare id(`standard_monthly`/`pro_monthly`),
Google은 `<sub>:<base-plan>`(`sub_standard_monthly:monthly`/`sub_pro_monthly:monthly`).
이 플랫폼별 분기는 Apple이 created-then-deleted된 `sub_*_monthly` id를 **영구 예약**해서 생긴 영구 사실.

### 검증 방법 (재사용 가치 있음)

CI 잡을 로컬에 그대로 복제해서 확정함 — 추측 없이 실측:

```bash
docker run -d --name pg-mig -e POSTGRES_PASSWORD=postgres -p 55433:5432 postgres:15
# base DB에 bootstrap-auth.sql + 마이그레이션 155개 전부 적용
# → 이후 CREATE DATABASE t TEMPLATE base 로 매 실행마다 깨끗한 복제본 사용 (재적용 불필요, 수초)
# → ci.yml 순서대로 10개 스위트 실행 (CI는 DB 하나를 공유하며 순차 실행)
```

핵심 함정 2가지:
- CI는 **DB 하나**에 모든 스위트를 순차 실행 + `ON_ERROR_STOP=1` → 앞 스위트가 죽으면
  **뒤 스위트는 전부 가려짐**. 그래서 SKU 스위트 고장이 오래 안 보였음.
- 테스트 파일이 `BEGIN; … ROLLBACK;`로 감싸여 있음 → 실패 후 DB를 들여다보면 전부 롤백된
  빈 상태라 오진하기 쉬움. 격리 재현으로 확인할 것.

변이 테스트로 두 수정이 **실제로 회귀를 잡는지**까지 확인함(mig 148 되돌리기 / mig 155 SKU 비활성화 →
각각 의도한 어서션에서 red).

스크립트: `scratchpad/setup-pg.sh`, `scratchpad/run-suites.sh`

---

## 2. 머지 충돌 해소 — 검증 완료

핸드오프에서 "검토 권장"으로 남긴 3건 전부 실증 확인함:

- `lemonsqueezy-checkout/index.ts` — ours 채택이 옳음. DB 우선(`billing_product_skus`) →
  `LEMONSQUEEZY_VARIANT_MAP` 폴백 → 둘 다 모르면 fail-closed. main의 env-map 동작 보존됨.
  (참고: prod `billing_product_skus`에 `lemonsqueezy` 행이 없어 웹은 항상 env 맵 경로를 탐 — 의도된 동작)
- 웹 로케일 `settings.json` 8개 — main의 키가 **8개 전부에서 하나도 유실되지 않음**(deep diff 확인).
  `subscription`만 추가됨. ※ parity 테스트는 8개에서 *일괄* 누락되면 못 잡으므로 직접 확인이 필요했음.
- `SettingsPage.tsx` — main의 GDPR `PrivacyDataSection`(Pack D)이 동일 위치에 보존됨. 스타일만 차이.

---

## 3. ⚠️ 핸드오프 원문이 틀렸던 부분 — 모바일은 OTA가 아니라 **네이티브 빌드**

원문: "이번 변경은 android/ios/app.json/app.config.js 미포함 → `decide` 잡이 `ota`로 판정" — **틀림**.

`b90afdd`가 `packages/mobile/app.json`에 `com.android.vending.BILLING`을 추가했고,
`decide` 잡은 정확히 그 경로를 grep함:

```bash
git diff --name-only HEAD^ HEAD | grep -E '^packages/mobile/(android|ios|app\.json|app\.config\.js)'
```

실제 실행 결과 (run `30421289334`): `EAS Build + Submit` **success**, `EAS Update (OTA)` **skipped**.

이 판정이 **올바름** — `react-native-purchases`(네이티브 모듈) + BILLING 권한은 OTA로 전달 불가.
그리고 `native-build` 잡은 `--no-wait`로 **빌드만** 하고 스토어 제출은 안 함(제출은 `submit-mobile.yml` 수동).

원문의 "runtimeVersion 1.0.2"도 틀림 — `app.json`의 `version`은 **1.0.3**이고 정책이 `appVersion`.

**결과적으로 기존 앱 사용자는 이번 머지로 아무 변화도 받지 않음.** 모바일 UI 수정은 새 빌드가
스토어에 나가야 도달함.

큐잉된 빌드:
- Android: https://expo.dev/accounts/asdscv/projects/reeeeecall-study/builds/bacc9a3e-0a8d-41c9-b03d-1730c7dafa1f
- iOS: https://expo.dev/accounts/asdscv/projects/reeeeecall-study/builds/e57780c8-58e3-403b-8aa0-28a59159d022

---

## 4. 배포 검증 — 통과

```
HTTP/2 200                              # reeeeecallstudy.xyz
hreflang: en / ko / x-default           # /insight
```

프로덕션이 새 문구를 실제로 서빙 중임을 로케일 JSON 직접 조회로 확인:
- `subscription.title` = `구독` (신규 섹션)
- `cardUsage.planNoteUnlimited` = `관리자 계정 — 카드 저장 개수에 제한이 없습니다.`
  → 오해 소지 있던 "무제한" 마케팅 아님, 어드민 오버라이드 명시
- 번들에 Intl 비의존 그룹핑 정규식 `\B(?=(\d{3})+(?!\d))` 포함 확인

프로덕션 DB 사전 확인(배포 전): `billing_products` 상위 플랜 `card_limit=100000` / 타이틀 Standard·Pro /
`billing_product_skus` 클린 ID 활성 / `get_billing_products(text)` 오버로드 / `system_flags` — **148–155 전부 적용됨**.

---

## 후속 배포 — ✅ 완료 (PR #318 → #319, main `17f293b`)

아래 "신규 발견"으로 적었던 건을 **전수 감사 후 수정·배포 완료**했습니다.

50-에이전트 감사로 모바일에서 도달 가능한 Intl 포맷 지점 **63곳 전수 조사 → 17건 확정**
(30건은 값이 1000에 도달 불가라 구분자가 애초에 안 보여서 기각).

1. **코드 6곳** — 플랜 카드 한도(페이월 "100000 cards"), XP 2곳, AI 생성 진행 카운트,
   `formatProductPrice`의 $·₩ 양쪽.
2. **로케일 336곳** — 핵심 발견: 대부분의 로케일이 **bare `{{count}}`** 로 보간하고 있어
   포매터를 아예 우회, raw 숫자가 찍히고 있었음. 8개 로케일 × 72파일에서
   `{{count}}` → `{{count, number}}` + `showingRange`의 from/to/total, 마켓플레이스 `available`.
3. **i18next `number` 포매터 자체를 Intl-free 구현으로 교체** (모바일 로케일이 쓰는 포맷 스펙은
   `number` 하나뿐이라 이 하나로 전부 커버). `count`는 계속 실제 숫자 → **복수형 선택 무영향**.
4. 그룹핑을 의존성 없는 `shared/lib/format-number`로 분리 — `pricing.ts`가 공유하고,
   i18n 설정이 **초기화 시점에 Supabase 클라이언트를 끌어오지 않도록**.

### ⚠️ 함께 고친 배포 안전 문제 (별건, 더 중요)

`SUBSCRIPTION_UI_ENABLED`가 하드코딩 `true`였음. `react-native-purchases`는 네이티브 모듈이라
**오늘 처음** main에 들어갔고 기존 프로덕션 설치본엔 없는데, JS는 **OTA로도** 도달함.
그 조합에서 `Purchases`가 null → 모든 결제 호출 no-op → **결제가 불가능한 가격표와 Select CTA**가
렌더됨(사용자 막다른 길 + Apple 2.1(b)).

이제 `OWNER_GO_LIVE_SWITCH && Purchases != null`. SDK 없으면 결제 UI 없음이 구조적 보장.
**이 수정이 있었기에 아래 OTA를 안전하게 내보낼 수 있었음.** (영수증/결제 내역은 이 게이트와 무관하게 계속 노출)

### 검증

- `i18n.test.ts` **Test 5 신규** — 로케일이 쓰는 모든 `{{x, <fmt>}}` 스펙에 Intl-free 오버라이드가
  등록돼 있어야 함. **양방향 가드**(오버라이드 삭제 불가 + 새 스펙을 오버라이드 없이 추가 불가).
  308 assertions. **변이 테스트로 red 확인.**
- **런타임 검증** — 실제 로케일 JSON으로 i18next 초기화 후 `1,234,567 cards` / `5,000 new` /
  `Showing 1–20 of 12,345 cards` / `100,000 remaining` 확인, `42 cards`는 불변.
- `usd-format.test.ts` 10/10, 웹 `tsc -b`/모바일 `tsc`/웹 build clean, CI 7/7.

### 배포 결과

`app.json`·네이티브 미변경 → `decide`가 **ota** 판정 → `eas update` 성공
(run `30424002332`, branch=production, **runtimeVersion 1.0.3**, android+ios,
update group `5b803a7e-e8a6-4488-aed9-73e5407c3912`).
`EAS Build + Submit`은 스킵. 웹도 새 번들로 재배포됨.

> 이 OTA로 **#317의 billing/settings UI 개선도 기존 앱 사용자에게 처음 도달**함
> (#317 머지는 네이티브 빌드만 돌아 사용자에겐 아무것도 안 갔었음).

---

## 원본 기록 — 당시 "남은 후속 1건"

**`packages/mobile/src/components/settings/PlanSelector.tsx:71`이 방금 고친 것과 똑같은 버그를 갖고 있음.**

```ts
t('plans.cardLimit', { limit: (limit ?? 0).toLocaleString() })   // ← Hermes에서 구분자 증발
```

이번 릴리스가 `formatUsdMicro`에서 제거한 바로 그 패턴이고, 같은 릴리스가 이 용도로
`formatCount()`를 추가해뒀는데 여기엔 적용이 안 됨. 결과적으로 **방금 배포된 모바일 페이월의
Pro 플랜이 "100,000 cards"가 아니라 "100000 cards"로 렌더될 수 있음.**

같은 클래스 잔여 건(모두 모바일, 카운트류):
- `AchievementsScreen.tsx:84` — XP
- `StreakFreezeCard.tsx:26` — XP
- `AIGenerateScreen.tsx:686` — 진행 카운트
- `shared/lib/pricing.ts:18` — `formatProductPrice`가 `toLocaleString('en-US', …)` 사용
  (현재 가격대는 4자리 미만이라 실질 영향 없음, 그래도 정리 대상)

웹 `PlanSelector.tsx`는 `toLocaleString(locale)`이라 브라우저에선 정상 — 모바일만 해당.

**타이밍이 좋음**: EAS 빌드가 아직 스토어에 안 나갔으므로, 지금 고치면 다음 빌드에 실려 나감.
