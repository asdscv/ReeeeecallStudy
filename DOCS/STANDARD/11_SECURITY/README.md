# 11. 보안 — 인증 · 인가 · 결제 · 시크릿

> 이 저장소의 보안 규약은 **감사(mig 097~107)와 실제 사고**에서 나왔다.
> 규칙마다 어떤 사고가 그 규칙을 만들었는지 함께 적는다 — 사유를 모르면 다음 사람이 되돌린다.

## 목차
- [1. 인증 — 누가 부르는가](#1-인증--누가-부르는가)
- [2. 인가 — RPC 레벨](#2-인가--rpc-레벨)
- [3. 결제 — 돈을 만드는 경로](#3-결제--돈을-만드는-경로)
- [4. 환불](#4-환불)
- [5. 시크릿](#5-시크릿)
- [6. CI/워크플로 보안](#6-ci워크플로-보안)
- [7. PII 와 로깅](#7-pii-와-로깅)
- [8. 체크리스트](#8-체크리스트)

---

## 1. 인증 — 누가 부르는가

| 호출자 | 방식 | 함수 |
|---|---|---|
| 로그인한 사용자 | `verify_jwt = true` (기본) + `supabase.auth.getUser(token)` | `ai-generate`, `tts`, `toss-billing`, `toss-confirm`, `subscription-portal`, `lemonsqueezy-checkout` |
| 관리자 | `verify_jwt = true` + 호출자 JWT 로 `admin_refund_target` 을 불러 그 안의 `is_admin()` 가드가 인가 (자체 `getUser` 없음) | `admin-refund` |
| 결제사(웹훅) | `verify_jwt = false` + **자체 서명/공유비밀 검증** | `payment-webhook`, `lemonsqueezy-webhook`(HMAC-SHA256), `revenuecat-webhook`(공유 bearer) |
| 결제사(무서명 웹훅) | `verify_jwt = false` + **호출자 검증 없음 — 바디를 믿지 않고 제공자 API 로 재조회**해 권위 있는 상태만 쓴다 | `toss-webhook` (레거시 `PAYMENT_STATUS_CHANGED` 는 무서명) |
| 크론/기계 | `verify_jwt = false` + 공유비밀 **상수시간 비교** | `toss-renew` (`TOSS_RENEW_SECRET`) |
| 스케줄러(모델 감시) | `verify_jwt = true` + `x-watch-token` **상수시간 비교**(`MODEL_WATCH_TOKEN`), 또는 service_role bearer 를 그대로 넘겨 DB 가 `auth.role()` 로 판정 | `ai-model-watch` |

**`verify_jwt = false` 는 `supabase/config.toml` 에 명시된 5개뿐이다.** 목록에 추가하는 것은 **인증을 끄는 결정**이므로,
같은 PR 에서 자체 검증을 넣고 헤더에 그 사실을 적는다.

**웹훅 검증 표준형** (`lemonsqueezy-webhook`, `payment-webhook` 헤더가 표본):
- 시크릿 미설정 → **503. 절대 통과시키지 않는다**("NEVER grants unconfigured").
- 서명은 raw body 에 대한 HMAC-SHA256, **상수시간 비교**.
- 처리 실패는 500 을 돌려 제공자가 재시도하게 한다 — **모든 RPC 가 멱등이어야 성립**한다([`../06_RESILIENCE §5`](../06_RESILIENCE/README.md)).

## 2. 인가 — RPC 레벨

| 규칙 | 사고 |
|---|---|
| **사용자 id 를 인자로 받지 않는다** — `auth.uid()` 로 읽는다 | "넘길 게 없으니 위조할 것도 없다"(mig 232) |
| 불가피하면 IDOR 가드 2변형 중 하나 (mig 098) | 감사에서 일괄 삽입. 현재도 26개 함수가 `p_user_id` 를 받는다 |
| 관리자 기능은 `IF NOT is_admin() THEN RAISE ...` | `is_admin()` 을 부르는 함수 75개 + RLS 정책 3곳 (라이브 스키마 기준) |
| 계량·과금·정책 테이블은 **RLS deny-all** | mig 103 의 `ALTER DEFAULT PRIVILEGES` 때문에 신규 테이블은 DML GRANT 를 자동으로 받는다 — 보호는 RLS 뿐 |
| 예약은 `authenticated`, 과금/정산/해제는 `service_role` | 클라이언트가 스스로 마감할 수 없게 |
| **차단 검증은 권한이 아니라 효과로** (`has_table_privilege` ❌) | deny-all 테이블도 테이블 GRANT 는 살아 있다 |

⚠️ **`REVOKE ... FROM PUBLIC` 은 service_role 의 암묵 EXECUTE 까지 벗긴다.**
mig 098 이 `resolve_api_key` 를 잠그자 엣지의 API 키 인증이 전부 401 이 됐고 mig 107 이 복구했다.
**내부 헬퍼를 잠글 때 엣지가 그 함수를 부르는지 먼저 확인한다.**
> 이 표면(`rc_` 개발자 REST API)은 mig 117 이 `resolve_api_key`/`api_keys` 를 DROP 하고 mig 169 가 계약을 닫으면서 폐기됐다.
> 위 mig 098→107 이야기는 현행 경로가 아니라 **역사적 교훈**으로 남긴다.

⚠️ **RPC 를 건너뛰는 경로가 존재한다.** 클라이언트는 PostgREST 로 테이블에 직접 POST 할 수 있어서
RPC 안에만 있는 규칙(카드 한도)은 우회된다 → statement-level 트리거 백스톱(mig 136).

## 3. 결제 — 돈을 만드는 경로

**채널 3계열**: LemonSqueezy(웹, MoR) · RevenueCat(iOS/Android IAP) · TossPayments(레거시, 크론이 매일 청구 중).

| 규칙 | 이유 |
|---|---|
| 부여(grant)는 **웹훅 → RPC** 로만. 클라이언트가 "샀다"고 말해서 부여하지 않는다 | |
| 모든 부여 RPC 는 **멱등** — `confirm_payment`/`add_ai_credits` 는 `merchant_uid`, 환불 부여는 `ref='refund:<uid>'` | 재전송·이중 적용 안전 |
| 부여는 **인텐트 스냅샷**에서 한다(웹훅 페이로드의 금액을 그대로 믿지 않는다) | `payment_intents` (mig 120) |
| `confirm_payment` 는 `service_role` 전용 (`REVOKE ... FROM PUBLIC, anon, authenticated`) | |
| 결제 상태 SSOT 는 DB 테이블이다. 클라이언트 상태를 신뢰하지 않는다 | |
| 사업자 응답의 "이미 처리됨"만 멱등으로 취급하고, 그 밖의 에러는 502 로 올린다 | 조용한 실패 금지 |

## 4. 환불

`admin-refund` 헤더가 이 도메인의 규범 문서다. 핵심:

- **채널로 분기한다(제공자가 아니라).** RevenueCat 이 정반대 능력의 두 스토어를 대표하기 때문.
- **iOS 는 개발자 환불 API 가 없다.** 접근만 회수하고 **환불했다고 절대 말하지 않는다.** 스토어 불명(`mobile_unknown`)은 iOS 로 취급(fail safe).
- **제공자 시크릿 미설정 → 503.** 돈이 움직이지 않았는데 "환불"이라고 답하지 않는다.
- 응답의 `providerRefunded` 가 **돈이 움직였는지에 대한 유일한 진실**이다. 관리자 UI 는 200 을 환불로 해석하면 안 된다.
- 내부 반전은 멱등(웹훅도 같은 일을 한다).

## 5. 시크릿

| 규칙 | 사고 |
|---|---|
| 시크릿은 `Deno.env`/CI secrets 로만. **저장소에 넣지 않는다** | 공개 저장소 기본 브랜치에 라이브 자격증명 2건이 들어간 적이 있다 — *"제거 커밋도 노출을 되돌리지 못한다. 두 값 모두 git 히스토리에 남고 저장소는 공개다"* → 유출된 것으로 간주하고 회전한다. 별건으로 gitignore 함정: `.gitignore:36` 의 `playwright/.auth/` 는 비후행 슬래시라 .gitignore 위치에 앵커링돼 `packages/web/playwright/.auth/` 를 한 번도 못 덮었다 → `**/playwright/.auth/` 로 교정 |
| 테스트 헬퍼에 **실계정 이메일/비밀번호를 `||` 폴백으로 넣지 않는다** | e2e 헬퍼가 그랬다 |
| service_role 키는 **엣지/서버에만**. `packages/` 에서 참조 0(official-decks CLI 는 예외, `process.env` 로만) | |
| `.claude/settings.local.json` 같은 로컬 설정에 **프로덕션 키를 평문으로 두지 않는다** | 현재 그 파일의 allow 목록에 프로덕션 service_role JWT 가 들어 있다 — **회전 대상** |
| **`supabase secrets set` 은 `config.toml` 의 `[edge_runtime.secrets]` 도 함께 올린다** | 로컬 `GEMINI_API_KEY` 가 프로덕션 텍스트 키를 덮어써 **생성이 401 로 전면 중단**됐다. 올라간 개수가 요청보다 많으면 즉시 확인 |
| 클라이언트에 나가도 되는 키(anon)와 절대 안 되는 키(service_role)의 경계를 코드 리뷰에서 확인 | |

## 6. CI/워크플로 보안

> **`${{ github.event.* }}` 를 `run:` 블록 안에 절대 보간하지 않는다. `env:` 로 넘긴다.**

치환은 bash 파싱 **이전**에 일어나므로 그 값은 셸 **소스코드**다.
한국어 릴리스 제목의 따옴표 한 쌍이 배포를 exit 127 로 죽였고, 같은 자리에 `$(...)` 가 있었다면
**EXPO_TOKEN 을 쥔 러너에서 실행**됐을 것이다. 머지 커밋은 PR 제목을 나르므로 push 권한 없이도 문자열을 넣을 수 있다.

```yaml
# ❌
run: MSG="${{ github.event.head_commit.message }}"
# ✅
env:
  HEAD_COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
run: printf '%s' "$HEAD_COMMIT_MESSAGE" | ...
```

**게이트는 없다.** 현재 `run:` 안에 `${{ }}` 를 보간하는 곳이 3군데다:
- `.github/workflows/deploy-mobile.yml:50` — `MANUAL="${{ github.event.inputs.mode }}"`. 규칙이 금지한 `github.event.*` 그 자체다(값 자체는 `workflow_dispatch` 입력이라 쓰기 권한자만 넣을 수 있다).
- `.github/workflows/ci.yml:94` — `"origin/${{ github.base_ref }}" "${{ github.event.pull_request.head.sha }}"`. 같은 step 이 PR 본문은 `env:` 로 넘기면서(:91) 인자 두 개는 보간한다. 실무 위험은 낮지만(SHA/ref) 규칙 위반이다.
- `.github/workflows/ai-model-watch.yml:74` — `issues: write` 권한(:19-20) 아래에서 71행 `cat > issue.md <<'EOF'` heredoc 안에 `${{ steps.watch.outputs.body }}` 를 보간한다. quoted heredoc 이어도 Actions 치환이 먼저 일어나므로, 프로바이더 API 가 돌려준 문자열에 `EOF` 줄이 들어가면 heredoc 이 조기 종료되고 뒤가 셸로 실행된다. **고쳐야 할 부채.**

## 7. PII 와 로깅

- **AI 응답 로그에 카드 내용을 싣지 않는다.** 드롭 사유 enum + cardId 만 싣는다.
- 엣지 함수에 `console.log/error` 가 107곳 있고 **redaction 헬퍼는 없다.** 새 로그를 추가할 때 사용자 입력·이메일·토큰이 들어가지 않는지 직접 확인한다.
- 에러 메시지를 사용자에게 그대로 노출하지 않는다 — 코드로 분기하고 문구는 로케일에서 고른다([`../03_SERVER_CONTRACT §3`](../03_SERVER_CONTRACT/README.md)).
- 계정 삭제 경로(mig 180)는 **차단 요소를 정리하되 돈 기록은 보존**한다.

## 8. 체크리스트

**엣지 함수를 추가/수정할 때**
- [ ] `verify_jwt` 설정과 그 이유를 헤더에 적었다
- [ ] 웹훅이면 서명 검증 + 시크릿 미설정 시 503
- [ ] CORS 허용목록(`*` 금지)
- [ ] 돈/AI 면 `opsGate()`
- [ ] 새 시크릿을 헤더에 나열했다

**RPC 를 추가할 때**
- [ ] `SECURITY DEFINER` + `SET search_path = public`
- [ ] `auth.uid()` 기반 (또는 IDOR 가드)
- [ ] `REVOKE ... FROM PUBLIC, anon` + 적절한 `GRANT`
- [ ] 내부 헬퍼를 잠갔다면 엣지가 그것을 부르지 않는지 확인
- [ ] 새 테이블이면 RLS 를 켜고 정책을 의도대로 뒀다(deny-all 인지 소유자 정책인지)
- [ ] 권한을 **효과로** 검증하는 SQL 스위트를 만들고 `ci.yml` 에 등록

**돈이 움직이는 변경**
- [ ] 멱등 키가 있다
- [ ] fail-open/fail-closed 를 명시했다
- [ ] 실패 시 net-zero 인가
- [ ] 관련 SQL 스위트를 **변이 테스트**로 확인했다

## 관련 문서
[`../03_SERVER_CONTRACT`](../03_SERVER_CONTRACT/README.md) · [`../04_DATABASE`](../04_DATABASE/README.md) · [`../05_AI_AND_MONEY`](../05_AI_AND_MONEY/README.md) · [`../06_RESILIENCE`](../06_RESILIENCE/README.md) · `DOCS/TODO/SECURITY-REMAINING.md`
