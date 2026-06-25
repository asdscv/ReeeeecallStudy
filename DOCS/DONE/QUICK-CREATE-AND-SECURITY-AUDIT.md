# Quick Create + Security Audit — DONE

Status: **SHIPPED** (branch `quick-create-easy-flow` → develop). Migrations 097–100 applied to prod (ixdapelfikaneexnskfm) at author time; edge fixes committed and require `supabase functions deploy`.

## 1. Quick Create (간편 만들기) — customer feedback "카드/덱 추가가 너무 어렵다"
Additive simple-create flow alongside the untouched advanced flow:
- Web `QuickCreateModal` + mobile `QuickCreateScreen`: deck name → pick a built-in default-template preset (앞/뒤, 영어 단어, 중국어 단어) → type cards inline → create.
- Root-cause fix: accounts created before mig 036 had ZERO templates → `default_template_id` NULL → card form dead-end. `ensure_default_templates()` RPC + idempotent `_seed_default_templates` + backfill (mig 097) + `createDeck` self-heal + DeckDetail/CardEdit heal.
- CardFormModal "Add & Create Another"; default-template picks scoped to `user_id` (don't adopt a subscribed publisher's template).
- AI generate page i18n fixed (hardcoded TTS/layout strings + missing `errors.serverError`, all 8 locales).

## 2. Security audit (2 rounds) — DB/RLS/functions + Edge/Auth/Storage/Secrets
Fixed + applied to prod:
- **097** ensure_default_templates (+ REVOKE _seed from PUBLIC/anon/authenticated — Supabase default-privilege gotcha).
- **098** IDOR guards on 10 SECURITY DEFINER fns (`p_user_id <> auth.uid()` reject, service_role bypass) + search_path on 6 fns + REVOKE resolve_api_key/increment_acquire_count + view security_invoker + `card_templates(user_id,name)` UNIQUE.
- **099** copy_deck_for_user authz guard (was zero-authz → any-deck exfiltration) + server-side `accept_invite()` RPC + DROP the anon `deck_shares` pending-invite leak policy + client rewire.
- **100** storage bucket size/mime limits.
- Edge (committed, deploy pending): tts `escapeSSML(voice)`, api template-ownership checks, getMarketplace `is_active`, DB_ERROR genericized.

Verified: web tsc/parity(135)/build/Playwright(incl. live guard-rejection E2E), mobile tsc/Metro bundle, prod live re-checks.

## 3. OPEN — needs product decision (tracked, NOT applied)
H1 AI-key passphrase plaintext in `_ai_encryption_config` (→ Vault/Edge secret + rotate) · H2 `api_keys.key_plain` plaintext (→ show-once + drop column) · H3 TTS no quota (→ per-user limit) · H4 REST API runs as service_role (→ per-request user-JWT) · M1 isolate-local rate limiter · M3 email autoconfirm · M4 captcha off · M5 weak password policy · L4–L6 CORS/localhost allowlist · N1 next_position non-atomic.

To be tackled sequentially, each in an isolated worktree.

## 4. Not yet audited
Edge prod secret inventory · storage policy runtime upload test · `--no-verify-jwt` deploy setting · MFA enrollment (esp. admin) · vault.secrets dead-row check. (pg_cron/pg_net not installed.)
