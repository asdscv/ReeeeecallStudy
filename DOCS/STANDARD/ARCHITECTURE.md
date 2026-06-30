# ARCHITECTURE STANDARD — ReeeeecallStudy

> Conventions every change must follow. Established from the existing codebase +
> security audit history (migs 097–107). Update this doc when a convention
> changes; cite it in design docs under `DOCS/TODO`.

## 1. Monorepo layout
- `packages/shared` — framework-agnostic core (stores, lib, ai, secure-storage).
  **Web re-exports shared stores/lib** — a shared change affects web + its tests.
- `packages/web` — React + Vite. `packages/mobile` — React Native/Expo.
- `supabase/` — `migrations/`, `functions/` (Deno edge), `rollbacks/`.

## 2. Database & migrations
- Sequential `NNN_name.sql`. **Never edit an applied migration** — add a new one.
  Next free number wins; check `ls supabase/migrations | tail`.
- **All writes go through `SECURITY DEFINER` RPCs** — no direct INSERT/UPDATE via
  RLS from clients. Every definer fn: `SET search_path = public`.
- A definer fn that takes a caller-supplied `p_user_id`/`p_recipient_id` MUST
  guard it (`p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND
  auth.role() <> 'service_role'`). Prefer keying on `auth.uid()` directly.
- **Grants**: Supabase auto-grants EXECUTE to `anon` + `authenticated` on every
  new public fn. `REVOKE FROM PUBLIC` is NOT enough. For user-facing RPCs:
  `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated;`. For internal helpers:
  `REVOKE … FROM PUBLIC, anon, authenticated;` (definer fns still call them).
  Verify live with `has_function_privilege('anon', oid, 'EXECUTE')`.
- Metering / counter tables: `ENABLE ROW LEVEL SECURITY` with **no policies**
  (deny-all) so only the definer RPC touches them. UPSERT with
  `ON CONFLICT … DO UPDATE`; a `RAISE` rolls back the increment (atomic check).
  Precedent: `tts_usage` (mig 101).

## 3. Edge functions (Deno)
Two families — pick by caller:
- **App-user functions** (`tts`, new `ai-generate`): authenticated by the user's
  **Supabase JWT** (`supabase.auth.getUser(token)`), called by web/mobile with the
  logged-in session. Pattern: CORS allowlist → `verifyUser` → metering RPC (run
  as the user so `auth.uid()` resolves) → do work → respond. 429 on quota RAISE.
- **Third-party API** (`api`): Hono OpenAPI, `rc_` bearer keys via
  `resolve_api_key`, `rateLimitMiddleware`. Not for the app's own session.
- **CORS**: env `ALLOWED_ORIGINS` allowlist (default prod + localhost); never `*`.
- **Secrets** via `Deno.env` only — never in git. Service role only inside edge.

## 4. Client conventions
- TTL caching via `shared/lib/cache/stale-cache.ts`; invalidate through store
  actions (`invalidate`/`invalidateCards`/`forceRefresh`), never `setState({xFetchedAt})`.
- i18n: **8 web locales under `public/locales` must have key parity with `en`**
  (`translation-keys.test.ts`). Adding a key to en/ko only fails CI.
- Mobile local prefs go through `mobile/src/utils/local-prefs.ts` (expo-secure-store);
  no AsyncStorage/MMKV (need native rebuild).

## 5. Extensibility (plugin posture)
- External cost-bearing capabilities (AI provider, TTS, future payment rails) are
  accessed behind a single seam so the model/provider/pricing/quota can change by
  **config**, not by touching call sites. AI generation provider + the free-quota
  limit are config/single-source values (`_ai_free_cards_per_day`, edge env
  `AI_TEXT_MODEL`/`GEMINI_API_KEY`), not scattered literals.

## 6. Definition of done
Tests for real behaviour (no coverage-padding) green · i18n parity green · no new
lint/tsc errors vs baseline · security grants verified · design doc in `DOCS/TODO`
moved to `DOCS/DONE` on merge.
