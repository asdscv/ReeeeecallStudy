# Ops Readiness — what shipped & what's deferred

Autonomous ops-hardening pass (2026-07-27), from the 71-lever audit. Everything below
marked **LIVE** is applied to prod + deployed. **DEFERRED** items were intentionally NOT
shipped while the owner was away — they change live behavior, need a product decision, or
are pure cleanup with no urgency. Each has a "how" for when you want it.

---

## ✅ Shipped this pass (LIVE on prod)

### Pack A — Safety & kill switches (migs 153, edge fns)
- **system_flags** runtime switches: `maintenance_mode`, `ai_generation_enabled`,
  `payments_enabled`. Toggle from **Admin → System → System controls**, or ask Claude.
  Defaults = all on (no behavior change until toggled).
- **Kill switches enforced** in edge fns: ai-generate (AI + burst rate 20/min), tts (rate
  120/min), lemonsqueezy-checkout (payments). All fail-open on a flags-read blip.
- **User ban now has teeth**: `user_status` = banned/suspended → blocked from AI, TTS,
  checkout, and `register_session` (can't hold a session). Was previously cosmetic.
- **Marketplace takedown**: `admin_set_listing_active(listing_id, active)` RPC.

### Pack B — Config-ize growth levers (mig 154) — backend
- **AI free daily quota** (`free_cards_per_day`, was hardcoded 10) → `admin_set_ai_free_quota(n)`.
  Clients already read `get_ai_generation_quota().free_limit`, so they follow.
- **Owned-card cap**: `admin_set_card_limit(max_owned_cards, count_official)` (config table
  had no setter — was raw SQL).
- **AI margin/pricing**: `set_ai_pricing_settings(...)` opened to admin (was service-role only).
- Earlier this session: **`admin_set_billing_product`** (mig 152) — change any plan/pack
  price/title/card-limit without a deploy; credit packs keep grant == price (1:1) automatically.

### Pack C — Legal pages (packages/web/public/*.html)
- Removed dropped **TossPayments** from privacy + refund policies (USD-only via Lemon Squeezy
  MoR + Apple/Google IAP). Terms: session policy = 1/platform, subscriptions now describe
  Standard/Pro + AI credit packs + USD + providers. "Last updated" → 2026-07-27.
- Still static HTML. If you want no-deploy legal edits, move the bodies into a DB row +
  a public read RPC (small follow-up).

### Pack D — GDPR
- **Analytics opt-out**: Settings → Privacy & data. Off = the 3 tracking hooks short-circuit
  before their RPC (nothing leaves the browser). Stored as a local pref.
- **Web account deletion**: Settings → Privacy & data (parity with mobile; same
  `delete_user_account` RPC, two-step confirm).

**Refunds** were already one-click in Admin → Billing (real provider refund + our-side
reversal). No change needed.

---

## ⏸ Deferred (decide when you're back)

| Item | Why deferred | How to do it |
|---|---|---|
| ~~**Pack B admin UI** (quota/card/margin input fields)~~ | ✅ **DONE (mig 177 + Admin → System)** — the blocker was not the form, it was that there was no **read** path: both config tables are RLS-enabled with zero policies and no getter RPC existed, so a form could not show the current value, and a blind form on money knobs invites overwriting a number you cannot see. mig 177 adds `admin_get_growth_levers()` (admin/service_role gated); the panel reads first, saves each field independently, and mirrors the RPC bounds — including refusing `target_margin_bps = 10000`, which is a divisor in the charging formula and would silently charge nothing. `usd_won_rate` is deliberately not exposed (mig 149 pins it to 1). |
| ~~**Web ConfigStep reads server free_limit**~~ | ✅ **DONE (PR #374)** — the `10` was a hand-copied mirror of the quota, so raising it above 10 silently capped the wizard's default on web *and* mobile. The clamp was never needed: `get_ai_generation_quota` returns `remaining = GREATEST(0, free_limit − used)`, so the value both clients already held was already bounded. Replaced by the one bound the client legitimately owns — its own input range — in `shared/lib/ai/card-count.ts`, shared so the platforms cannot drift again. |
| **Per-plan entitlement** (paid tiers get a bigger free AI quota) | Monetization decision — today paying only raises the card cap, not AI. | `plan_entitlements` (or `billing_products.features` JSONB) read by `_ai_free_cards_per_day()`; needs your pricing intent. |
| **Discount / coupon / free-trial** | Product decision. | Short term: use store-native discounts (Lemon Squeezy codes, App Store/Play promo). |
| **Server-side audit trail** (fold `logAction` into each admin RPC + capture IP) | Touches many money/admin RPCs — not safe to refactor unattended. | Move the audit INSERT server-side inside each `admin_*` RPC. |
| **Quota reset timezone** (UTC → Asia/Seoul) | Changes reset accounting — risky to flip unattended. | Key usage rows by a configurable offset. |
| **Disposable-email denylist at signup** | A bad list blocks real signups. | BEFORE INSERT trigger / Auth hook reading a small config table. |
| **Credit expiry** (breakage / deferred-revenue) | Policy + must disclose in ToS first. | Optional `valid_until` + scheduled sweep, off by default. |
| **Push / broadcast announcements** | Larger feature (persist expo tokens + broadcast fn + consent). | Own project. |
| ~~**Dead code**: `admin_set_session_override` / `max_sessions_override`~~ | ✅ **DONE (mig 176)** — dropped. It was not inert but *misleading*: the function still passed its `is_admin()` gate and still answered `{"success": true}` while changing nothing, because mig 093's one-session-per-platform rewrite never read the key (confirmed against `pg_proc`: the only mention left was its own writer). It also wrote to the legacy `subscriptions` table, so even a re-wire would have read the wrong place. The dead JSONB key is stripped too — printed to the apply log first — so a future per-tier device-count feature cannot silently inherit overrides set months earlier. `session_override_removed_test.sql` re-proves the live limiter after the removal. |
| **Account deletion grace window** (soft-delete before purge) | Changes destructive semantics — needs care. | Make `delete_user_account` soft-delete + a scheduled purge. |

---

## Prod migration state (2026-07-31)
Prod is synced to **mig 171**. This release applied `160 → 161(expand) → 162 → 165 → 167 → 168 → 169 → 170`
**before** promoting `develop`→`main`, then `171` (contract) **after** the cutover build was serving —
because 161-as-written bundled expand+contract and would have dropped `insert_study_log` / revoked the
direct study writes out from under the still-live pre-cutover build (hence the 161/171 split, PR #351).
Verified on prod: cutover RPCs reachable by `authenticated`, `insert_study_log` → PGRST202, direct
`study_logs`/`user_card_progress` writes → 42501, `cards` content columns still writable.

## Note on git drift
Prod DB has migs 148–154 applied; the migration **files** live on the `feat/mobile-iap-integration`
branch (committed) and reconcile to `main` when that branch merges. Web ops changes (Pack A UI,
C, D) went to `main` via clean PRs (#314, #315) and are deployed. No functional impact.
