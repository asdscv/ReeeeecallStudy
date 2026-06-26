# 보안 리메디에이션 — 설계 문서 (완료 기록)

> **Version**: 2.0 (완료)
> **Created**: 2026-06-25 · **Closed**: 2026-06-26
> **Status**: ✅ **H1·H2·H3·N1·M1 완료 + prod 배포**. 남은 항목(H4·L4/L5·H1c·보류 L6/Auth)은 → [`DOCS/TODO/SECURITY-REMAINING.md`](../TODO/SECURITY-REMAINING.md)로 이관.
> **Source**: 2라운드 Supabase 보안 감사(DB/RLS/SECURITY DEFINER 102개 + Edge/Auth/Storage/Secrets)
> **Methodology**: 페이즈별 워크트리 격리 → 구현 → 독립 적대적 감사 → prod 마이그(하위호환 한정 선적용) → PR→develop 머지 → develop→main 배포 → 정리

---

## Phase Summary

| Phase | 항목 | 심각도 | 상태 | PR / Mig |
|-------|------|--------|------|----------|
| — | Quick Create + 1차 감사수정 | — | ✅ 완료·배포 | #157 / 097-100 |
| 1 | H3 TTS 유저별 일일 쿼터 | High | ✅ 완료·배포 | #158 / 101 |
| 2 | H2 평문 API키 제거(show-once) | High | ✅ 완료·배포 | #159 / 102 |
| **3** | **H1 AI키 암호화 시크릿 → Edge** | High | ✅ **H1a/H1b 완료·배포** (H1c=배포후 잔여 → REMAINING) | #165/#166/#167 · 104 + `ai-keys` edge |
| 4 | H4 REST API service-role → user-JWT | High | 🔲 **이관 → REMAINING** | — |
| 5a | N1 카드 sort_position 원자 예약 | Low | ✅ 완료·배포 | #168/#169 · 105 |
| 5b | M1 공유 레이트리미터 | Med | ✅ 완료·배포 | #170/#172 · 106 |
| 5c | L4/L5 CORS 화이트리스트 | Low | 🔲 **이관 → REMAINING** | — |
| 5d | L6 localhost uri_allow_list 제거 | Low | ⏸ **보류**(사용자 결정 2026-06-26 — 로컬 OAuth 개발 깨짐) | — |
| 5e | common:loading 키 | — | ✅ 완료 | #157 |
| — | Auth 하드닝(M3/M4/M5) | Med | ⏸ 보류(제품결정) | — |

> 모든 마이그는 idempotent. **하위호환 마이그만 prod 선적용**(097-101, 104-106). 하위호환 불가(102 DROP, 후속 H1c drop)는 **클라/엣지 배포 후** 적용.
> Edge 배포 완료: `api`(template-ownership/getMarketplace/DB_ERROR/N1/M1), `tts`(escapeSSML/쿼터), `ai-keys`(H1) — 전부 `supabase functions deploy` 완료.
> **남은 항목은 [`DOCS/TODO/SECURITY-REMAINING.md`](../TODO/SECURITY-REMAINING.md) 참조.**

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

**진행 상태 (✅ 완료·배포 2026-06-25~26; PR #165/#166→develop, #167→main)**:
- **H1a (완료·prod 반영)**: mig **104** — 패스프레이즈를 **파라미터로 받는** service-role 전용 함수 3개(`get/upsert/delete_ai_provider_key_secure`) 추가. pgcrypto는 DB에 잔류 → 기존 암호문 **동일 패스프레이즈로 그대로 복호화**(재암호화·로테이션 불필요). Edge 시크릿 `AI_KEY_PASSPHRASE`=현 `_ai_encryption_config.secret` 값으로 설정. `supabase/functions/ai-keys`(JWT 검증→service-role로 *_secure 호출) 작성·배포. **검증**: 기존 암호문 2건 param-패스프레이즈 복호화 OK, 권한 service_role 전용(anon/auth=false), 실유저 JWT로 upsert→list(복호화 확인)→delete→gone 라운드트립 OK.
- **H1b (완료·이 PR)**: 공유 `supabase-backend.ts`를 `supabase.rpc()` 3종 → `functions.invoke('ai-keys')`로 전환(web+mobile 동시). 타입체크 0에러(web/mobile), secure-storage 29/29, `.js` emit 없음. **머지→main 배포 시 클라가 신규 경로 사용**. 구 RPC(`get/upsert/delete_ai_provider_key`)·`_ai_encryption_config`는 폴백으로 잔류.
- **H1c (배포 후 잔여 → REMAINING)**: web(Cloudflare) + mobile(OTA/스토어) 클라가 모두 신규 경로로 전환·배포·검증된 **뒤에만** 구 RPC 3종 + `_ai_encryption_config` 테이블 DROP(하위호환 불가). 모바일 OTA runtimeVersion 게이팅상 구 빌드 잔존 가능 → 충분한 마진 후 drop. 상세는 [`SECURITY-REMAINING.md`](../TODO/SECURITY-REMAINING.md).

---

## Phase 4 · H4 / Phase 5 L4·L5 — 이관됨

미완료 항목(**H4** REST API service-role→user-JWT 대형 리팩터, **L4/L5** api+tts CORS 화이트리스트, **H1c** 잔여 drop)은 별도 진행을 위해 [`DOCS/TODO/SECURITY-REMAINING.md`](../TODO/SECURITY-REMAINING.md)로 이관했다. 이 문서는 완료분(H1·H2·H3·N1·M1)의 기록이다.

---

## Phase 5 · 완료 기록 (N1·M1)

- **N1 (✅ 완료·배포, #168/#169, mig 105)**: `createCards`/`createCard` + api edge fn의 `next_position` read-modify-write 레이스 → `reserve_card_positions(p_deck_id,p_count)` 원자 RPC(`UPDATE…RETURNING`, 행잠금). 소유자/service_role만, p_count≤100000 상한. card-store 3경로 전환.
- **M1 (✅ 완료·배포, #170/#172, mig 106)**: api 인메모리 레이트리밋(isolate별 Map → fan-out 우회) → `api_rate_limits` + `check_rate_limit` 원자 카운터(RLS deny-all + service_role 전용, fixed-window, count 상한, fail-open). `rate-limit.ts` 전환.
- **common:loading**: ✅ 완료(#157).

---

## ⏸ Auth 하드닝(M3/M4/M5) — 보류(제품 결정)
가입·로그인 UX 변경이라 사용자 결정 대기. 상세는 [`SECURITY-REMAINING.md`](../TODO/SECURITY-REMAINING.md).
- **M3**: `mailer_autoconfirm=false` + 실 SMTP, 또는 OAuth-only.
- **M4**: hcaptcha provision + web/mobile `captchaToken` 배선.
- **M5**: `password_min_length≥10`, `password_hibp_enabled=true`.

---

## 미감사(별도 검토 필요 → REMAINING)
Edge prod 시크릿/env 인벤토리 · 스토리지 정책 런타임 업로드 테스트 · `--no-verify-jwt` 배포설정(config.toml [functions]) · MFA 등록율(특히 admin) · `vault.secrets` 잔여 1건(073 잔재) 생사 확인. (pg_cron/pg_net 미설치 — DB cron/SSRF 표면 없음.)
