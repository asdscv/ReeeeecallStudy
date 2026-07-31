# Attempt-Grounded Remediation

- **Status:** PR A **complete and verified locally** (whole CI SQL job reproduced green on a fresh
  DB); commit/merge pending. PR B **not started.** See §10 for the exact line.
- **Implements:** [ai-personalization-gaps](./2026-07-31-ai-personalization-gaps.md) §5 ①.
- **Base:** branched at `origin/develop` `8008259`; develop merged in at `d1e4b21` (which is why
  the migration is numbered 178, not 175 — see §10.1). Branch `feat/attempt-grounded-remediation`.
- **Splits as:** **PR A** server + store contract (mig 178, edge fn, shared store, SQL tests).
  **PR B** the surfaces (web attempt rows, mobile attempt list, i18n, UI tests). B depends on A.

---

## 1. The gap, restated in one paragraph

`parseRemediationRefs` accepts `attemptId` and the edge function already loads the learner's own
attempt, filtered by `user_id`. `reserve_ai_remediation` already ownership-checks it
(`42501` → `FORBIDDEN`, mig 168:64). Nothing on either client sends it, and both hard-code
`action: 'explain'`. So the model explains *a card in a goal's context* and can never say
"you keep missing this one, here is the cue". The paid feature is one field short of being
personal.

## 2. What attempt grounding can honestly add — and what it cannot

Today's attempts are **self-rated recall**: `response = { self_rated: score }`
(`learning-store.ts:779`). There is no free text the learner typed.

Therefore:

| Action | Ships now? | Why |
|---|---|---|
| `explain` | yes, attempt-grounded | The score and the card's recent failure pattern are real evidence about *what to explain and how hard*. **Not** the duration or the hint count — see below |
| `hint` | yes, attempt-grounded | A retrieval cue is exactly what a repeated `Again` calls for |
| `compare` | **no** | Compares the learner's answer with the expected one. There is no answer to compare — `{ self_rated: 0 }` is a rating, not a response. Shipping it would produce a fabricated comparison |
| `evaluate` | **no** | Same reason: nothing to evaluate. Needs `AiEvaluatorAdapter` + curated activities |
| `generate` | **no** | Content authoring, not remediation |
| `recommend` | **no** | Duplicates `weak-card-v1`; deferred on the cost decision in the gaps doc §5 ③ |

Two of six actions become reachable. That is the truthful number, and it is stated in the PR
rather than implied to be "all six wired".

## 3. The evidence sent to the model

Per request, in addition to today's `{ goal, activity, cards, concepts, sources }`:

```
attempt          the referenced attempt: score, hints_used, duration_ms, evaluator_result,
                 feedback, created_at        (already loaded; hints_used/duration_ms added)
attemptHistory   up to 5 most recent attempts on THE SAME CARD for this user:
                 { normalized_score, created_at } only
```

**`hints_used` and `duration_ms` are always 0 today.** `record_answer_attempt` defaults both to
0 (mig 167:656-657), the store never sends `p_hints_used` at all, and neither rating button —
`LearningTodayPage.tsx:332` nor `LearningTodayScreen.tsx:324` — passes a duration. So they are a
constant, not a signal. They are still *selected*, because they cost nothing and start working
the day a caller populates them, but the prompt only invites the model to use them when they are
actually non-zero; otherwise it is explicitly told **not** to infer speed or help from them.
Instructing a model to reason from a column that is always zero is how you get "you answered
this instantly, so…" about a learner who did no such thing — a fabricated claim in the one
feature whose whole premise is grounding.

`attemptHistory` is what turns a single failure into a pattern ("4 of the last 5 were misses"),
and it is deliberately **scores and timestamps only** — no responses, no feedback text. It is one
indexed query (`idx_answer_attempts_card`, user-filtered) and it is capped, so a learner with
10k attempts cannot widen the prompt.

`prompt_version` moves to `remediation-v2`. The column exists so a stored enrichment says which
prompt produced it; reusing `v1` for a different prompt would make that column a lie.

## 4. Migration 178 — record what the answer was grounded in

`user_enrichments` has `goal_id / concept_id / card_id / activity_id` but **no `attempt_id`**, and
`persist_ai_remediation` has no parameter for one. `request_fingerprint` is
`JSON.stringify(refs).slice(0, 128)` — lossy for a payload that now carries an attempt uuid, so it
cannot serve as provenance.

```sql
ALTER TABLE user_enrichments
  ADD COLUMN attempt_id uuid REFERENCES answer_attempts(id) ON DELETE SET NULL;
CREATE INDEX idx_user_enrichments_attempt ON user_enrichments(attempt_id);
```

`persist_ai_remediation` gains `p_attempt_id uuid DEFAULT NULL` with the same ownership check the
other references get (`attempt.user_id = p_user_id`, else `42501`), plus a **pair** check: if the
attempt is card-scoped and the enrichment is card-scoped, the two must name the same card.
`attemptId` and `cardId` arrive as independent fields of the request body, so the server cannot
rely on `latestAttemptForCard` having paired them — and "card X, grounded in an attempt on card
Y" is provenance that misdescribes the answer, which is worse than none because a stored
`attempt_id` reads as verified. The check is deliberately **silent when the attempt has no card**:
`answer_attempts.card_id` is nullable and `attempt_activity_or_card_required` (mig 165:228) allows
an activity-only attempt, which `reserve_ai_remediation` accepts alongside a card reference. Both
edges are pinned in SQL — remove the check and the mismatch test fails; widen it to reject a null
card and the activity-attempt test fails.

**The old function is DROPped, not left as an overload.** Adding a parameter to a Postgres function
creates a second function; leaving both would mean a stale caller silently writes rows with no
attempt provenance and PostgREST picking between two candidates. Drop + create + re-`GRANT`
(mig 168's grants do not survive a drop) is the only version of this that cannot rot.

`ON DELETE SET NULL` rather than `CASCADE`: deleting an attempt must not delete an explanation the
learner accepted and may have paid for.

## 5. Client contract (PR A)

```ts
requestEnrichment({ action, goalId, cardId, attemptId?, uiLang })   // attemptId: string | null
```

* `attemptId` is optional. The card-scoped button keeps working unchanged — an explanation of a
  card the learner has not attempted yet is still a legitimate request.
* The store does **not** guess an attempt. A caller that wants grounding passes the id; deriving
  "probably this attempt" inside the store would make a paid call depend on a heuristic.
* `latestAttemptForCard(attempts, cardId)` — a pure helper in `shared/lib` — is what the screens
  use to find the id. Pure so both platforms share the rule (newest by `created_at`, ties broken
  by id for determinism) and so it is testable without a store.

### 5.1 Cost before the click, not in an error afterwards

`reserve_ai_remediation` inserts `paid_cards = 1, billable_fraction = 1.0`, so one remediation
costs exactly one paid card-equivalent. `get_ai_wallet_summary` (mig 117) already returns
`est_price_per_card_micro` and `balance_micro_won`, rendered by the existing `formatUsdMicro`.

The store gains `enrichmentQuote { estPriceMicro, balanceMicro }` + `loadEnrichmentQuote()`, called
when the action menu opens. If the quote cannot be read the menu still works and simply shows no
number — a failed quote must not block a feature the learner has credits for, and it must not
render `$0.00`, which would be a lie in the direction that costs money.

## 6. Surfaces (PR B)

**Web** already renders `AttemptHistory` (last 10). Rows whose `normalized_score < 0.75` — i.e.
anything that was not "known" — get an action menu: `explain` / `hint`, the quote line, and the
existing distinct error messages (`AI_INSUFFICIENT_CREDITS` / `AI_RATE_CAP` /
`AI_GROUNDING_REQUIRED` / …).

**Mobile** has no attempt list at all today (`attempts` is unreferenced in
`LearningTodayScreen.tsx`). PR B adds the same compact list with the same rule and the same menu.
Parity comes from the shared store plus the shared `latestAttemptForCard` helper, not from two
implementations agreeing by accident.

The plan-row `explain` button stays card-scoped, and becomes attempt-grounded only when that item
already has an attempt (completed items). No new button on the plan row.

## 7. Security and privacy

- No new grant, no service-role key in a client. Attempt reads use the owner-only `SELECT` policy
  from mig 165; the prompt context is assembled server-side under the existing checks.
- `reserve_ai_remediation` already rejects another user's attempt (`42501`). PR A pins that in SQL
  rather than trusting it, because it is now reachable from the UI for the first time.
- `attemptHistory` carries scores and timestamps only. Free-text responses (when they exist) stay
  out of the prompt unless the action needs them, and `evaluate` — the action that would need them
  — is not shipping here.
- Enrichment rows stay owner-only. **There is no caching today** — `request_fingerprint` is
  written and never read back by anything (verified: it appears only at the write site and in
  the schema). Said plainly because an earlier draft of this section claimed a per-`(cardId,
  attemptId)` cache existed; it does not, and PR B must not assume a repeat click is free.
  When a cache is added it has to key on `(cardId, attemptId)`, never on the card alone: a
  grounded explanation is about one failure and must not be replayed as if it were about the
  card. `attempt_id` (mig 178) is what makes that key expressible; the 128-char truncated
  fingerprint could not.

## 8. Testing

| Layer | What is pinned | Where |
|---|---|---|
| SQL (mig 178) | `attempt_id` persists; a foreign attempt is rejected `42501` by both `reserve_ai_remediation` and `persist_ai_remediation`; the old 12-arg function no longer exists (no silent-drop overload); grants restored | `supabase/tests/ai_remediation_test.sql` (extended) |
| Pure helper | newest attempt wins, deterministic tie-break, `null` when the card has none, ignores other cards | `learning-attempt-selection.test.ts` (new) |
| Store | `attemptId` reaches the edge payload; omitting it sends no key; quote loads and a failed quote leaves the feature usable; each errcode still maps to its own state | `learning-store.test.ts` (extended) |
| UI | the menu appears only for attempts scored below "known"; `explain`/`hint` pass the attempt id; the quote renders; a request in flight disables the menu | `learning-pages.test.tsx` (extended) |
| i18n | new keys in all 8 locales on both platforms | existing key-usage guards + `learning-reason-codes`-style chain test already in place |

## 9. Rollout

PR A is inert on its own: the new column is nullable, the new parameter defaults to `NULL`, and no
client sends an attempt yet. PR B turns it on. Production still lacks the learning chain (165–178),
which is owner-gated and unchanged by this workstream. Rollback is reverting B, then A; the column
can stay (additive, nullable) if only B is reverted.

---

## 10. Progress — 2026-07-31 23:5x

### PR A — written, verified locally, **uncommitted**

| Done | Where |
|---|---|
| mig 178: `user_enrichments.attempt_id` (+ index), `persist_ai_remediation` recreated with `p_attempt_id` and an ownership check, old 12-arg function dropped, grants re-issued | `supabase/migrations/178_enrichment_attempt_provenance.sql` |
| Rollback script, marked destructive (dropping the column discards provenance) | `supabase/rollbacks/178_enrichment_attempt_provenance.down.sql` |
| Prompt: `attemptHistory` (≤5, score+timestamp only) in the context contract, plus explicit instructions to USE the attempt as evidence and to never claim to know an answer the learner never wrote | `supabase/functions/_shared/ai-remediation.ts` |
| Edge fn: attempt row now also carries `hints_used` / `duration_ms`; same-card attempt history query (capped, user-scoped, failure is non-fatal); `p_attempt_id` persisted; `prompt_version` → `remediation-v2` | `supabase/functions/ai-generate/index.ts` |
| Store: `requestEnrichment({ ..., attemptId? })` passthrough (key omitted when absent), `enrichmentQuote` + `loadEnrichmentQuote()` (fails to `null`, never renders a price of 0), reset covers the quote | `packages/shared/stores/learning-store.ts` |
| Pure helper `latestAttemptForCard` / `attemptNeedsRemediation` (+ `KNOWN_SCORE_THRESHOLD`) — the shared rule for which attempt a paid call is grounded in | `packages/shared/lib/learning-attempt-selection.ts` |
| Helper tests (11 cases: newest wins, deterministic tie-break, undatable row never wins, other cards ignored, "unknown score is not a miss") | `packages/web/src/lib/__tests__/learning-attempt-selection.test.ts` |
| SQL test: provenance stored, `prompt_version` recorded, foreign attempt rejected on BOTH `persist` (service-role path) and `reserve` (auth path), `ON DELETE SET NULL` keeps a paid answer alive, exactly one `persist_ai_remediation` with 13 args, grants restored | `supabase/tests/ai_remediation_test.sql` |

| Store tests: the attempt id reaches the edge payload, the key is *absent* (not null) when not supplied, the quote loads, and a failed quote leaves the feature usable | `packages/web/src/stores/__tests__/learning-store.test.ts` |
| Prompt-contract tests: grounding text appears only with an attempt, the model is never told it saw an answer, placeholder effort fields are stripped, real ones are kept, and `attemptHistory` reaches the payload — the edge module is importable from web vitest, so this needs no deno harness | `packages/web/src/lib/__tests__/ai-remediation.test.ts` |
| Dry run extended to cover this migration, reverting it **before** 168 | `scripts/dry-run-learning-migrations.sh`, `supabase/tests/learning_dry_run_check.sql` |

### 10.1 Defects found while finishing PR A — all fixed

1. **The migration number collided — twice.** It was written as `175`, but
   `175_admin_list_payments_refund_status.sql` had already merged (#371). Renumbered to `176` —
   which then collided too, because `176_drop_dead_session_override.sql` (#372) and
   `177_admin_growth_levers_read.sql` (#375) landed on develop while this branch was in flight.
   Final number is **178**, after merging develop in.

   Worth recording precisely, because the two CI jobs disagree about whether this is an error:
   the **plain `psql` loop** in the AI-metering job applies both files happily (the glob just
   sorts them), which is why a local reproduction of that job stayed green through the whole
   first round. **`supabase db reset`** (Migration Safety / Integration) does catch it —
   `supabase_migrations.schema_migrations` has a unique key on the numeric version, so the second
   `176` died on `duplicate key value violates unique constraint "schema_migrations_pkey"`.
   The lesson for the next migration on this repo: **`git fetch` develop and check the highest
   number immediately before pushing**, because a number that was free when the branch started
   may not be when it merges.
2. **The learning dry run would have failed CI.** `scripts/dry-run-learning-migrations.sh` reverts
   165/167/168/169, and `168.down` drops `persist_ai_remediation` by its exact **12-argument**
   signature. This migration replaces that function with a **13-argument** one, which the drop
   therefore misses, so the function survived the rollback and
   `learning_dry_run_check.sql` failed with `[before] expected a clean slate, found 1 learning
   functions`. Fixed by adding 178 to the script's `MIGRATIONS`/`ROLLBACKS`, reverted before 168.
3. **The rollback was not idempotent.** Its `ALTER TABLE user_enrichments DROP COLUMN` aborted on
   the dry run's second revert pass, which runs after 165 has already dropped the table — the
   exact "backing out a half-applied rollout must not itself fail" property that phase exists to
   prove. Fixed with `ALTER TABLE IF EXISTS`.

4. **The prompt told the model to reason from two columns that are always 0.** It named
   `attempt.hints_used` and `attempt.duration_ms` as evidence, but `record_answer_attempt`
   defaults both to 0, the store never sends `p_hints_used`, and neither rating button sends a
   duration — so every attempt in existence has 0 for both. Inviting a model to interpret a
   constant is how you get "you answered this instantly, so…" about a learner who did no such
   thing. And `hints_used: 0` is not merely uninformative but *false* once a learner buys a hint:
   the `hint` action never increments it. The fields are now **stripped from the payload** when
   they hold the default, rather than explained away in an instruction — a model cannot misread a
   field it was never given, and `duration_ms: 0` is not an absent signal it can discount, it is
   the assertion "answered in 0 ms". They are sent, and named as evidence, only once they carry a
   real value. §2 and §3 corrected — they claimed duration and hint count were real evidence.
5. **The attempt and the card were never related to each other.** Fixed by the pair check in §4,
   and `attemptHistory` is now keyed on the card the *attempt* is on rather than the card the
   request names — the prompt is built before the write, so it cannot lean on the new check.
6. **The doc claimed a cache that does not exist.** §7 said enrichments are "cached per
   `(cardId, attemptId)`". `request_fingerprint` is written and never read by anything. Corrected
   — PR B must not assume a repeat click is free.

Also wrapped 178 in `BEGIN/COMMIT` (as mig 168 is): it DROPs the only function that can persist a
paid remediation, so a failure between the drop and the create would leave every paid call
charging the wallet and then failing to store its result. And `EnrichmentQuote` was missing from
web's `learning-store` re-export facade, which PR B needs to render the quote.

Two audit findings were **rejected after checking them**: that the pair check should require
`attempt.card_id = p_card_id` outright (it must not — that rejects legitimate activity-only
attempts), and that `KNOWN_SCORE_THRESHOLD` should be merged with `learning-insights`'
`KNOWN_THRESHOLD` (they are the same number today but mean different things — a display cutoff
versus a billing-eligibility gate, and aliasing them would let a cosmetic stat tweak silently
change what a learner can be charged for).

Verified by running, not by reading:

- web `tsc -b` 0, mobile `tsc` 0, web vitest **2384 tests pass** (2375 + 4 store + 5 prompt-contract)
- a **fresh** database bootstrapped and stepped through the whole CI SQL job: all migrations apply
  in order, **21/21** SQL suites pass, and the learning dry run passes last — `LEARNING_DRY_RUN_PASSED`
- exactly one `persist_ai_remediation` (13 args); `anon` f / `authenticated` f / `service_role` t
- re-applying 178 on top of itself is a no-op (every step `IF EXISTS`/`IF NOT EXISTS`)
- the rollback restores mig 168's function body **byte-for-byte** (diffed, not eyeballed)
- `deno check` clean on `ai-generate/index.ts` and `_shared/ai-remediation.ts` (deno 2.9.3 IS
  available locally — an earlier note in this repo's history said it was not)
- **mutation-tested, each fix individually reverted and confirmed red:**
  storing `NULL` instead of `p_attempt_id` → `attempt provenance was not stored`;
  dropping 178 from the dry run's rollback list → `[before] expected a clean slate, found 1
  learning functions`; removing `IF EXISTS` → `ERROR: relation "user_enrichments" does not exist`;
  always sending `attemptId` → the payload-shape test fails; a zeroed quote instead of `null` →
  the "wallet cannot be read" test fails; removing the pair check → `expected rejection of an
  attempt on a different card`; widening it to reject a null card → the activity-attempt
  assertion fails; renaming `p_attempt_id` (with an explicit DROP, since `CREATE OR REPLACE`
  refuses to rename a parameter) → the PostgREST-binding assertion fails

### PR A — what is left

1. Commit + push + PR + merge cycle.

### PR B — not started

1. **Web**: action menu (`explain` / `hint`) on `AttemptHistory` rows where
   `attemptNeedsRemediation(attempt)`, passing `attemptId`; quote line; in-flight disabling.
2. **Mobile**: `LearningTodayScreen` has no attempt list at all — add the compact list, call
   `fetchAttempts`, same menu, same rule.
3. **i18n**: new keys in 8 locales × 2 platforms (`enrichment.action.*`, `enrichment.quote`,
   `enrichment.groundedHint`, mobile `history.*` if the list needs its own strings).
4. **Tests**: UI tests per design §8 (menu only for sub-"known" attempts, ids passed, quote
   rendered), and the i18n guards must stay green.

### Known constraint to carry into PR B

`compare` and `evaluate` stay unreachable, by design (§2): today's attempts store
`{ self_rated: score }`, so there is no learner text to compare or grade. The PR B copy must not
imply the AI saw an answer the learner never wrote — the prompt already forbids the model from
claiming it.
