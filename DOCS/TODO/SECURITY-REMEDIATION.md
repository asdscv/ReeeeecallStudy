# 보안 리메디에이션 — 설계 문서

> **Version**: 1.0
> **Created**: 2026-06-25
> **Status**: Phase 1–2 완료(PR #158/#159), Phase 3부터 진행 예정
> **Source**: 2라운드 Supabase 보안 감사(DB/RLS/SECURITY DEFINER 102개 + Edge/Auth/Storage/Secrets)
> **Methodology**: 페이즈별 워크트리 격리 → 구현 → prod 마이그(하위호환 한정 선적용) → PR→develop 머지 → 정리

---

## Phase Summary

| Phase | 항목 | 심각도 | 상태 | PR / Mig |
|-------|------|--------|------|----------|
| — | Quick Create + 1차 감사수정 | — | ✅ 완료 | #157 / 097-100 |
| 1 | H3 TTS 유저별 일일 쿼터 | High | ✅ 완료 | #158 / 101 |
| 2 | H2 평문 API키 제거(show-once) | High | ✅ 완료 | #159 / 102 |
| **3** | **H1 AI키 암호화 시크릿 → Edge** | High | 🔄 H1a/H1b 완료·검증, H1c(구 RPC/테이블 drop) 배포후 | 104 + `ai-keys` edge |
| 4 | H4 REST API service-role → user-JWT | High | 🔲 대기 | — |
| 5 | 작은 항목(N1/M1/L4-L6 + common:loading) | Low~Med | 🔲 대기 | — |
| — | Auth 하드닝(M3/M4/M5) | Med | ⏸ 보류(제품결정) | — |

> 모든 마이그는 idempotent. **하위호환 마이그만 prod 선적용**(097-101). 하위호환 불가(102 DROP, 후속 H1 drop)는 **클라/엣지 배포 후** 적용.
> **Edge 배포 필요**: PR #157(api: template-ownership/getMarketplace/DB_ERROR, tts: escapeSSML), #158(tts: 쿼터) → `supabase functions deploy api tts`.

---

## ⚠️ 배포 순서 규칙
1. 하위호환 마이그(함수 추가/가드/REVOKE/인덱스) = prod 선적용 OK.
2. 하위호환 불가 마이그(컬럼/테이블 DROP, 시그니처 변경) = **현재 배포된 클라/엣지가 해당 객체를 안 쓰게 된 뒤** 적용.
   - mig 102(`DROP COLUMN api_keys.key_plain`): web 배포(SettingsPage가 key_plain select 중단) 후 적용.
3. Edge 함수 변경은 머지만으로 반영 안 됨 → `supabase functions deploy` 필요.

---

## Phase 3 · H1 — AI키 암호화 패스프레이즈를 평문 테이블에서 Vault로

**문제**: `public._ai_encryption_config(id, secret text)`에 pgcrypto 패스프레이즈가 **평문** 저장. RLS deny-all이라 anon 불가하나, service-role 유출/DB 덤프 시 `pgp_sym_decrypt(encrypted_api_key, secret)`로 전 유저의 OpenAI/Anthropic/Google/xAI 키 평문 복원 가능. mig 073(Vault 사용)→mig 074(평문 테이블, PostgREST introspection 404 회피)의 **회귀**.

**현재 사용처**: `get_ai_provider_keys()`, `upsert_ai_provider_key()` (SECURITY DEFINER)가 `SELECT secret FROM _ai_encryption_config WHERE id=1` 후 `pgp_sym_decrypt/encrypt`.

**⚠️ "단순 Vault relocate"는 불가 (확인됨)**: mig 074 주석 — **`vault.decrypted_secrets`를 참조하는 함수는 PostgREST 인트로스펙션에서 제외 → `/rest/v1/rpc` 404**. 즉 `get_ai_provider_keys`/`upsert`를 Vault 읽기로 바꾸면 클라의 `supabase.rpc()`가 404 → AI키 기능 전면 중단(074가 평문으로 되돌린 바로 그 이유). 로테이션 유무와 무관하게 RPC-in-Vault는 막힘.

**올바른 설계 = Edge 함수로 암복호화 이전(감사 권장안)**:
1. 패스프레이즈를 **Supabase Edge 시크릿**(`supabase secrets set AI_KEY_PASSPHRASE=…`, 현재 `_ai_encryption_config.secret`과 **동일 값** → 재암호화 불필요)으로 저장.
2. AI키 get/set을 **Edge 함수**로 구현(예: `functions/ai-keys`): Deno에서 패스프레이즈를 env로 읽어 암복호화(또는 패스프레이즈를 파라미터로 받는 DB 함수 호출). PostgREST RPC가 아니므로 404 무관.
3. web/mobile 클라를 RPC(`supabase.rpc('get_ai_provider_keys')`) → Edge 함수 호출로 전환.
4. **검증** 후에만 DB RPC + `_ai_encryption_config` DROP.

**진행 상태 (2026-06-25)**:
- **H1a (완료·prod 반영)**: mig **104** — 패스프레이즈를 **파라미터로 받는** service-role 전용 함수 3개(`get/upsert/delete_ai_provider_key_secure`) 추가. pgcrypto는 DB에 잔류 → 기존 암호문 **동일 패스프레이즈로 그대로 복호화**(재암호화·로테이션 불필요). Edge 시크릿 `AI_KEY_PASSPHRASE`=현 `_ai_encryption_config.secret` 값으로 설정. `supabase/functions/ai-keys`(JWT 검증→service-role로 *_secure 호출) 작성·배포. **검증**: 기존 암호문 2건 param-패스프레이즈 복호화 OK, 권한 service_role 전용(anon/auth=false), 실유저 JWT로 upsert→list(복호화 확인)→delete→gone 라운드트립 OK.
- **H1b (완료·이 PR)**: 공유 `supabase-backend.ts`를 `supabase.rpc()` 3종 → `functions.invoke('ai-keys')`로 전환(web+mobile 동시). 타입체크 0에러(web/mobile), secure-storage 29/29, `.js` emit 없음. **머지→main 배포 시 클라가 신규 경로 사용**. 구 RPC(`get/upsert/delete_ai_provider_key`)·`_ai_encryption_config`는 폴백으로 잔류.
- **H1c (보류 — 배포 후)**: web(Cloudflare) + mobile(OTA/스토어) 클라가 모두 신규 경로로 전환·배포·검증된 **뒤에만** 구 RPC 3종 + `_ai_encryption_config` 테이블 DROP(하위호환 불가 → 배포 순서 규칙 적용). 모바일 OTA runtimeVersion 게이팅상 구 빌드 잔존 가능 → 충분한 마진 후 drop.

---

## Phase 4 · H4 — REST API를 service-role에서 요청별 user-JWT로

**문제**: `supabase/functions/api/index.ts`(1361줄)가 **유일 클라이언트로 service-role 사용**(`supabaseAdmin()`), 모든 핸들러가 RLS 우회. 인가는 100% 수기 `.eq('user_id', …)`. 현 시점 누락 없음(침해 없음)이나, 향후 필터 하나 누락 시 즉시 교차 테넌트. **multiplier**.

**설계**:
1. 인증 미들웨어에서 요청의 Authorization(API key→resolve_api_key→user_id)으로 **user-scoped supabase 클라이언트** 생성(`createClient(url, anon, { global: { headers: { Authorization } } })`) → 핸들러가 RLS 적용 클라이언트 사용.
   - 단, 이 API는 자체 API key(`rc_...`) 인증이라 Supabase JWT가 아님 → user-JWT 주입이 단순치 않음. 대안: (a) resolve 후 해당 user의 JWT를 service-role로 발급/임퍼서네이트, 또는 (b) service-role 유지하되 **중앙 인가 레이어**(모든 쿼리에 user_id 강제 주입하는 래퍼)로 누락 불가능하게 만들고 통합 테스트로 가드.
2. 권장 1차: **중앙 인가 래퍼 + 핸들러별 통합 테스트**(각 핸들러가 타 유저 행 접근 거부 검증) — RLS 재적용보다 점진적·저리스크. 완전 RLS 복원은 2차.
3. 조정 배포(엣지 deploy) 필요.

**리스크**: 대규모 리팩터, 회귀. 핸들러별 before/after 동작 보존 + E2E 필수.

---

## Phase 5 · 작은 항목(자율 진행 가능)

- **N1**: `createCards` `next_position` 비원자(read-modify-write) → 동시 배치 시 sort_position 충돌. DB RPC(`INSERT…SELECT` + 행잠금 / sequence)로 원자화. 동일유저·정렬만 영향(저).
- **M1**: api 인메모리 레이트리밋(isolate별 Map → fan-out 우회) → Postgres 원자 카운터 RPC(`user_id+window`)나 Upstash로 공유. createCards 배치 100 캡은 이미 있음.
- **L6**: prod `uri_allow_list`에서 `http://localhost:5173/auth/callback` 제거(로컬→prod OAuth 개발 깨짐 주의 — 별도 dev 프로젝트 권장).
- **L4/L5**: api+tts CORS `*` → GoTrue allow-list 기준 origin 화이트리스트(정당 origin 집합 확인 필요).
- ~~**common:loading**: web/mobile QuickCreate가 `common:loading` 사용하나 common.json에 키 없음 → i18n-key-usage 실패.~~ ✅ **완료**(이 PR): web 8 + mobile 8 common.json에 `loading` 추가. i18n-key-usage 3/3 + 파리티 135 통과.

---

## ⏸ Auth 하드닝(M3/M4/M5) — 보류(제품 결정)
가입·로그인 UX 변경이라 사용자 결정 대기.
- **M3**: `mailer_autoconfirm=false` + 실 SMTP, 또는 OAuth-only(이메일 미검증 가입 차단).
- **M4**: hcaptcha 프로바이더 provision + web/mobile에 `captchaToken` 배선(`signInWithPassword/signUp/resetPasswordForEmail`). 반쪽 롤아웃 시 클라 깨짐.
- **M5**: `password_min_length≥10`, `password_hibp_enabled=true`(유출 비번 차단; 신규 set/change만 영향), 선택 complexity.

---

## 미감사(별도 검토 필요)
Edge prod 시크릿/env 인벤토리 · 스토리지 정책 런타임 업로드 테스트 · `--no-verify-jwt` 배포설정(config.toml [functions]) · MFA 등록율(특히 admin) · `vault.secrets` 잔여 1건(073 잔재) 생사 확인. (pg_cron/pg_net 미설치 — DB cron/SSRF 표면 없음.)
