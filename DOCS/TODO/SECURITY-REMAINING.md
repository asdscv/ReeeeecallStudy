# 보안 로드맵 — 남은 항목 (설계 문서)

> **Version**: 2.0
> **Created**: 2026-06-26 · **Updated**: 2026-06-26
> **Status**: 🎉 **actionable 항목 전부 완료·배포** (H1·H2·H3·H4·N1·M1·L4·L5). 남은 건 **게이트/제품결정 대기**(H1c·L6·Auth)뿐.
> **완료 기록**: [`DOCS/DONE/2026-06-26-security-remediation.md`](../DONE/2026-06-26-security-remediation.md)
> **2026-07-29 update:** customer/developer `rc_` REST API was retired. Migration 117 removed `api_keys`/`resolve_api_key`; migration 169 is the idempotent contract close. H4 below is retained only as historical remediation context and is no longer an active surface.
> **prod ref**: `ixdapelfikaneexnskfm` (Management API SQL; 자격증명은 메모리 `reference_credentials`)

> **2026-07-30 확인**: 코드 작업 잔여 **0**. 남은 H1c·L6·Auth M3/M4/M5 는 전부
> **프로덕션 액션 또는 제품 결정 게이트**다(`uri_allow_list` 는 로컬 개발 편의,
> Auth 하드닝은 가입/로그인 UX 변경). 자율 진행 대상이 아니므로 소유자 결정까지 TODO 에 남긴다.
> **H1c 갱신(2026-07-30)**: BYOK 기능 폐기 결정 → 클라/Edge/i18n 제거 + DROP 마이그레이션(170) 작성 완료.
> 남은 건 prod 적용·`ai-keys` 함수 삭제·`AI_KEY_PASSPHRASE` 시크릿 삭제뿐(소유자 승인 필요).
---

## 완료 (이 라운드, 2026-06-26)

| 항목 | 내용 | PR / Mig |
|------|------|----------|
| **L4/L5** | api+tts CORS `*` → origin 화이트리스트 (+ **worker.js**가 실제 브라우저 경계라 함께 수정) | #174/#175 · `ALLOWED_ORIGINS` |
| **H4** | REST API 핸들러 cross-tenant 자기-스코프 하드닝 + deleteTemplate 404 게이트 + mig 107(resolve_api_key service_role EXECUTE 복원) + cross-tenant 통합테스트(CI 9/9 실행) | #176/#177 · 107 |
| 정리 | orphan `vault.secrets('ai_key_encryption_secret')` 삭제(073 잔재, 값 불일치·참조 0 = 데드) | prod 직접 |

> **H4 retirement note (2026-07-29):** this hardened-but-dormant endpoint was subsequently removed rather than enabled. No `rc_` gateway/authentication path remains.

---

## 남은 항목 (게이트/보류 — 코드 작업 아님)

### H1c — 구 AI키 RPC + `_ai_encryption_config` DROP  ✅ 코드 준비 완료 / ⏸ prod 적용만 소유자 게이트
**2026-07-30 결정: BYOK(고객이 자기 AI 프로바이더 키를 등록) 기능을 폐기**했다. 서버측 생성(우리 키 + 미터링)이
그 자리를 대체했고, 클라이언트(web/mobile)·Edge 함수(`ai-keys`)·i18n·가이드 문구까지 전부 제거됐다
(브랜치 `chore/remove-byok`). 따라서 "구 빌드 호환" 게이트는 사라졌다 — 구 RPC를 호출하는 구 모바일 빌드는
**기능 자체가 없어졌으므로** 보존 대상이 아니다.
- **마이그레이션**: `170_remove_byok_provider_keys.sql` — 구 RPC 3종(`get/upsert/delete_ai_provider_key`) +
  service-role `_secure` RPC 3종(mig 104) + `user_ai_provider_keys` + **평문 패스프레이즈 테이블
  `_ai_encryption_config`** 를 전부 DROP. 멱등(`IF EXISTS`/`to_regprocedure` 가드) — 로컬 postgres-15 에서
  전체 마이그레이션 체인 적용 + 2회 재적용 + BYOK 객체 소멸/생성경로 온존 어서션 통과.
- **남은 액션(소유자)**: ① prod 에 mig 170 적용 → at-rest 평문 패스프레이즈 표면 **완전 폐쇄**.
  ② `supabase functions delete ai-keys` (배포된 함수 제거). ③ Edge 시크릿 `AI_KEY_PASSPHRASE` 삭제.
  ⚠️ ①은 **비가역** — 저장된 고객 프로바이더 키가 전부 삭제된다(기능 폐기 결정에 따른 의도된 동작).

### L6 — prod `uri_allow_list`에서 `localhost:5173` 제거  ⏸ 보류(사용자 결정 2026-06-25)
제거 시 로컬→prod Supabase OAuth 개발이 깨짐. 잔여 리스크 낮음. 별도 dev 프로젝트 마련 시 재검토.

### Auth M3/M4/M5 — 가입/로그인 하드닝  ⏸ 보류(제품 결정)
가입·로그인 UX 변경이라 사용자 결정 대기. **반쪽 롤아웃 시 클라 깨짐 주의(특히 M4)**. 현 prod 확인값:
- **M3**: `mailer_autoconfirm=true` + open signup(`disable_signup=false`) → 이메일 미검증 가입. 실 SMTP 또는 OAuth-only로.
- **M4**: `security_captcha_enabled=false`. hcaptcha provision + web/mobile `captchaToken` 배선.
- **M5**: `password_min_length=6`, complexity/HIBP off → `≥10` + `password_hibp_enabled=true`.

---

## 미감사 표면 — 조사 완료 (2026-06-26)

| 표면 | 결과 |
|------|------|
| 스토리지 버킷 제한(mig 100) | ✅ prod 적용 확인 (card-images/content-images 5MB jpeg/png/webp, card-audio 10MB mpeg/ogg/wav) |
| `vault.secrets` 잔여행 | ✅ 데드 orphan 1건 삭제 완료 |
| pg_cron / pg_net | 미설치 확인 (DB cron/SSRF 표면 없음) |
| verify_jwt 배포설정 | 고객 `api` endpoint는 제거됨. `tts`는 유저 JWT로 동작(`ai-keys`는 BYOK 폐기와 함께 삭제). config.toml에 customer API override 없음. |
| MFA 등록 | TOTP enroll/verify **가능**(max 10), 단 **미강제**. admin 강제 정책 없음 → Auth 하드닝(보류)과 함께 검토. |
| Edge prod 시크릿 | `ALLOWED_ORIGINS`·`SUPABASE_*` 정상. 불필요/노출 키 없음. `AI_KEY_PASSPHRASE`는 BYOK 폐기로 **삭제 대상**(H1c). |

남은 미감사: 라이브 스토리지 업로드 정책 런타임 테스트(제한값은 확인됨, 실제 거부 동작은 미테스트) — 저우선.
