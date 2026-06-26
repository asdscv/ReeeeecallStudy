# 보안 로드맵 — 남은 항목 (설계 문서)

> **Version**: 2.0
> **Created**: 2026-06-26 · **Updated**: 2026-06-26
> **Status**: 🎉 **actionable 항목 전부 완료·배포** (H1·H2·H3·H4·N1·M1·L4·L5). 남은 건 **게이트/제품결정 대기**(H1c·L6·Auth)뿐.
> **완료 기록**: [`DOCS/DONE/2026-06-26-security-remediation.md`](../DONE/2026-06-26-security-remediation.md)
> **prod ref**: `ixdapelfikaneexnskfm` (Management API SQL; 자격증명은 메모리 `reference_credentials`)

---

## 완료 (이 라운드, 2026-06-26)

| 항목 | 내용 | PR / Mig |
|------|------|----------|
| **L4/L5** | api+tts CORS `*` → origin 화이트리스트 (+ **worker.js**가 실제 브라우저 경계라 함께 수정) | #174/#175 · `ALLOWED_ORIGINS` |
| **H4** | REST API 핸들러 cross-tenant 자기-스코프 하드닝 + deleteTemplate 404 게이트 + mig 107(resolve_api_key service_role EXECUTE 복원) + cross-tenant 통합테스트(CI 9/9 실행) | #176/#177 · 107 |
| 정리 | orphan `vault.secrets('ai_key_encryption_secret')` 삭제(073 잔재, 값 불일치·참조 0 = 데드) | prod 직접 |

> **H4 핵심 발견(미변경)**: prod REST API는 플랫폼 게이트웨이 `verify_jwt=true`로 raw `rc_` 키가 핸들러 도달 전 차단됨(`UNAUTHORIZED_INVALID_JWT_FORMAT`) → **외부 비기능/노출 0**. verify_jwt를 끄는 건 공개 API를 *노출*하는 제품 결정이라 하지 않음. 하드닝은 활성화 시 안전 보장.

---

## 남은 항목 (게이트/보류 — 코드 작업 아님)

### H1c — 구 AI키 RPC + `_ai_encryption_config` DROP  ⏸ 배포·채택 게이트
H1a/b 완료·배포로 클라(web 즉시, mobile OTA)는 `ai-keys` Edge 경유. 구 RPC(`get/upsert/delete_ai_provider_key`) + 평문 패스프레이즈 테이블 `_ai_encryption_config`는 폴백 잔류. **at-rest 평문 패스프레이즈는 H1c까지 완전히 닫히지 않음.**
- **게이트**: 구 모바일 빌드가 구 RPC(→ 테이블 읽기)를 호출 가능 → OTA runtimeVersion 게이팅상 구 빌드 잔존. **충분한 OTA 채택 마진 전 DROP 금지**(드롭 시 미갱신 유저 AI키 기능 중단). **구체 날짜 없음** — 채택률 확인 후 진행.
- **절차**: 구 RPC 호출 로그가 0 수렴 확인 → `DROP FUNCTION get/upsert/delete_ai_provider_key`(구 시그니처) + `DROP TABLE _ai_encryption_config`(하위호환 불가 → 클라 전환 완료 후에만). (선택) 패스프레이즈 로테이션 + 전수 재암호화.

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
| verify_jwt 배포설정 | `api`=true(게이트웨이가 rc_ 차단 → 외부 비기능), `tts`/`ai-keys`=true(유저 JWT로 동작). config.toml에 per-fn override 없음 — 플랫폼 기본. |
| MFA 등록 | TOTP enroll/verify **가능**(max 10), 단 **미강제**. admin 강제 정책 없음 → Auth 하드닝(보류)과 함께 검토. |
| Edge prod 시크릿 | `AI_KEY_PASSPHRASE`·`ALLOWED_ORIGINS`·`SUPABASE_*` 정상. 불필요/노출 키 없음. |

남은 미감사: 라이브 스토리지 업로드 정책 런타임 테스트(제한값은 확인됨, 실제 거부 동작은 미테스트) — 저우선.
