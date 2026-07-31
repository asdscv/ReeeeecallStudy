# HANDOFF 2026-07-31 — ops/monetization 자율 정리 패스

범위: `DOCS/OPS-READINESS.md` 의 **Deferred** 표와 `DOCS/TODO/AI-MONETIZATION-REMAINING.md` 의
미완 항목 중 **소유자 결정이 필요 없는 코드 작업만** 자율 진행. 결정 필요 항목은 §4.

착수 기준: `origin/develop` = `eb0411d`. 워크스트림 하나에 브랜치/PR 하나.

## 현재 상태 한눈에

| WS | 내용 | PR | 상태 |
|---|---|---|---|
| WS3 | 환불된 크레딧팩이 어드민 목록에서 `paid` 로 표시 (mig 175) | #371 | ✅ develop 머지 |
| WS4 | 죽은 `admin_set_session_override` 제거 (mig 176) | #372 | ✅ develop 머지 |
| — | 이 핸드오프 문서 | #373 | ✅ develop 머지 |
| WS2 | `free_limit` 하드코딩 제거 (web+mobile) | #374 | ✅ develop 머지 |
| WS1 | Pack B 어드민 UI (mig 177) | #375 | ✅ develop 머지 |

**OPS-READINESS 의 Deferred 항목 중 "코드 작업"으로 분류됐던 4건은 전부 처리·머지됐다.**
PR 5건 모두 CI 7/7 green. 남은 것은 §2(새로 발견) 와 §4(소유자 결정)뿐이다.

마이그레이션 175·176·177 사용 → **다음 빈 번호는 178.**

---

## 1. 완료 — 머지된 것

### WS3 · 환불된 크레딧팩이 `paid` 로 표시 (돈 관련) — PR #371 · mig 175

`admin_list_payments` 의 credit_pack arm 이 `'paid'::text AS status` 를 **단정**했다
(mig 156 도입 → mig 159 계승). 클로백 행은 원장에 있었지만 목록이 보지 않았다.

배지는 덜 중요한 쪽이었다. `AdminBillingPage.tsx:449` 가 환불 버튼을
`status === 'paid' && kind === 'credit_pack'` 으로 노출하므로 **이미 환불한 돈에 대해 환불 버튼을
다시 띄우고**, 확인 다이얼로그가 전액을 환불 가능한 것처럼 표시했다. mig 158 가드로 멱등이라
돈이 두 번 나가지는 않았다.

수정: 상태를 원장에서 도출. `refund:` / `reversal:` 규칙을 재구현하지 않고
`credit_grant_is_refunded()`(mig 173 이 정본화한 함수)에 위임 → 환불 유효 시 `refunded`,
스토어가 환불을 되돌리면(`REFUND_REVERSED`) 다시 `paid`.

**검증:** 적용 전 RED(`a clawed-back grant must list as refunded, got paid`) → 적용 후 PASS.
UI/i18n 변경 불필요(`PAY_STATUS_STYLES.refunded` + `billing.payStatus.refunded` 8개 로케일 기존 존재).

**인접 감사 — 같은 클래스 버그 없음:** `admin_get_user_billing` 은 `payment_intents` 만 읽어 무관.
`admin_billing_overview.paid_revenue_30d_micro` 는 `pi.status='paid'` 만 집계하므로 웹 환불은 정상
제외되고, 모바일 IAP 팩은 `payment_intents` 행을 만들지 않아 **매출에 0 으로 잡힌다**(누락).
문서가 지목한 `get_admin_billing_kpis` 는 **실존하지 않음**(`pg_proc` 확인) → 문서 정정함.

### WS4 · 죽은 session override 제거 — PR #372 · mig 176

mig 049 의 `subscriptions.metadata->>'max_sessions_override'` 는 mig 093 이 **플랫폼당 1세션**으로
재작성한 뒤 아무도 읽지 않는다. 그런데 함수는 살아남아 `is_admin()` 게이트를 통과하고
`{"success": true, ...}` 를 반환하면서 **관측 가능한 어떤 것도 바꾸지 않았다.** 게다가
`billing_subscriptions` 가 아닌 **레거시 `subscriptions`** 에 썼다. 죽은 게 아니라 **거짓말하는** 코드.

근거는 마이그레이션 읽기가 아니라 DB 카탈로그:
```sql
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.prosrc ILIKE '%max_sessions_override%';
-- → admin_set_session_override(uuid,integer)   ← 자기 자신뿐
```

**남긴 것:** 레거시 `subscriptions` **테이블은 유지**(`handle_new_user_subscription`,
`get_user_subscription`, `admin_set_subscription` 이 사용 중). JSONB 키만 제거하며 제거 전
`RAISE NOTICE` 로 값을 apply 로그에 남긴다. `proacl` 이 NULL(EXECUTE 가 PUBLIC 기본값)이라
DROP 전에 REVOKE.

**검증:** RED → PASS, 재적용 멱등. 테스트는 제거뿐 아니라 **라이브 제한기를 재증명**한다
(두 번째 web 디바이스가 첫 번째를 밀어내고, app 세션은 공존).

### WS2 · `free_limit` 하드코딩 제거 — PR #374

web·mobile 모두 `Math.min(10, affordable.free)` 로 위저드를 열었다. 이 `10` 은 서버 무료 쿼터의
손복사본이고, mig 154 가 그 쿼터를 설정값으로 만들었다 → **쿼터를 50 으로 올려도 기본값은 10 에
묶이는 조용한 캡.**

애초에 클램프가 필요 없었다: `get_ai_generation_quota` 는
`remaining = GREATEST(0, free_limit − used)` 를 반환하므로 `Affordable.free` 는 **이미 서버 쿼터로
묶여 있다.** 대신 클라이언트가 정당하게 소유하는 경계 — **입력창 자체 범위(100)** — 로 교체했다.
쿼터를 500 으로 올렸을 때 사용자가 타이핑할 수도 없는 기본값이 들어가면 안 되기 때문.

`packages/shared/lib/ai/card-count.ts` 로 추출해 두 플랫폼이 다시 갈라지지 않게 하고,
web 입력창에 중복돼 있던 `100` 리터럴 4곳도 같은 상수로 통일. 서버는 큰 값을 잘라내지 않는다
(`MAX_CARDS_PER_CALL = 25` 이지만 `ai-generate-store` 가 25장 단위로 배치).

**테스트:** 쿼터 10 초과 시 캡되지 않음(회귀), 소진 시 0 이 아니라 1, 입력범위 상한,
정수 출력, NaN/Infinity 가드(controlled number input 을 먹통으로 만듦).

### WS1 · Pack B 어드민 UI — PR #375 · mig 177

**막힌 지점은 폼이 아니라 읽기 경로였다.** mig 154 가 세터는 줬지만 조회 수단이 없었다 —
`ai_pricing_settings` / `card_limit_settings` 는 정책 0개 RLS 이고 getter RPC 가 없었다.
현재값을 못 보여주는 폼은, 돈 관련 값에서 "보이지 않는 숫자를 덮어쓰라"는 초대다.

mig 177 `admin_get_growth_levers()` — 세 세터가 바꿀 수 있는 필드만 정확히 반환해서
"보여주는 것"과 "쓸 수 있는 것"이 갈라지지 않게 했다.
- **`usd_won_rate` 는 의도적으로 제외** — mig 149 가 `CHECK (usd_won_rate = 1)` 로 고정
  (카탈로그에서 `ai_pricing_settings_usd_won_rate_is_1` 확인). 편집 필드를 주면 실패만 한다.
- 각 행의 `updated_at` 은 **반환한다** — 돈 노브가 언제 움직였는지 아는 것과 낡은 폼을 읽는 것은 다르다.
- 역할 체크는 GRANT 가 아니라 **함수 본문**에 (mig 158 이 기록한 이유).

패널은 쓰기 전에 읽고, **필드별로 따로 저장**하며(다른 입력의 낡은 값이 묻어가지 않게),
RPC 경계를 미러링한다. `target_margin_bps = 10000` 은 일반 범위 에러가 아니라 전용 메시지 —
과금식의 **살아있는 divisor**(`markup = 10000/(10000−bps)`)라서 100% 면 **조용히 무과금**이 된다.

스토어 액션은 자기 반환값을 믿지 않고 `fetchGrowthLevers` 로 **재조회**한다(세터 3개가 서로 다른
셰이프를 반환하고, 하나는 우리가 모델링하지 않는 고정 rate 를 담고 있다).

**검증:** 클린 postgres:15 에 170 마이그레이션 적용, **SQL 23/23 PASS**, mig 177 재적용 멱등,
web `tsc -b` + e2e tsc + lint(0 errors) + build 통과, mobile `tsc --noEmit` 0 errors,
vitest **143 파일 / 2384 테스트 PASS**. i18n 8개 로케일 × 16키 완전(컴포넌트가 쓰는 키와 대조).

---

## 2. 남은 코드 작업 (이번 패스에서 새로 발견 / 의도적 미진행)

### 2.1 모바일 페이월 문구가 설정값을 하드코딩 (신규 발견, 미처리)
`packages/mobile/src/i18n/locales/*/paywall.json` 의 **8개 로케일**:
- `features.aiGeneration.free = "하루 10장"` → 무료 쿼터의 하드코딩 사본
- `features.aiGeneration.pro = "하루 10장 + 크레딧"`
- `features.cardStorage.free = "1,000장"` / `.pro = "최대 100,000장"` → 카드캡 사본

즉 **Pack B 로 쿼터·카드캡을 바꾸면 페이월이 거짓말한다.** 웹 랜딩(`PricingSection`)은 이미
`get_public_plans()` 로 동적이라 **모바일 표만 정적**이다.

⚠️ 기계적으로 고칠 수 없다: `.pro` 문구는 **per-plan AI 엔타이틀먼트**(§4.5, 미결정)에 의존한다 —
현재 유료 결제는 카드캡만 올리고 AI 쿼터는 올리지 않는다. `.free` / `cardStorage` 는 서버값
보간으로 지금 고칠 수 있다. (PR #374 본문에도 기록됨.)

### 2.2 서버측 감사 추적 — 의도적 미진행
`logAction` 을 각 `admin_*` RPC 안으로 넣고 IP 캡처. 머니/어드민 RPC 다수를 동시에 건드리는
리팩토링이라 무인 진행 대상이 아니다(OPS-READINESS 에도 "not safe to refactor unattended").

### 2.3 순액(net proceeds) 리포팅 — 결정 필요
`payment_intents` 에 컬럼을 추가하면 **모바일 절반을 놓친다**(IAP 소비성 구매는 그 행을 만들지
않는다). `(provider, provider_event_id)` 키의 provider-agnostic 정산 테이블이 필요하고, 이는
정산 설계 결정이다. 현재 모바일 크레딧팩은 매출에 **0**.

---

## 3. 검증 환경 (재구축하지 말 것)

- 워크트리: `/tmp/rs-ops-autonomous`
- 검증 DB: docker `postgres:15`, 호스트 포트 **55444 / 55445 / 55446** 사용했음
  — ⚠️ **55432 는 다른 프로젝트의 `pg-mem` 컨테이너다. 쓰지 말 것.**
- 절차: `.github/scripts/bootstrap-auth.sql` → 파일명 순서대로 전체 마이그레이션 → 스위트 실행
- 현재 베이스라인: **vitest 143 파일 / 2384 테스트**, SQL **23 스위트**, lint 0 errors
  (경고 4건은 이 패스가 건드리지 않은 파일의 기존 것), mobile tsc 0 errors
- SQL 테스트 함정:
  - `json` 에는 `?` 연산자가 없다 → `jsonb` 캐스팅
  - 실제 credit_pack product id 는 `credits_1000` / `credits_5000` / `credits_10000`
  - superuser 로 돌기 때문에 GRANT 는 막지 않는다. 역할은
    `set_config('request.jwt.claim.role' | '...sub', …)` 로 시뮬레이션
- **CI 충돌 주의:** 새 SQL 스위트는 `ai-credit-tests` 잡에 스텝을 추가해야 하는데, 병행
  워크스트림이 둘 이상이면 **같은 위치에 추가돼 충돌한다**(이 패스에서 WS3/WS4 가 실제로 충돌).
  둘 다 살려 마이그레이션 번호순으로 정렬해 해소했다.
- **git 인증:** 이 레포 push 에는 gh 활성 계정이 `asdscv` 여야 한다(`luke-rictax` 는 403).
  `gh auth switch --hostname github.com --user asdscv` 후
  `git -c credential.helper='!gh auth git-credential' push` 로 명령 단위 적용.
  세션 중 활성 계정이 `luke-rictax` 로 되돌아간 적이 있으니 push 실패 시 먼저 확인.
  **이 패스는 활성 계정을 `asdscv` 로 바꿔 놓았다 — 원래대로 되돌릴지 확인 필요.**

---

## 4. 소유자 결정이 필요한 것 (코드 아님)

### 4.1 가격/사업 숫자 — §1 Phase 1 "마진 ON" 을 막는 유일한 게이트
- **₩/credit**(IAP 크레딧팩 가격과 일치) + **팩 티어/SKU**
- **목표 마진 %** — 이제 Admin → System 에서 바로 입력 가능(WS1)
- 시딩된 indicative 요율 vs 실제 provider 인보이스 대조
- 무료 티어 CAC 정책(10장/일 유지? 일일 예산?) + FX 갱신 주기

### 4.2 외부 계정/스토어 — 실제 구매를 막는 것
- App Store / Play Console 소비성 상품 등록 + **애플 심사**
- RevenueCat 프로젝트 + `REVENUECAT_WEBHOOK_AUTH`, 배포 함수로 웹훅 지정(샌드박스 먼저 —
  mig 159 덕분에 샌드박스 웹훅 상시 ON 도 안전: 이벤트는 ack 되고 킬스위치 전까지 미지급)
- 웹 결제 provider 계정 + 시크릿

### 4.3 고라이브 순서 (프로덕션 — 명시 요청 시에만)
1. `supabase secrets set AI_GENERATION_PROVIDER_KEY=<gemini key>`
2. `supabase functions deploy ai-generate` (+ `revenuecat-webhook`, 활성 웹 결제 웹훅)
3. `develop` → `main` 승격 (web 은 main push 시 자동 배포)
4. 유료 생성 1건 실검증 + 나이틀리 Cloudflare cron → `refresh_ai_est_price()` (pg_cron 미설치)
5. 모바일 유료 레일은 킬스위치를 열기 **전에** 샌드박스 런

⚠️ **mig 114 절대 재실행 금지** — `TRUNCATE ai_credit_balance, ai_credit_ledger` 포함.
⚠️ prod 상태는 문서가 아니라 **`supabase migration list --linked`** 로 확인.
⚠️ **prod 는 mig 173 까지 동기화됨** → 이번 패스의 **175 / 176 / 177 은 아직 prod 미적용.**

**승격 대기:** `origin/develop` 이 `origin/main` 보다 앞서 있고, 그 안에
`7dbec02 fix(mobile): bump expo.version to 1.0.4` — **모든 iOS 업로드를 막고 있던** 수정이 있다.
(JS-only 변경은 OTA 로 기존 설치에 도달하지만 네이티브 변경은 새 EAS 빌드 필요.)

### 4.4 보안 — 코드 잔여 0, 제품 결정 대기
- **L6** — prod `uri_allow_list` 에서 `localhost:5173` 제거. 제거하면 로컬→prod OAuth 개발이 깨짐.
- **Auth M3/M4/M5** — 현재 prod: `mailer_autoconfirm=true`(이메일 미검증 가입 가능),
  `security_captcha_enabled=false`, `password_min_length=6`·HIBP off.
  **M4 는 반쪽 롤아웃 시 클라이언트가 깨진다**(captcha provision + `captchaToken` 배선 동시 필요).

### 4.5 운영 보류 — 결정 필요
**per-plan AI 엔타이틀먼트**(유료 티어에 더 큰 무료 쿼터 — §2.1 페이월 문구가 여기 걸려 있다),
할인/쿠폰/무료체험, 쿼터 리셋 타임존(UTC→Asia/Seoul, 리셋 회계가 바뀜), 일회용 이메일 denylist,
크레딧 만료(ToS 고지 선행), 푸시/공지 브로드캐스트, 계정삭제 grace window(파괴적 의미 변경).
