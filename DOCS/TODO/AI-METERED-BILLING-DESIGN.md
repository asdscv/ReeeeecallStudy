<!-- Design of record. Produced by the ai-metered-billing-design multi-agent workflow
(3 approaches → synthesis), grounded in the live code (migs 108-113, edge fn, shared).
Owner-confirmed spec: metered micro-WON wallet, post-gen actual-cost deduction, 80% margin
(price = cost x 5), free 10/day absorbed, failure = no charge (net-zero), slight-negative OK.

STATUS: **BUILT + merged to develop (mig 114)** — reserve/charge/release RPCs, edge-fn
reserve→charge→release, shared getAiWallet(micro-WON)/getAffordableCards(₩ estimate), rewritten
DB tests + dual-provider e2e. Adversarially audited → MERGE-READY, 0 blockers; the 100%-margin
div-by-zero + charge-refunded-guard findings fixed pre-merge. Live e2e 17/17 (Gemini): a paid gen
deducts real cost×markup (₩0.39 / 2 cards). NOT prod. Phase 1c payment wires add_ai_credits(₩pack×1e6).
Tracked from DOCS/TODO/AI-MONETIZATION-REMAINING.md. -->

# AI Charging — Metered Micro-WON Wallet (Design of Record)

**Status:** Design approved for implementation (migration 114). Supersedes the fixed-credit charging path in migs 108–111; the cost/margin layer in 112–113 is promoted from observation to the live pricing engine. Target: **develop first** (Phase-0 wallet is empty there; prod still lacks a Gemini key + mig apply, so no prod exposure).

**Grounding:** `supabase/migrations/108-113`, `supabase/functions/ai-generate/index.ts`, `packages/shared/lib/ai/server-client.ts`, `packages/shared/stores/ai-generate-store.ts`.

---

## 1. Recommendation

**Backbone: the pragmatic-hybrid (Design 3), with two decisive grafts from the clean-rewrite (Design 2).** Reuse `ai_credit_balance`/`ai_credit_ledger` as micro-WON tables; split the flow into a pre-gen **`reserve_ai_generation`** (gate, no money) and a post-gen **`charge_ai_generation`** (real cost × markup, deduct) — the latter being `finalize_ai_cost` promoted observe→charge.

**Why reuse over clean-rewrite (Design 2):** the payment seam (`add_ai_credits`) and its idempotency infra — the partial unique index `ai_credit_ledger_grant_ref ON (ref) WHERE ref IS NOT NULL AND delta>0` (109:43-44) — are already hardened (mig 111 closed a self-credit minting hole). Rebuilding fresh `ai_wallet` tables reintroduces that risk for a purely cosmetic naming gain, since these tables are RLS-deny-all + RPC-only (no client ever sees "credit"). The "credit vocabulary now lies" cost is paid down with a column comment, not a rename touching every grant/RLS/test reference. A table rename is an **optional cosmetic follow-up**, not part of 114.

**Two grafts from Design 2 that fix the hybrid's weak spots:**
1. **Keep the free/paid counter increments in `reserve` under the `FOR UPDATE` lock** (Design 3 proposed moving them to `charge` — that reintroduces a free-quota race where concurrent requests both read the same `free_cards_used`). Instead, reverse them on failure via a `release_ai_job` (Design 2's `release`, = today's `refund_ai_job` minus the wallet credit-back). This gives BOTH race-safe free accounting AND net-zero-on-failure. This is the central synthesis.
2. **Adopt Design 2's structural insight** that `markup = 1/(1−margin) ≥ 1` makes `net_negative` impossible for paid work — so the old floor becomes a no-op and the margin monitor gets repurposed to catch `estimated`/`rate_missing` (unpriceable = the real leak).

**Trade-off optimized:** minimal object/grant/test churn + reuse of proven idempotency, while getting honest reserve/charge vocabulary and true token-cost pricing. We accept a **bounded per-user negative tail** (one batch's cost) and a **rare under-bill** (best-effort charge lost after a delivered 200) in exchange for never reserving an unknown pre-token amount and never running a wallet-refund dance.

---

## 2. Wallet (micro-WON)

Reuse both tables; **redefine 1 unit = 1 micro-WON (1e-6 ₩)**. bigint holds trillions of ₩. Changes:

- **Drop `CHECK (balance >= 0)`** on `ai_credit_balance` (109:23) — the post-gen deduct may dip the last batch slightly negative (accepted; gate blocks the next call).
- `ai_credit_ledger.reason` CHECK → add `'spend'` (keep `purchase`/`refund`/`admin_grant`; drop the now-dead `spend_cards`/`spend_image` from new writes, leave in the CHECK for history).
- **`add_ai_credits(p_user_id, p_micro_won, p_reason, p_ref)`** stays byte-identical in body and signature; only the *unit* changes to micro-WON. A ₩1000 pack → `add_ai_credits(uid, 1000*1000000, 'purchase', payment_ref)`. **Idempotency on `p_ref` is unchanged** — the partial unique index guards positive-delta grants, so payment-webhook/IAP retries can't double-credit. This is the single ₩→wallet conversion; **₩ price lives only at the payment layer**, exactly as today.

**The "credit" concept is retired at the semantic level.** `_ai_credits_per_card()`/`_ai_credits_per_image()` (109:48, 110:11) and `won_per_credit` (112:21) are dropped/dormant — price is now derived from tokens, not a card count. Column *names* (`ai_credit_balance.balance`, `ai_credit_ledger.delta`) remain for churn reasons, documented via `COMMENT ON COLUMN ... IS 'micro-WON (1e-6 KRW)'`.

---

## 3. Charge flow — GATE (pre-gen) vs CHARGE (post-gen)

### Pre-gen GATE — `reserve_ai_generation(p_kind, p_cards)` (authenticated)
Takes over `record_ai_generation`'s structure (111:31-92) minus the money:
1. Upsert today's `ai_generation_usage` + `SELECT ... FOR UPDATE` (row lock serializes the user's day).
2. Abuse cap `req_count+1 > 300` → `RAISE errcode='23514'` (111:61-63, unchanged).
3. Free/paid split: `v_free = LEAST(p_cards, GREATEST(0, _ai_free_cards_per_day() - free_used))`, `v_paid = p_cards - v_free`. Template/deck ⇒ `p_cards := 0` (111:54).
4. **GATE (no deduct):** `IF v_paid > 0 THEN SELECT balance INTO v_bal FROM ai_credit_balance WHERE user_id=v_uid; IF COALESCE(v_bal,0) <= 0 THEN RAISE 'Insufficient AI wallet' USING errcode='P0002'; END IF; END IF;` — never do paid provider work for an empty wallet; no reserve amount (unknown pre-tokens).
5. Write job row `ai_generation_jobs(id=v_ref, free_cards=v_free, paid_cards=v_paid, image_jobs=0, charged=false)`.
6. **Increment `free_cards_used += v_free`, `paid_cards_used += v_paid`, `req_count += 1` here, under the lock** (race-safe free accounting).
7. Return `{remaining_free, free_now, paid_now, job_ref}` (drop `credits_spent`).

`reserve_ai_image()` = same shape, always paid: `v_free=0, v_paid=1`, gate on `balance<=0`, job row `image_jobs=1`.

### Post-gen CHARGE — `charge_ai_generation(p_user_id, p_job_ref, p_provider, p_model, p_tokens_in, p_tokens_out)` (service_role/admin)
Same 6-arg signature as `finalize_ai_cost` (112:105). Lifts the token-cost math **verbatim** from 112:145-148 (keeps micro-unit correctness), then adds pricing + deduct:

```
IF NOT (auth.role()='service_role' OR is_admin()) THEN RAISE errcode='42501'; END IF;
SELECT * INTO j FROM ai_generation_jobs WHERE id=p_job_ref FOR UPDATE;   -- idempotency latch
IF NOT FOUND OR j.charged THEN RETURN;                                    -- once-only, race-safe

v_markup     := 10000.0 / (10000 - _ai_target_margin_bps());             -- = 5.0 at 8000 bps
v_paid_share := CASE WHEN (j.free_cards+j.paid_cards)=0 THEN 0
                     ELSE j.paid_cards::numeric/(j.free_cards+j.paid_cards) END;   -- image ⇒ 1

IF tokens NULL / negative / (0,0) THEN
    v_estimated := true;  v_price := 0;                                   -- unpriceable → charge 0
ELSE
    v_cost_won_micros := <exact finalize_ai_cost cost math, 112:145-148>; -- micro-WON, real per-gen cost
    v_price := round(v_cost_won_micros * v_paid_share * v_markup)::bigint;-- micro-WON; 0 when paid_share=0
END IF;

INSERT INTO ai_cost_ledger(job_ref, ..., cost_won_micros, price_won_micros=v_price,
   margin_won_micros, margin_bps, rate_missing, estimated=v_estimated)
   VALUES(...) ON CONFLICT (job_ref) DO NOTHING;                         -- 2nd latch (112:80 UNIQUE)

IF v_price > 0 THEN
   UPDATE ai_credit_balance SET balance = balance - v_price, updated_at=now()
     WHERE user_id=p_user_id RETURNING balance INTO v_bal;               -- NO balance>= guard → may go negative
   INSERT INTO ai_credit_ledger(user_id, delta=-v_price, reason='spend', ref=p_job_ref, balance_after=v_bal);
END IF;
UPDATE ai_generation_jobs SET price_micro_won=v_price, charged=true WHERE id=p_job_ref;
```

`price_won_micros` in `ai_cost_ledger` now holds the **actually charged** amount (was notional `credits × won_per_credit`), so `get_ai_margin_daily` (113:76) keeps working unchanged. Because `v_markup ≥ 1`, price ≥ cost for the paid portion always; a mixed batch where free cards dominate can show `price < total cost`, but that is **intended free-tier CAC** (already excluded from `net_negative_jobs`, 113:96-98).

### `finalize_ai_cost` + `refund_ai_job`
- **`finalize_ai_cost` is folded into `charge_ai_generation`** — dropped. Its `ai_cost_ledger` write survives inside `charge` (observability retained).
- **`refund_ai_job` is retired for the money path** (nothing is taken pre-gen → nothing to refund). It is replaced by **`release_ai_job(p_user_id, p_job_ref)`** which reverses the `free_cards_used`/`paid_cards_used` counters (reusing the existing `refunded` flag as an idempotency latch), **no wallet credit-back**. service_role only.

### Exact edge-fn integration points (`ai-generate/index.ts`)
| Point | Today | Change |
|---|---|---|
| Text pre-gen **392-395** | `sbUser.rpc('record_ai_generation')` | → `reserve_ai_generation`. Error map **396-407** unchanged (P0002→402 `AI_INSUFFICIENT_CREDITS`, 23514→429 `AI_RATE_CAP`, else 500). Read `job_ref` **408-412**. |
| Text success **433** | `finalizeCost(userId, job_ref, model, usage)` | → `chargeGeneration(...)` calling `charge_ai_generation` via `sbServiceRole()` (67-72). **Keep the best-effort await-and-inspect-`error` pattern (98-113)** — a charge blip must never mask the earned 200. **Add one inline retry.** |
| Text failure **427** | `refundJob(userId, job_ref)` | → `releaseJob(...)` calling `release_ai_job`; then 502. |
| Image pre-gen **336** | `record_ai_image` | → `reserve_ai_image`. Map **337-342** unchanged. |
| Image success **348** | `finalizeCost(... imgMeter.job_ref ...)` | → `chargeGeneration(...)`. |
| Image failure **353** | `refundJob(...)` | → `releaseJob(...)`; then 502. |

`sbUser` (JWT, 322-326) still reserves/gates as the user; `sbServiceRole()` still charges/releases (both are DEFINER + service-role-gated). Token capture (`providerRequest` 200-210, `sumUsage` 143-148) unchanged — strict finite-non-negative or `null`.

---

## 4. Failure / edge

- **Provider failure:** `charge` is never called → nothing deducted → **net-zero automatically**. `releaseJob` reverses the free/paid counters so a failed gen doesn't burn the daily free allowance either.
- **No usage** (tokens NULL / negative / (0,0)): **charge 0**, write `ai_cost_ledger` with `estimated=true, cost NULL, price 0`, still mark `charged=true`. We absorb the rare unpriceable success rather than forge a bill (matches 112:129-138).
- **Free-only / template / deck:** `paid_cards=0` ⇒ `v_paid_share=0` ⇒ `v_price=0` ⇒ deduct 0.
- **Idempotency (no double-charge on edge at-least-once retry):** the job row `FOR UPDATE` + `j.charged` flag is the primary latch (a concurrent duplicate blocks on the lock, then sees `charged=true` → no-op); `ai_cost_ledger.job_ref UNIQUE` + `ON CONFLICT DO NOTHING` is the second latch. Same protection for `release_ai_job` via the `refunded` flag.
- **Insufficient at gate:** `paid>0 AND balance<=0` → P0002 → **402 `AI_INSUFFICIENT_CREDITS`** before any provider work (wire code unchanged).
- **Slight negative:** deduct has no floor; bounded to one batch's cost (≤ 25 cards, MAX_CARDS_PER_CALL). The gate then 402s the next call. Accepted per spec.

---

## 5. Migration sketch (114) — `114_ai_metered_won.sql`

Single migration, `BEGIN/COMMIT`. Not in prod → no data migration. All new/changed fns: `SECURITY DEFINER SET search_path=public`, micro-unit bigint math, RLS deny-all on wallet tables preserved.

```sql
-- 1. WALLET SEMANTICS (reuse tables as micro-WON)
TRUNCATE ai_credit_balance, ai_credit_ledger;                 -- develop reset ONLY; never on a real-balance prod
ALTER TABLE ai_credit_balance DROP CONSTRAINT ai_credit_balance_balance_check;   -- allow slight negative
COMMENT ON COLUMN ai_credit_balance.balance IS 'micro-WON (1e-6 KRW); may dip one-batch negative';
ALTER TABLE ai_credit_ledger DROP CONSTRAINT ai_credit_ledger_reason_check,
  ADD  CONSTRAINT ai_credit_ledger_reason_check CHECK (reason IN ('purchase','spend','refund','admin_grant'));
-- keep partial unique index ai_credit_ledger_grant_ref  (payment idempotency, untouched)
COMMENT ON FUNCTION add_ai_credits(uuid,bigint,text,text) IS 'grants micro-WON; idempotent on p_ref';

-- 2. JOB ROW state
ALTER TABLE ai_generation_jobs
  ADD COLUMN IF NOT EXISTS price_micro_won bigint,
  ADD COLUMN IF NOT EXISTS charged boolean NOT NULL DEFAULT false;   -- reuse existing `refunded` for release latch

-- 3. CLIENT-QUOTE est-price seam (tunable w/o migration, admin RPC)
ALTER TABLE ai_pricing_settings ADD COLUMN IF NOT EXISTS est_price_per_card_micro bigint NOT NULL DEFAULT 2000000;
CREATE OR REPLACE FUNCTION _ai_est_price_per_card() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path=public AS $$ SELECT est_price_per_card_micro FROM ai_pricing_settings WHERE id=1 $$;
REVOKE EXECUTE ON FUNCTION _ai_est_price_per_card() FROM PUBLIC, anon, authenticated;

-- 4. RPCs (bodies per §3)
CREATE OR REPLACE FUNCTION reserve_ai_generation(p_kind text, p_cards int) RETURNS jsonb ... ;
CREATE OR REPLACE FUNCTION reserve_ai_image() RETURNS jsonb ... ;
GRANT EXECUTE ON FUNCTION reserve_ai_generation(text,int), reserve_ai_image() TO authenticated;

CREATE OR REPLACE FUNCTION charge_ai_generation(uuid,text,text,text,int,int) RETURNS jsonb ... ;
CREATE OR REPLACE FUNCTION release_ai_job(uuid,text) RETURNS void ... ;
REVOKE EXECUTE ON FUNCTION charge_ai_generation(uuid,text,text,text,int,int), release_ai_job(uuid,text)
  FROM PUBLIC, anon, authenticated;                              -- mig-097 grant trap: NOT enough to revoke PUBLIC
GRANT  EXECUTE ON FUNCTION charge_ai_generation(uuid,text,text,text,int,int), release_ai_job(uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION get_ai_wallet() RETURNS TABLE(balance_micro_won bigint) ... ;
GRANT EXECUTE ON FUNCTION get_ai_wallet() TO authenticated;      -- get_ai_generation_quota unchanged

-- 5. DROPS
DROP FUNCTION IF EXISTS record_ai_generation(text,int);
DROP FUNCTION IF EXISTS record_ai_image();
DROP FUNCTION IF EXISTS finalize_ai_cost(uuid,text,text,text,int,int);   -- folded into charge
DROP FUNCTION IF EXISTS refund_ai_job(uuid,text);                        -- → release_ai_job
DROP FUNCTION IF EXISTS _ai_credits_per_card();
DROP FUNCTION IF EXISTS _ai_credits_per_image();
-- won_per_credit column: leave dormant (only finalize read it) OR drop — optional.
```

**KEEP + now load-bearing:** `ai_cost_ledger`, `ai_pricing_config`, `_ai_resolve_rate`, `_ai_target_margin_bps`, `_ai_usd_won_rate`, `_ai_free_cards_per_day`, `preview_ai_cost` (feeds admin dry-run + can seed est-price), `get_ai_margin_daily`, `add_ai_credits`, `get_ai_generation_quota`, `set_ai_pricing_rate`/`set_ai_pricing_settings`.

**Post-apply verification (mig-097 trap):** `SELECT has_function_privilege('anon', p.oid, 'EXECUTE')` for `charge_ai_generation`, `release_ai_job`, `_ai_est_price_per_card` — must be false. Supabase default-privileges GRANT EXECUTE to anon/authenticated directly, and `CREATE OR REPLACE` won't re-run them, so the explicit `REVOKE ... FROM anon, authenticated` above is mandatory, not belt-and-suspenders.

---

## 6. Client / shared

**`packages/shared/lib/ai/server-client.ts`:**
- `getAiWallet()` (102-110) → `get_ai_wallet` now returns one col `balance_micro_won` → `{ balanceMicroWon }`. Drop `creditsPerCard`/`credits_per_image`. **Keep returning `null` on error** (transient-vs-known-0 distinction, so a read blip doesn't hard-block a paying user).
- `getAffordableCards()` (112-127) becomes a **WON estimate**: `estPrice = _ai_est_price_per_card()` (exposed via a tiny `get_ai_price_quote()` RPC or bundled into `get_ai_wallet`'s return). `paidEst = floor(balanceMicroWon / estPrice)`; `total = q.remaining + paidEst`; `walletKnown` unchanged; wallet-null ⇒ `{free:q.remaining, paid:0, walletKnown:false}` (defer to server). It is now **approximate** — the store cap becomes a soft UX hint; the server gate is authoritative.

**`packages/shared/stores/ai-generate-store.ts`:** logic unchanged — the known-zero hard-block (`aff.walletKnown && aff.total<=0`, 131/200) and cap-to-affordable `Math.min(cardCount, aff.total)` (201) still hold; only the affordability *source* is now estimate-based. `mapError` (95-106) unchanged — **keep the wire code `AI_INSUFFICIENT_CREDITS`** (avoids touching mapError + i18n keys).

**What breaks + fix:** `AiWallet` type (`creditsPerCard`→remove; add `balanceMicroWon`, optional `estPricePerCardMicro`); `get_ai_wallet` return shape (3-col→1-col); any UI copy saying "credits"/"크레딧" → "₩ balance" (change the i18n *text* under the existing `insufficientCredits` key across all 8 web locales — `translation-keys.test.ts` enforces key parity, so relabel values, don't add keys).

---

## 7. Tests

**`ai_credit_metering_test.sql` — rewrite** (it asserts fixed 1/card, 5/image, pre-gen debit, "Insufficient AI credits" on empty wallet). New assertions:
1. `reserve_ai_generation`: free/paid split correct (10 free/day); increments `free_cards_used`/`paid_cards_used`/`req_count`; writes job row `charged=false`; **no wallet write**.
2. Gate P0002 **only** when `paid>0 AND balance<=0`; free-only never gated; template/deck ⇒ `paid=0`, never gated.
3. Abuse cap: 301st request → SQLSTATE `23514`.
4. `charge_ai_generation`: deducts `≈ cost_won × paid_share × 5` (at 8000 bps) within rounding; writes `ai_credit_ledger` `reason='spend'` + `ai_cost_ledger.price_won_micros` = deducted amount; sets `charged=true`, `price_micro_won`.
5. Free-only / template / deck: charge deducts **0**.
6. No-usage (NULL / (0,0)): charge **0**, `estimated=true`, still `charged=true`.
7. **Idempotent:** two `charge_ai_generation` on same `job_ref` = single deduction; balance moves once.
8. `release_ai_job`: reverses `free_cards_used`/`paid_cards_used`, **no wallet change**, idempotent (2nd call no-op).
9. `add_ai_credits`: grants micro-WON (`add_ai_credits(uid,1000*1e6,...)` → balance 1e9); idempotent on `p_ref`.

**Edge e2e:** replace "10 free then blocked at 1 credit/card" with "10 free then **priced by tokens**": assert 200 + a non-zero `ai_cost_ledger.price_won_micros` + a `spend` ledger row after a paid gen; assert **failure → net-zero** (no spend row, counters released, `refunded=true`); assert 402 on empty wallet + paid request; **402/429 wire codes and "10 free/day" unchanged**.

---

## 8. Rollout + risks

**Order:**
1. **Mig 114** (SQL + grants/REVOKE + live `has_function_privilege` check).
2. **Edge fn** (`ai-generate/index.ts`): rename call sites (record→reserve, `finalizeCost`→`chargeGeneration`, `refundJob`→`releaseJob` at 336/348/353/392/427/433); keep best-effort await pattern; add one inline charge retry.
3. **shared** `server-client.ts` + `ai-generate-store.ts` (`getAiWallet`, `getAffordableCards`, `AiWallet`); relabel i18n copy.
4. **Rewrite** `ai_credit_metering_test.sql` + edge e2e.
5. **Deploy to develop:** set `AI_GENERATION_PROVIDER_KEY`, apply 114, deploy edge fn (else 503). Verify a real paid gen deducts.
6. **Phase 1 (later):** payment layer (web PortOne / mobile IAP-RevenueCat) calls `add_ai_credits(uid, won×1e6, 'purchase', ref)`; the SKU ₩ price *is* the grant.

**Backward-compat:** develop-only, empty wallet, no prod exposure (no Gemini key in prod). Wire codes (402/429/`AI_INSUFFICIENT_CREDITS`/`AI_RATE_CAP`) and the 10-free/day quota are preserved to minimize edge/store/i18n churn.

**Watch:**
- **Lost best-effort charge after a 200** → under-bill (we eat margin, never the user's money, never double). Mitigate: one inline retry + a nightly `reconcile_ai_charges()` sweep charging `est_price_per_card × paid_cards` (`estimated=true`) for jobs `charged=false AND refunded=false AND created < now()-1h`. Recovers approximate revenue when real tokens are gone.
- **Negative tail** bounded by one batch; gate 402s the next call. Alert on balances below `−(max_batch × est_price)`.
- **`under_target`/`net_negative` are now structural no-ops** (price = cost × markup by construction). **Repurpose `get_ai_margin_daily` alerting to `estimated_jobs` + `rate_missing_jobs`** — unpriceable calls are the real leak.
- **est-price drift** (client quote wrong) — soft cap only; server authoritative. Refresh `est_price_per_card_micro` from the trailing `ai_cost_ledger` avg periodically.
- **mig-097 grant trap** on the new DEFINER helpers — verify live.

---

## 9. Open decisions (owner)

1. **Min top-up / pack sizing.** With gemini-2.5-flash-lite (in $0.10 / out $0.40 per Mtok) a card costs **sub-₩1 even at 80% margin** — a ₩1000 pack buys thousands of cards. Decide pack sizes and whether to impose a **minimum absolute charge per paid card** (perceived-value floor) or bundle. Note micro-WON storage avoids round-to-zero; only *display* in whole ₩ would show ₩0 for tiny gens.
2. **Negative-balance policy.** Recommended: allow slight negative (bounded, gate-blocked next call). Alternative — a hard pre-gen worst-case reserve — rejected (reserves an unknown pre-token amount, needs a refund dance). Confirm the accepted tail size.
3. **Est-price source for the UI quote.** Recommended: seeded `est_price_per_card_micro` config (₩2 seed) refreshed nightly from the `ai_cost_ledger` rolling avg. Alternatives: static-only (simplest) or `preview_ai_cost` per-request (accurate, extra RPC). Pick refresh cadence.
4. **`target_margin_bps` = 8000 (80%)** — now a hard price *driver*, not a monitor. Confirm, and confirm it stays margin-of-price (markup ×5) not markup-on-cost.
5. **Cosmetic:** rename `ai_credit_*` → `ai_wallet_*` now (extra grant/RLS churn) or defer? Recommend defer. And keep wire code `AI_INSUFFICIENT_CREDITS` or rename to `AI_INSUFFICIENT_BALANCE`? Recommend keep.
6. **`won_per_credit` (112)** — leave dormant or drop in 114? Recommend leave (no reader remains after `finalize` is dropped).
