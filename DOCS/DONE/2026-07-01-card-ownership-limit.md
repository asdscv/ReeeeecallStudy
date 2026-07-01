# Owned-Card Ownership Limit — Revenue Axis #2 (Phase 1)

**Status:** Phase 1 BUILT + CI-verified (PR #217 + UI/tests follow-up) on `develop`.
**Subscription unlock = Phase 2** (stubbed seam; payment on hold).

## Model (owner-confirmed)
An account may OWN up to **N study cards (default 1000)**. **"인증카드" (cards in official
certified decks) are EXCLUDED.** At the cap, **all** new card creation is blocked
server-side (manual add, Quick Create, AI generation, deck copy, CSV import) until the
user subscribes.

## Config-tunable (owner asked for an easy include/exclude toggle)
`card_limit_settings` (single row): `max_owned_cards` (1000), `count_official_cards`
(false). Both change with one DB UPDATE — no migration, no redeploy:
```sql
UPDATE card_limit_settings SET max_owned_cards = 3000;        -- change the cap
UPDATE card_limit_settings SET count_official_cards = true;   -- include official cards
```

## Server (mig 116_owned_card_limit.sql)
- `_owned_card_count(owner)` — cards in decks the user OWNS (`decks.user_id = owner`),
  official-manifest decks excluded (toggle-aware). Subscribed official decks have 0
  owned rows (deck_shares + progress only) → excluded naturally; user COPIES of official
  decks DO count (a new user-owned deck, editable, not in the manifest — else the cap is
  bypassable by copying a large deck).
- `check_card_limit(owner, adding)` — raises **SQLSTATE PT402 / hint CARD_LIMIT_REACHED**
  if `owned + adding > cap`. Admin bypass (`profiles.role='admin'`, keyed on the owner);
  per-user `pg_advisory_xact_lock` vs concurrent races; **Phase-2 subscription seam
  stubbed** (uncomment a `subscriptions` check for `tier<>'free' AND status active/trialing`).
- Wired into the 3 insert RPCs: **`reserve_card_positions`** (the choke-point — manual /
  Quick Create / bulk / AI-persist / REST API all funnel through it), **`copy_deck_for_user`**
  (invite + marketplace copy; all-or-nothing), **`bulk_insert_cards`** (CSV import).
  NOT gated: `import_official_deck` (system user), subscribe-mode acquire (0 owned cards).
- `check_card_limit_self` + `get_owned_card_usage` (auth.uid, no IDOR); internal fns
  REVOKEd from anon/authenticated.

## Edge / client / UI
- `ai-generate` pre-checks the limit **before reserving AI credits/free quota** (text +
  image branches) → 402 CARD_LIMIT_REACHED, so credits are never spent on un-saveable cards.
- `card-store` maps PT402/CARD_LIMIT_REACHED → `errors:card.limitReached`.
- `deck-store.fetchCardUsage()` (`get_owned_card_usage`) + `cardUsage {owned,limit,available}`.
- Card-storage **usage meter** in web `SettingsPage` + mobile `SettingsScreen`; **pre-flight
  blocks** on the create surfaces (Quick Create / import / AI / single-card) with a disabled
  "subscribe (coming soon)" CTA placeholder. i18n across 8 web + 8 mobile locales.

## Tests
- `card_limit_test.sql` — count, guard block at cap, boundary, official exclusion, config
  toggle, admin bypass, null-owner.
- `card_limit_smoke_test.sql` — DRY-RUN (reads don't mutate) / SMOKE (under-cap ok, at-cap
  block) / NET-ZERO (a blocked reserve consumes no position + writes no row; a permitted
  reserve advances). Both CI-wired.
- `card_limit_e2e.sh` — actual HTTP E2E vs the local stack: PostgREST reserve → 402, usage
  RPC, AI-edge pre-check → 402, under-cap → 200. (The enforcement web/iOS/Android share.)

## Grandfathering
Automatic: the guard only blocks `owned + adding > cap`. A user already over the cap keeps
all existing cards; only NEW creation is rejected. No rows are touched.

## Phase 2 (after payment)
Uncomment the subscription block in `check_card_limit` (`subscriptions` table, mig 048).
For tiered caps, `_owned_card_limit()` → `_owned_card_limit(tier)`.
