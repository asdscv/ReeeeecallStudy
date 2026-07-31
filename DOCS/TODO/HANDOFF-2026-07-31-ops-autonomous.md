# HANDOFF 2026-07-31 — ops/monetization 자율 정리 패스

이번 패스의 범위: `DOCS/OPS-READINESS.md` 의 **Deferred** 표와
`DOCS/TODO/AI-MONETIZATION-REMAINING.md` 의 미완 항목 중 **소유자 결정이 필요 없는 코드 작업만**
자율 진행. 결정이 필요한 것은 손대지 않고 아래 §4 에 모아둔다.

기준 커밋: `origin/develop` = `eb0411d`. 워크스트림 하나에 브랜치 하나.
**브랜치는 로컬에만 있고 push/PR 하지 않았다** (명시 지시 대기).

---

## 1. 완료 — 검증까지 끝난 것

### WS3 · 환불된 크레딧팩이 어드민 목록에서 `paid` 로 표시 (돈 관련)
브랜치 `fix/admin-payments-refunded-status` · 커밋 `3eebbfe`

| 파일 | 내용 |
|---|---|
| `supabase/migrations/175_admin_list_payments_refund_status.sql` | `admin_list_payments` 재정의 |
| `supabase/tests/admin_payment_refund_status_test.sql` | 7개 섹션 회귀 스위트 (신규) |
| `.github/workflows/ci.yml` | `ai-credit-tests` 잡에 스텝 등록 |
| `DOCS/TODO/AI-MONETIZATION-REMAINING.md` | §5 갱신 + 오류 정정 |

`admin_list_payments` 의 credit_pack arm 이 `'paid'::text AS status` 를 **단정**하고 있었다
(mig 156 도입 → mig 159 계승). 클로백 행은 원장에 있었지만 목록이 보지 않았다.

배지는 덜 중요한 쪽이었다. `AdminBillingPage.tsx:449` 가 환불 버튼을
`status === 'paid' && kind === 'credit_pack'` 으로 노출하므로, **이미 환불한 돈에 대해 환불
버튼을 다시 띄우고 있었다.** 환불 경로는 mig 158 가드로 멱등이라 돈이 두 번 나가지는 않았지만,
확인 다이얼로그가 전액을 환불 가능한 것처럼 표시했다.

수정 방식: 상태를 원장에서 **도출**한다. `refund:` / `reversal:` 네임스페이스 규칙을 다시
구현하지 않고 `credit_grant_is_refunded()`(mig 158, mig 173 확장)에 위임했다 — mig 173 이
"어떤 호출자도 네임스페이스를 알 필요 없게" 만든 정본이기 때문이다. 따라서 환불이 유효하면
`refunded`, 스토어가 환불을 되돌리면(`REFUND_REVERSED`) 다시 `paid` 가 된다.

**검증 (실제 실행):**
- 마이그 적용 **전** 테스트 RED: `ERROR: a clawed-back grant must list as refunded, got paid`
- 적용 **후** PASS
- 회귀 7스위트 PASS: `credit_refund_guard`, `credit_clawback_reversal`, `sandbox_environment`,
  `refund_policy`, `payment_edgecase`, `billing_sku_catalog`, `ai_cost_margin`

**인접 감사 결과 (같은 클래스의 버그 없음, 확인함):**
- `admin_get_user_billing` — `payment_intents` 만 읽으므로 무관. 실제 `pi.status` 를 사용.
- `admin_billing_overview.paid_revenue_30d_micro` — `WHERE pi.status = 'paid'` 이므로 **웹 환불은
  정상적으로 빠진다**. 모바일 IAP 팩은 `payment_intents` 행을 만들지 않아 **애초에 매출에 0으로
  잡힌다** (과대계상이 아니라 누락 — §4 정산 항목).
- 문서가 지목한 `get_admin_billing_kpis` 는 **존재하지 않는다** (`pg_proc` 확인). 실제 집계
  함수는 `admin_billing_overview` → 문서 정정함.
- UI/i18n 변경 불필요: `PAY_STATUS_STYLES.refunded` 존재, `billing.payStatus.refunded` 가
  8개 로케일에 이미 있음.

### WS4 · 데드코드 `admin_set_session_override` / `max_sessions_override`
브랜치 `chore/drop-session-override-deadcode` · 커밋 `4214f5d`

| 파일 | 내용 |
|---|---|
| `supabase/migrations/176_drop_dead_session_override.sql` | REVOKE + DROP + 죽은 키 제거 |
| `supabase/tests/session_override_removed_test.sql` | 제거 검증 + 라이브 제한기 재증명 (신규) |
| `.github/workflows/ci.yml` | `ai-credit-tests` 잡에 스텝 등록 |
| `DOCS/OPS-READINESS.md` | Deferred 표 → 완료 표기 |

mig 049 는 `subscriptions.metadata->>'max_sessions_override'` 를 써서 특정 유저의 동시 세션
한도를 올릴 수 있게 했다. mig 093 이 **플랫폼당 1세션**으로 재작성하면서 그 키를 더 이상 읽지
않는다.

함수는 그 재작성을 살아남았다. 그래서 약 80개 마이그레이션 동안 `is_admin()` 게이트를 통과하고
`{"success": true, "max_sessions_override": n}` 을 반환하면서 **관측 가능한 어떤 것도 바꾸지
않았다.** 게다가 `billing_subscriptions` 가 아닌 **레거시 `subscriptions`** 테이블에 썼으므로
재배선을 했더라도 엉뚱한 행을 읽었을 것이다. 죽어 있는 게 아니라 **오해를 유발하는** 코드였다.

**죽었다는 근거 (마이그레이션 읽기가 아니라 실제 DB 카탈로그):**
```sql
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosrc ILIKE '%max_sessions_override%';
-- → admin_set_session_override(uuid,integer)   ← 자기 자신뿐
```
web/mobile grep 도 깨끗함.

**주의해서 남긴 것:** 레거시 `subscriptions` **테이블은 유지**했다 —
`handle_new_user_subscription()`, `get_user_subscription()`, `admin_set_subscription()` 이 여전히
사용한다. JSONB 키만 제거했고, 제거 전에 `RAISE NOTICE` 로 값을 apply 로그에 남긴다.
(아무도 읽지 않으므로 동작 변화는 없다. 제거하는 이유는 향후 per-tier 디바이스 수 기능이
몇 달 전에 설정된 override 를 조용히 물려받는 것을 막기 위함이다.)
`proacl` 이 NULL 이어서 EXECUTE 가 PUBLIC 기본값이었으므로 DROP 전에 REVOKE 했다.

**검증 (실제 실행):** 적용 전 RED(`admin_set_session_override must be dropped`) → 적용 후 PASS.
**재적용 멱등성 확인** (`migration-safety` 잡이 `supabase db reset` 을 2회 돌리므로 필수).
테스트는 제거뿐 아니라 **라이브 제한기를 재증명**한다 — 두 번째 web 디바이스가 첫 번째를
밀어내고, app 세션은 web 과 공존. "데드코드"가 실은 동작을 지탱하고 있었을 가능성을 배제한다.

---

## 2. 남은 코드 작업 — 착수 전이지만 조사는 끝난 것

> 아래 조사 결과는 다시 파지 않도록 그대로 옮겨 적었다.

### WS2 · `free_limit` 하드코딩 제거 (브랜치 `fix/free-quota-from-server` — 아직 빈 브랜치)

대상:
- `packages/web/src/components/ai-generate/steps/ConfigStep.tsx:24` — `const FREE_DAILY_CAP = 10`,
  사용처 `:168` `Math.min(FREE_DAILY_CAP, affordable.free)`
- `packages/mobile/src/screens/AIGenerateScreen.tsx:237` — `Math.min(10, affordable.free)`

**핵심 사실 (확인함):** `get_ai_generation_quota` 는
`remaining = GREATEST(0, free_limit - used)` 를 반환한다. 즉 `affordable.free` 는 **이미 서버가
설정된 쿼터로 묶어 놓은 값**이다. 따라서 클라이언트의 `Math.min(10, …)` 은 지금은 no-op 이고,
**쿼터를 10 위로 올리는 순간 기본값을 10 으로 조용히 깎는 버그가 된다** — ops 문서가 예측한 드리프트.

**설계 시 반드시 지킬 제약 (조사 중 발견):**
- 카드수 입력창이 타이핑 값을 **100 으로 클램프**한다 (`ConfigStep.tsx:483,492,495,497`,
  모바일 `:581`). 그러므로 기본값은 **무료 쿼터가 아니라 입력창 상한(100)** 에 맞춰 클램프해야
  한다. 안 그러면 쿼터를 500 으로 올릴 때 **사용자가 직접 타이핑할 수도 없는 기본값**이 들어간다.
- 서버는 큰 요청을 잘라내지 않는다: `ai-generate` 의 `MAX_CARDS_PER_CALL = 25` 가 있지만
  `packages/shared/stores/ai-generate-store.ts` 가 **배치 반복**(`batchSize = 25`, 루프)하므로
  25 초과도 정상 지원된다. 25 클램프는 필요 없다.

**권장 방식:** `FREE_DAILY_CAP` 을 지우고 `MAX_CARD_COUNT = 100` 상수를 도입해
(ConfigStep 에 중복된 `100` 리터럴 4곳도 함께 정리) 기본값을
`Math.max(1, Math.min(MAX_CARD_COUNT, affordable.free))` 로 한다. 모바일도 동일.
`Affordable` 에 `freeLimit` 을 **추가할 필요는 없다** — 클램프에 쓰이지 않기 때문이다.
표시 목적으로 필요해지면, `getAffordableCards()`(`packages/shared/lib/ai/server-client.ts:146`)가
이미 `getAiGenerationQuota()` 를 호출하므로 **추가 네트워크 비용 없이** 넣을 수 있다.

**일부러 남길 것:**
- `getAiGenerationQuota()` 의 에러 폴백 `{ freeLimit: 10, remaining: 10 }` — 문서화된 fail-open.
  서버가 authoritative 하고 초과분은 429 로 거절된다.
- 모바일 `parseInt(cardCount) || 10` (`:327, :341, :649, :666`) — 빈 입력 파싱 폴백이지
  쿼터 미러가 아니다.

### WS1 · Pack B 어드민 UI (AI 무료쿼터 / 카드캡 / 마진 입력 필드) — 미착수

세터는 이미 살아 있다 (mig 154, `authenticated` 에 GRANT + 본문 `is_admin()` 게이트):
`admin_set_ai_free_quota(integer)`, `admin_set_card_limit(integer, boolean)`,
`set_ai_pricing_settings(integer, integer, numeric)`.

**막힌 지점:** **읽기 경로가 없다.** `ai_pricing_settings` 와 `card_limit_settings` 는
정책이 0개인 RLS deny-all 이고, getter RPC 가 존재하지 않는다 (grep + `pg_proc` 확인).
UI 가 현재값을 보여줄 수 없으므로 **admin 게이트 getter 를 새로 만들어야 한다.**
→ 마이그레이션 번호 **177 을 예약해 두었다** (브랜치 간 충돌 방지: 175=WS3, 176=WS4, 177=WS1).

**지켜야 할 제약:**
- `set_ai_pricing_settings` 는 `target_margin_bps >= 10000` 을 거절한다 (mig 114 §9b —
  bps 가 살아있는 divisor 라 100% 면 0으로 나눔 → 무과금). UI 도 100% 를 허용해선 안 된다.
- `usd_won_rate` 는 mig 149 CHECK 로 1 에 고정 → **UI 에 노출하지 말 것.**
- `admin_set_ai_free_quota` 허용 범위는 0..100000.

**붙일 위치와 패턴:**
- 스토어: `packages/shared/stores/admin-store.ts` 의 `fetchSystemFlags` / `setSystemFlags`
  (= `get_system_flags` / `admin_set_system_flags`) 패턴을 그대로 따른다. 쓰기마다
  `get().logAction(...)` 을 호출하는 것도 포함.
- UI: `packages/web/src/pages/admin/AdminSystemPage.tsx` 의 `SystemControls` 컴포넌트.
- i18n: `packages/web/public/locales/<lang>/admin.json`, **8개 로케일**
  (ko/en/ja/zh/es/vi/th/id), 키는 `system.controls.*` 아래.

---

## 3. 검증 환경 (재구축하지 말 것)

- 워크트리: `/tmp/rs-ops-autonomous` (`origin/develop` = `eb0411d`)
- 검증 DB: docker 컨테이너 **`rs-ops-verify`**, `postgres:15`, 호스트 포트 **55444**
  — ⚠️ **55432 는 다른 프로젝트의 `pg-mem` 컨테이너다. 쓰지 말 것.**
- 부트스트랩: `.github/scripts/bootstrap-auth.sql` → 파일명 순서대로 전체 마이그레이션
- 베이스라인(측정값): web vitest **139 파일 / 2331 테스트 PASS**, web build 성공, DB 스위트 PASS
- SQL 테스트 작성 함정:
  - `json` 에는 `?` 연산자가 없다 → `jsonb` 캐스팅 필요
  - 실제 credit_pack product id 는 `credits_1000` / `credits_5000` / `credits_10000`
  - 테스트는 superuser 로 돌기 때문에 GRANT 는 막지 않는다. 역할은
    `set_config('request.jwt.claim.role' | '...sub', …)` 로 시뮬레이션한다.

---

## 4. 소유자 결정이 필요한 것 (코드 아님 — 자율 진행 대상에서 제외)

### 4.1 가격/사업 숫자 — §1 Phase 1 "마진 ON" 을 막고 있는 유일한 게이트
- **₩/credit** (IAP 크레딧팩 가격과 반드시 일치) + **팩 티어/SKU**
- **목표 마진 %**
- 시딩된 indicative 요율을 실제 provider 인보이스와 대조
- 무료 티어 CAC 정책 (10장/일 유지? 일일 예산?) + FX 갱신 주기

### 4.2 외부 계정/스토어 — 실제 구매를 막고 있는 것
- App Store / Play Console 소비성 상품 등록 + **애플 심사**
- RevenueCat 프로젝트 + `REVENUECAT_WEBHOOK_AUTH` 시크릿, 배포된 함수로 웹훅 지정
  (샌드박스 먼저 — mig 159 덕분에 샌드박스 웹훅을 상시 켜두어도 안전하다: 이벤트는 ack 되고
  어드민이 킬스위치를 열기 전까지 아무것도 지급하지 않는다)
- 웹 결제 provider 계정 + 시크릿

### 4.3 고라이브 순서 (프로덕션 — 명시 요청 시에만)
1. `supabase secrets set AI_GENERATION_PROVIDER_KEY=<gemini key>`
2. `supabase functions deploy ai-generate` (+ `revenuecat-webhook`, 활성 웹 결제 웹훅)
3. `develop` → `main` 승격 (web 은 main push 시 자동 배포)
4. 유료 생성 1건 실검증 + 나이틀리 Cloudflare cron → `refresh_ai_est_price()` (pg_cron 미설치)
5. 모바일 유료 레일은 킬스위치를 열기 **전에** 샌드박스 런 필요

⚠️ **mig 114 는 절대 재실행 금지** — `TRUNCATE ai_credit_balance, ai_credit_ledger` 를 포함한다.
prod 에 지갑 데이터가 없던 시점에 딱 한 번 안전했다.
⚠️ prod 상태는 문서가 아니라 **DB(`supabase migration list --linked`)를 읽어서** 확인할 것.

**승격 대기 중 주목할 커밋:** `origin/develop` 이 `origin/main` 보다 7커밋 앞서 있고, 그 안에
`7dbec02 fix(mobile): bump expo.version to 1.0.4` — **모든 iOS 업로드를 막고 있던** 수정이 있다.
나머지는 학습로직 관련. (JS-only 변경은 OTA 로 기존 설치에 도달하지만 네이티브 변경은 새 EAS 빌드 필요.)

### 4.4 보안 — 코드 잔여 0, 제품 결정 대기
- **L6** — prod `uri_allow_list` 에서 `localhost:5173` 제거. 제거하면 로컬→prod OAuth 개발이
  깨진다. 별도 dev 프로젝트를 마련할 때 재검토.
- **Auth M3/M4/M5** — 현재 prod: `mailer_autoconfirm=true`(이메일 미검증 가입 가능),
  `security_captcha_enabled=false`, `password_min_length=6`·HIBP off.
  **M4 는 반쪽 롤아웃 시 클라이언트가 깨진다** (captcha provision 과 `captchaToken` 배선이 동시에 필요).

### 4.5 운영 보류 항목 — 결정 필요
per-plan AI 엔타이틀먼트(유료 티어에 더 큰 무료 쿼터), 할인/쿠폰/무료체험,
쿼터 리셋 타임존(UTC→Asia/Seoul, 리셋 회계가 바뀜), 일회용 이메일 denylist,
크레딧 만료(ToS 고지 선행 필요), 푸시/공지 브로드캐스트, 계정삭제 grace window(파괴적 의미 변경).

### 4.6 코드 작업이지만 **의도적으로 자율 진행하지 않은 것**
- **서버측 감사 추적** — `logAction` 을 각 `admin_*` RPC 안으로 넣고 IP 캡처.
  머니/어드민 RPC 다수를 동시에 건드리는 리팩토링이라 무인 진행 대상이 아니다
  (OPS-READINESS 에도 "not safe to refactor unattended" 로 기록되어 있음).
- **순액(net proceeds) 리포팅** — `payment_intents` 에 컬럼을 추가하면 **모바일 절반을 놓친다**
  (IAP 소비성 구매는 `payment_intents` 행을 만들지 않는다). `(provider, provider_event_id)` 키의
  provider-agnostic 정산 테이블이 필요하고, 이는 정산 설계 결정이다.
  현재 상태: 모바일 크레딧팩은 매출에 **0** 으로 잡힌다.
