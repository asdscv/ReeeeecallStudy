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

~~마이그레이션 175·176·177 사용 → **다음 빈 번호는 178.**~~
→ **낡음.** 178 은 PR A(#377), 179 는 #379 가 썼다. **다음 빈 번호는 180** (§5.1).

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

### 2.1 모바일 페이월 문구가 설정값을 하드코딩 — ✅ **완료 (#379, mig 179)**

> 아래는 발견 당시의 기록. 실제 수정과 **진단의 정정 두 건**은 §5.3 참조:
> `cardStorage.pro` 는 "고칠 수 없다"가 아니라 카탈로그에서 바로 나왔고, 반대로
> `cardStorage.free` 는 "지금 고칠 수 있다"가 아니라 **읽기 경로가 없어** mig 179 가 필요했다.
> 그리고 이 화면은 §5.4 대로 **숨겨져 있지 않았다.**

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
⚠️ ~~**prod 는 mig 173 까지 동기화됨**~~ → **낡음. 2026-08-01 `supabase migration list --linked`
확인 결과 prod 는 174 까지 적용돼 있다.** 미적용은 **175 / 176 / 177 / 178 / 179** (§5.1).

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

---

## 5. 후속 패스 (2026-08-01) — 워크트리에 남아 있던 것들

착수 시점 `origin/develop` = `c498ae0`. 이 패스는 **새 기능을 시작하지 않았고**, 앞 패스가
워크트리·스테일 PR 형태로 남긴 것을 찾아 끝냈다.

| PR | 내용 | 어디서 발견 | 상태 |
|---|---|---|---|
| #348 | `tests/integration` vitest 스코프 + CI 바이너리 해석 | 워크트리 `modular-learning-engine`, PR이 **12일간 열린 채 방치** | ✅ 머지 |
| #292 | Android 12 스플래시 로고 잘림 | 7/20부터 열린 채 방치, 체크는 green이었음 | ✅ 머지 |
| #378 | **PR B** — attempt-grounded remediation UI (web+mobile) | 워크트리 `wt-mem`에 **커밋되지 않은 채** 존재 | ✅ 머지 |
| #379 | 모바일 페이월 하드코딩 제거 (mig 179) | 아래 §2.1 | ✅ 머지 |

**§2.1 은 이제 완료다.** 남은 코드 작업은 §2.2 / §2.3 뿐이며 둘 다 의도적 보류(하나는 무인
리팩토링 부적합, 하나는 정산 설계 결정 필요)다.

### 5.1 문서가 낡아 있던 두 지점 — 본문 정정함

- **마이그레이션 번호**: "다음 빈 번호는 178" → 178은 PR A(#377)가, 179는 #379가 썼다.
  **다음 빈 번호는 180.**
- **prod 상태**: "prod 는 mig 173 까지" → `supabase migration list --linked` 확인 결과
  **174까지 적용돼 있다.** 미적용은 **175 / 176 / 177 / 178 / 179**.

### 5.2 PR B 는 "작성 완료 + 미커밋" 상태였다

설계 문서 §10 은 "PR B — not started" 라고 적혀 있었으나, 실제로는 web 페이지 / mobile 화면
(+213줄) / 8개 로케일 × 2플랫폼 / 테스트가 `wt-mem` 워크트리에 **커밋되지 않은 채** 있었다.
그대로 커밋했으면 CI는 통과했을 것이다 — tsc/vitest 모두 green 이었으므로. 그래서 5개 렌즈로
리뷰를 돌렸고 **20건 제기 → 16건 확인 / 4건 반증**, 확인된 것을 고치고 머지했다.

돈이 걸린 결함 위주로:

1. **웹이 attempt 를 goal 로 필터링하지 않았다** (3개 렌즈가 독립적으로 도달). `fetchAttempts`
   는 `attemptsLoading` 만 켜고 `attempts` 를 비우지 않는다 → 목표 전환 후 한 라운드트립 동안
   **직전 목표의 행이 그대로 그려진다**. 그 행에는 진짜 card/attempt id 가 있어서, 클릭하면
   방금 떠난 목표의 카드를 설명하는 데 크레딧이 나간다.
2. **웹 plan-row `explain` 이 `attemptId` 를 보내지 않았다.** 모바일은 보냈다. 즉 mig 178 의
   provenance 가 웹에서만 항상 NULL 이고, 같은 값을 내고 일반 답변을 받는다(설계 §6 위반).
3. **평가 직후 attempt 목록이 갱신되지 않았다.** `recordAttempt` 는 plan 만 다시 읽는다 →
   방금 틀린 카드, 즉 **이 기능이 존재하는 이유인 바로 그 순간**에 근거 요청이 불가능했다.
4. **지갑 시세를 마운트당 1회만 읽었다** → 구매 후에도 세션 내내 구매 전 잔액을 표시.

1·2·3 은 모바일이 이미 올바르게 구현한 것을 웹이 놓친 **플랫폼 비대칭**이었다. 특히 2는
1의 수정이 들어간 뒤에도 plan-row 만 필터를 우회하고 있어서 별도 커밋(`a8d054c`)으로 잡았고,
테스트 2개를 뮤테이션 검증했다(수정을 되돌리면 각각 red).

**서버는 이걸 못 잡는다**: mig 178 의 pair check 는 attempt 와 enrichment 가 같은 **카드**를
가리키는지만 본다. 다른 건 **goal** 이고 아무도 검사하지 않으므로, 그럴듯하지만 틀린
`attempt_id` 가 저장된다. 검증된 것처럼 읽히는 provenance 는 없느니만 못하다.

### 5.3 §2.1 페이월 — 핸드오프의 진단 중 한 줄은 틀렸다

앞 패스는 "`.pro` 문구는 per-plan AI 엔타이틀먼트(§4.5)에 걸려 있어 고칠 수 없다"고 적었다.
그건 **AI 행에만** 해당한다. `cardStorage.pro` 는 이미 로드돼 있는 상품 카탈로그
(`BillingProduct.cardLimit` 최댓값)에서 바로 나온다 — 추가 왕복 없음.

반대로 `cardStorage.free` 는 "지금 서버값 보간으로 고칠 수 있다"고 적혀 있었지만 **읽을 방법이
없었다**: `card_limit_settings` 는 정책 0개 RLS 이고 공개 getter 가 없다. 그래서 mig 179
`get_plan_limits()` 를 추가했다(`anon`+`authenticated`, mig 125 `get_public_plans()` 와 같은 자세).

⚠️ **함정 하나를 SQL 로 못박았다**: `_owned_card_limit(uuid)` / `get_owned_card_usage()` 는
**사용자별 유효 한도**다. 어드민에게는 `2000000000` 을, 기간이 남은 해지 구독자에게는 플랜 상한을
돌려준다. 페이월에 쓰면 어드민 화면에 "Free: 2,000,000,000 cards" 가 찍힌다. deck-store 가 이미
노출하고 있어서 손이 가기 쉬운 오답이라, 주석이 아니라 테스트로 막았다.

AI 행은 **두 칸이 같은 서버값을 인용**하도록 했다. 유료 플랜이 AI 쿼터를 올리지 않는 것이 현재
사실이므로(`_ai_free_cards_per_day()` 는 사용자 인자를 받지 않는다) 더 큰 Pro 숫자는 창작이 된다.
이렇게 두면 쿼터를 바꿔도 두 칸이 서로 모순되지 않으며, **§4.5 결정을 미리 내리지 않는다.**
다만 그 행은 여전히 크레딧이 Pro 혜택인 것처럼 읽히는데(크레딧팩은 무료 사용자도 산다) 이건
카피/제품 판단이라 손대지 않았다.

읽기 실패 시에는 숫자 없는 문구(`*Unknown`: "Limited storage" / "매일 무료 제공량")로 떨어진다.
**폴백 상수를 두지 않았다** — 그럴듯한 낡은 숫자가 결제 화면에 뜨는 것이 바로 이번에 없앤 실패
모드이고, 에러 경로로 되살리면 그대로 남는 것이기 때문이다.

### 5.4 그 화면은 숨겨져 있지 않았다

`PaywallScreen.tsx` 헤더는 2026-04-15 애플 리젝 이후 "네비게이션 스택에서 제거됨, 접근 경로 없음"
이라고 주장하고 있었다. **오래전부터 사실이 아니다** — `SettingsStack.tsx` 가 라우트를 등록하고
`SettingsScreen` 이 두 곳에서 `navigate('Paywall')` 한다. 남은 게이트는 런타임
`SUBSCRIPTION_UI_ENABLED` 뿐이고 `OWNER_GO_LIVE_SWITCH = true` 다. 헤더를 정정했다.

즉 §2.1 은 이론적 문제가 아니라 **실기기 빌드에서 사용자에게 보이는 가격 고지**였다.

### 5.5 부수적으로 기록해 둔 것 (고치지 않음)

- `card_limit_settings` / `ai_pricing_settings` 는 **테이블 레벨 SELECT 권한이 anon /
  authenticated 에 아직 붙어 있다**. 새는 건 없다 — 막고 있는 것은 정책 0개 RLS 다. 다만
  `DISABLE ROW LEVEL SECURITY` 한 줄이면 의미가 생긴다. 그래서 새 스위트는 권한이 아니라
  **실효 읽기가 0행인지** + **RLS 가 켜져 있고 정책이 0개인지**를 검사한다.
- `vi/paywall.json` 은 파일 전체가 무성조("Luu tru the", "Toi da"). 기존 문제라 새 문구도 같은
  스타일로 맞췄다(반만 고치지 않기 위해). 별도 패스가 필요하다.
- 웹 랜딩 비교표에도 같은 두 리터럴이 하드코딩돼 있다. `get_plan_limits()` 를 `anon` 에게 연
  이유가 이것이라, 마이그레이션 없이 고칠 수 있다.

### 5.6 검증 환경

- 워크트리: `wt-paywall` (신규), `wt-mem` (PR B)
- 검증 DB: docker `postgres:15`, 호스트 포트 **55447** — 작업 후 컨테이너 제거함.
  ⚠️ **55432 는 여전히 다른 프로젝트의 `pg-mem` 컨테이너다.**
- 클린 DB에 **179개 마이그레이션 전부 적용 → ci.yml 순서대로 SQL 스위트 24/24 PASS**
- `public_plan_limits_test.sql` 뮤테이션 5종 전부 red 확인
- web `tsc -b` 0 / vitest **144 파일 2415 테스트** / mobile `tsc` 0 / paywall.json 8로케일 55키 동일
- 페이월 문구는 **실제 i18next + Intl-free 포매터로 8개 로케일 전부 렌더**해서 확인:
  기본값에서는 기존 카피와 글자 그대로 같고, 쿼터를 50으로 올리면 8개 로케일이 모두 따라간다.

### 5.7 워크트리 현황 (정리 대상)

| 워크트리 | 브랜치 | 상태 |
|---|---|---|
| `develop` (주 작업본) | `fix/mobile-intl-free-numbers` @ `636e71c` | **아주 오래된 브랜치를 체크아웃 중.** 미커밋 변경은 `kind:'remediation'` + `deckId` 기반 **초기 프로토타입**으로, 지금 develop 의 goal/attempt 기반 구현이 이미 대체했다. 버려도 되는 것으로 확인함 |
| `wt-mem` | `feat/attempt-grounded-remediation-ui` | 머지됨 (#378) — 제거 가능 |
| `modular-learning-engine` | `fix/integration-vitest-scope` | 머지됨 (#348) — 제거 가능 |
| `wt-settings` | `fix/mobile-settings-nav-rows` | 머지됨 (#357) — 제거 가능 |
| `wt-verify` | `verify/byok-e2e` | 머지됨. `packages/web/e2e/tests/zz-byok-removed.spec.ts` 가 untracked 로 남아 있음 — 라이브 빌드 대상 임시 검증 스펙 |
| `official-deck-korean-copy` | `fix/official-deck-korean-copy` | **작업 중 — 건드리지 말 것.** CSV 21개 미커밋 수정 + `DOCS/TODO/OFFICIAL-DECK-KOREAN-COPY-AUDIT.md` + `row_data_*.py` 15개 |
| `wt-phase4` | (워크트리 아님) | `packages/web/.vite` 캐시만 남은 고아 디렉터리 |
