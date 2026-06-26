# 보안 로드맵 — 남은 항목 (설계 문서)

> **Version**: 1.0
> **Created**: 2026-06-26
> **Status**: H1·H2·H3·N1·M1 완료·배포 후 잔여 항목. 완료 기록은 → [`DOCS/DONE/2026-06-26-security-remediation.md`](../DONE/2026-06-26-security-remediation.md)
> **Source**: 2라운드 Supabase 보안 감사(DB/RLS/SECURITY DEFINER + Edge/Auth/Storage/Secrets)
> **Methodology**: 페이즈별 워크트리 격리 → 구현 → 독립 적대적 감사 → prod 마이그(하위호환 한정 선적용) → PR→develop→main → `supabase functions deploy` → 정리
> **prod ref**: `ixdapelfikaneexnskfm` (Management API SQL endpoint로 마이그 적용; 자격증명은 메모리 `reference_credentials` 참조)

---

## 우선순위 요약

| # | 항목 | 심각도 | 규모/리스크 | 게이트 |
|---|------|--------|-------------|--------|
| 1 | **H4** REST API service-role → 중앙 인가/user-JWT | High(멀티플라이어, 현 침해 없음) | **대형·고위험** (api/index.ts 1361줄) | 새 세션 권장 |
| 2 | **L4/L5** api+tts CORS `*` → origin 화이트리스트 | Low | 소형, 단 **정당 origin 집합 확정 필요** | origin 결정 |
| 3 | **H1c** 구 AI키 RPC + `_ai_encryption_config` DROP | (H1 잔여) | 소형, 단 **하위호환 불가** | **모바일 OTA 채택** |
| — | **L6** localhost uri_allow_list 제거 | Low | 소형 | ⏸ **보류**(사용자 결정 — 로컬 OAuth 개발 깨짐) |
| — | **Auth M3/M4/M5** 가입/로그인 하드닝 | Med | UX 변경 | ⏸ **보류**(제품 결정) |
| — | 미감사 표면 | — | 조사 | 별도 |

> ⚠️ **배포 순서 규칙**: 하위호환 마이그(함수 추가/가드/REVOKE/인덱스)는 prod 선적용 OK. 하위호환 불가(컬럼/테이블 DROP·시그니처 변경)는 **현재 배포된 클라/엣지가 해당 객체를 안 쓰게 된 뒤** 적용. Edge 함수 변경은 머지만으로 반영 안 됨 → `supabase functions deploy <fn>` 필수.

---

## 1. H4 — REST API를 service-role에서 중앙 인가/요청별 user-JWT로

**문제**: `supabase/functions/api/index.ts`(~1361줄, 외부 `rc_...` API key 소비자용)가 **유일 클라이언트로 service-role 사용**(`supabaseAdmin()`) → 모든 핸들러가 RLS 우회. 인가가 100% 수기 `.eq('user_id', …)`. 현재 누락 없음(라이브 침해 아님)이나, 향후 핸들러 하나에서 필터가 빠지면 즉시 교차 테넌트 유출. = **멀티플라이어 리스크**.

**제약**: 이 API는 자체 API key 인증(`rc_...` → `resolve_api_key` → user_id)이라 **Supabase JWT가 아님**. 따라서 "요청별 user-JWT 클라이언트로 RLS 재적용"이 단순치 않음(유저 JWT를 발급/임퍼소네이트해야 함).

**권장 설계 (2단계, 저리스크 우선)**:
1. **1차 — 중앙 인가 래퍼(권장 시작점)**: service-role은 유지하되, 핸들러가 직접 `sb.from(...)`를 쓰지 못하게 하고 **모든 쿼리에 `user_id` 스코프를 강제 주입**하는 얇은 래퍼(예: `scopedDb(c)` → 반환 객체가 `.from(table)` 시 자동으로 `.eq('user_id', userId)` 적용 / 쓰기 시 `user_id` 강제)로 교체. 한 곳에서 누락 불가능하게.
   - 핸들러별 **통합 테스트**: 각 엔드포인트가 "타 유저 소유 행"에 대해 read/update/delete/insert 거부됨을 검증(현 `tests/integration/marketplace-acquire.spec.ts` fresh-login 패턴 재사용; 두 유저 생성 → A의 토큰으로 B의 리소스 접근 시도 → 거부).
2. **2차(선택) — 완전 RLS 복원**: resolve 후 해당 user의 단기 JWT를 service-role로 발급하여 `createClient(url, anon, { global: { headers: { Authorization: Bearer <userJwt> } } })`로 요청별 클라이언트 생성 → DB RLS가 직접 방어. 1차보다 침투적.

**작업 순서**:
- (a) 현 핸들러 전수 인벤토리: 각 핸들러가 만지는 테이블 + 현재 `.eq('user_id')` 위치 표로 정리(누락 후보 식별).
- (b) `scopedDb` 래퍼 작성 + 전 핸들러 전환(읽기 자동 스코프, 쓰기 user_id 강제, service_role 전용 경로만 예외 명시).
- (c) 핸들러별 cross-tenant 거부 통합 테스트 추가(CI Integration 잡에 포함).
- (d) `supabase functions deploy api`.

**리스크/주의**: 대규모 리팩터 → 핸들러별 before/after 동작 보존 필수. before/after 응답 스냅샷 + E2E. 단계적 배포(엣지는 즉시 전체 반영되므로 통합 테스트가 안전망). **컨텍스트가 큰 작업 → 새 세션에서 집중 권장.**

---

## 2. L4/L5 — api + tts Edge 함수 CORS 와일드카드 제거

**문제**: `supabase/functions/api/index.ts`(`app.use('*', cors())` 기본 `*`)와 `tts`가 `Access-Control-Allow-Origin: *`. 베어러 인증이라 CSRF 직접 악용은 아님(쿠키 미사용)이나, 복호화 키/생성물 왕복 표면이라 origin 제한이 방어심화에 유익.

**선행 — 정당 origin 집합 확정(필수)**:
- 웹 prod 도메인(Cloudflare): `https://reeeeecallstudy.<...>` (실제 도메인 확인).
- 모바일: 네이티브 fetch는 CORS 비대상(Origin 헤더 없음) → 화이트리스트가 모바일을 막지 않는지 확인(없는 Origin은 통과시키거나 모바일 경로 예외).
- 외부 API 소비자(`rc_...`): 보통 서버-사이드(브라우저 아님) → CORS 무관. **단 브라우저 기반 외부 통합이 있으면 깨질 수 있음** → api는 신중히(허용 목록을 넓게 두거나 api는 `*` 유지하고 tts만 조이는 선택지 고려).
- GoTrue `uri_allow_list` / Cloudflare 설정에서 실제 사용 origin 교차 확인.

**설계**: 두 Edge 함수의 `corsHeaders` Origin을 요청 `Origin`이 화이트리스트에 있을 때만 반향(echo)하고, 아니면 허용 안 함. `Vary: Origin` 추가. 환경변수(`ALLOWED_ORIGINS`)로 목록 주입.

**검증**: 정당 origin에서 web/mobile AI생성·TTS 정상; 임의 origin에서 CORS 차단. **배포 후 web/mobile 실사용 스모크 필수**(잘못 조이면 기능 중단).

---

## 3. H1c — 구 AI키 경로 제거 (H1 잔여, 배포·채택 게이트)

**현 상태**: H1a/b 완료·배포 → 클라(web 즉시, mobile OTA)가 `ai-keys` Edge 함수 경유로 전환됨. 구 RPC `get/upsert/delete_ai_provider_key` + 평문 패스프레이즈 테이블 `_ai_encryption_config`는 **폴백으로 잔류**. **at-rest 평문 패스프레이즈 취약점은 H1c까지 완전히 닫히지 않음.**

**게이트(중요)**: 구 모바일 빌드가 여전히 구 RPC(→ `_ai_encryption_config` 읽기)를 호출 가능. OTA runtimeVersion 게이팅상 구 빌드가 한동안 잔존 → **충분한 OTA 채택 마진 전에는 DROP 금지**(드롭 시 미갱신 유저 AI키 기능 중단).

**절차(채택 확인 후)**:
1. 잔여 호출 확인: prod에서 구 RPC 호출 로그/사용량이 0에 수렴하는지(가능하면 PostgREST 로그/메트릭).
2. 마이그(하위호환 불가): `DROP FUNCTION get_ai_provider_keys/upsert_ai_provider_key/delete_ai_provider_key`(구 시그니처) + `DROP TABLE _ai_encryption_config`. **prod 선적용 금지** — 클라가 구 경로를 완전히 버린 뒤에만.
3. `vault.secrets` 잔여 1건(073 잔재) 생사 확인 후 정리(미감사 항목과 연계).
4. (선택) 패스프레이즈 로테이션: Edge 시크릿 `AI_KEY_PASSPHRASE` 교체 + `user_ai_provider_keys` 전수 재암호화(Edge 일괄). H1c와 독립적 후속.

---

## ⏸ 보류 항목

### L6 — prod `uri_allow_list`에서 `http://localhost:5173/auth/callback` 제거
**보류(사용자 결정 2026-06-26)**: 제거 시 로컬→prod Supabase OAuth 로그인 개발이 깨짐. 잔여 리스크 낮음(localhost redirect 악용은 이미 다른 침해 선행 필요). 별도 dev Supabase 프로젝트 마련 시 재검토.

### Auth 하드닝 M3/M4/M5 — 보류(제품 결정)
가입·로그인 UX 변경이라 사용자 결정 대기. **반쪽 롤아웃 시 클라 깨짐 주의**(특히 M4).
- **M3**: `mailer_autoconfirm=false` + 실 SMTP, 또는 OAuth-only(이메일 미검증 가입 차단).
- **M4**: hcaptcha 프로바이더 provision + web/mobile에 `captchaToken` 배선(`signInWithPassword/signUp/resetPasswordForEmail`).
- **M5**: `password_min_length≥10`, `password_hibp_enabled=true`(유출 비번 차단; 신규 set/change만 영향), 선택 complexity.

---

## 미감사 표면(별도 조사 필요)
- Edge prod 시크릿/env 인벤토리(불필요/노출 키 점검).
- 스토리지 정책 런타임 업로드 테스트(mig 100 버킷 제한이 실제 적용되는지).
- `--no-verify-jwt` 배포 설정(`config.toml [functions]`) — 함수별 JWT 게이트 확인.
- MFA 등록율(특히 admin 계정).
- `vault.secrets` 잔여 1건(073 잔재) 생사 — H1c와 함께 정리.
- (pg_cron/pg_net 미설치 확인됨 — DB cron/SSRF 표면 없음.)
