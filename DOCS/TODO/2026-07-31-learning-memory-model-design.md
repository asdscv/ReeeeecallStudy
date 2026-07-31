# Learning Engine — Memory Model in the Planner (`daily-plan-v2`)

- **Status:** Proposed → implemented in this branch (`feat/learning-engine-memory-model`).
- **Builds on:** [modular-learning-engine-design](../DONE/LEARNING-ENGINE/2026-07-29-modular-learning-engine-design.md)
  (§9 planner, §19 deferred "FSRS shadow scoring"), and
  [learning-product-ui-design](./2026-07-31-learning-product-ui-design.md) Phases 1–5b.
- **Base:** `origin/develop` `eb0411d`.
- **Scope:** one PR. Pure domain + mapper + i18n + tests. No migration, no schema change,
  no scheduler change.

---

## 1. What is wrong with `daily-plan-v1`

`v1` ranks by five features and gives `dueUrgency` the largest single weight (0.35):

```
dueUrgency 0.35 | recentFailure 0.25 | goalRelevance 0.20 | responseTimePenalty 0.10 | contentImportance 0.10
```

`dueUrgency` (in `shared/lib/learning-candidates.ts`) rises monotonically with how overdue a
card is and saturates at +7 days. So **the most overdue card always wins**. That is the wrong
objective, and it is wrong in a way that gets worse the longer someone is away from the app:

- A card overdue by 30 days and a card overdue by 8 days are both `1.0`. The planner cannot
  tell them apart even though their recall probabilities are far apart.
- A card whose scheduled interval was 3 days and one whose interval was 300 days are ranked by
  the same "days late" number, though 5 days late means something completely different in each
  case. Lateness is only meaningful **relative to the memory's stability**.
- Cards a learner is nearly certain to still know can outrank cards at the point where a review
  actually buys something, because being late is rewarded on its own.

## 2. What the evidence says instead

FSRS models memory with Difficulty, Stability, Retrievability, and defines **stability `S` as
the number of days for retrievability to fall from 100% to 90%**. From FSRS-4.5 on the
forgetting curve is a power function, because a deck of mixed-difficulty items is a
superposition of exponentials and that is fit better by a power law than by any one
exponential:

```
R(t) = (1 + FACTOR · t/S)^DECAY      DECAY = −0.5,  FACTOR = 19/81
```

The constants are not tunables: `(1 + 19/81)^(−1/2) = (100/81)^(−1/2) = 0.9` exactly, which is
the definition of `S` above. A unit test asserts this identity rather than trusting it.

FSRS's stability-increase term grows as retrievability **at review time falls** — "the best time
to review is when you almost forgot it, **provided you succeeded in recalling it**". Both halves
matter and they oppose each other: waiting longer means a larger gain on success and a lapse on
failure. Therefore the value of scheduling a review **peaks at a retrievability strictly below
1** (0.9, the retention every mainstream implementation defaults to and the value `S` is
anchored to) and falls away on both sides — steeply above it, gently below it.

## 3. The feature: `reviewValue`

`packages/shared/learning/application/memory.ts` (pure, no I/O) computes:

```
stabilityDays  = fitted stability if we ever have one, else the legacy interval  (bridge)
elapsedDays    = now − last_reviewed_at
retrievability = R(elapsedDays, stabilityDays)                                  (null if unknown)
reviewValue    = 1 at R = target(0.9); → 0 as R → 1; decays gently as R → 0
```

Asymmetry is a parameter, `BELOW_TARGET_TOLERANCE = 2.5`: below the target the distance to the
peak is discounted by that factor, so at `R = 0` the value is `1 − 0.9/2.25 = 0.6`. **It does
not reach 0 on the at-risk side, and that is deliberate** — a probably-forgotten card still
needs relearning, it is just more expensive than one caught at the peak. What must never happen
is a certainly-known card (`R → 1`, value → 0) outranking an at-risk one.

### 3.1 "Unknown" is not zero

`retrievability` returns `null` — not 0 — when it cannot be computed: no interval (a brand-new
card), no `last_reviewed_at`, unparseable timestamps. Reporting 0% recall for a new card would
send the planner the exact opposite of the truth. `reviewValue` propagates the null, and §4
says what the planner does with it.

### 3.2 The interval→stability bridge is named, not hidden

`stabilityFromInterval` is the identity function. This app's SRS is SM-2-shaped
(`ease_factor`, `interval_days`, `repetitions`) and owned by `apply_study_rating`; a legacy
scheduler picks its interval so recall is still likely at the end of it, which is what stability
means, so the interval is the best single estimate available without a per-card fit of review
history. A tuned multiplier here would look like precision the data does not support.
`estimateMemory` already prefers a supplied `stabilityDays`, so the day a fitted value exists it
is used without any caller change.

**This module does not schedule anything.** It reads the SRS state to estimate recall
probability so the planner can order a day's work. Replacing SM-2 with FSRS is a separate,
migration-heavy decision and is still out of scope (design §19).

## 4. Planner changes (`daily-plan-v2`)

### 4.1 Weights

```
reviewValue 0.25 | recentFailure 0.25 | goalRelevance 0.20 | dueUrgency 0.10
              | responseTimePenalty 0.10 | contentImportance 0.10        (= 1.00)
```

The whole redistribution comes out of `dueUrgency` (0.35 → 0.10). Nothing else moves, so this PR
changes exactly one thing about ranking: *how much of "review this now" is raw lateness versus
estimated recall*. `dueUrgency` is kept, not deleted, because it is the only feature that speaks
for a **new** card (never reviewed → 1) and for cards where `reviewValue` is null.

### 4.2 Renormalisation, not substitution

`scoreCandidate` sums only the features it actually has and divides by the weight it actually
used:

```
score = Σ(w_i · f_i) / Σ(w_i)    over features present
```

For a candidate with `reviewValue`, the denominator is 1.0 and this is identical to v1's form.
For a candidate without one, the denominator is 0.75. This is what keeps the two populations
comparable: with substitution (a fabricated 0.5) a new card would be silently ranked on a made-up
memory estimate; with implicit zero it would be buried. Renormalisation says "we scored this card
on the evidence available" and nothing else. Design §9.2's rule ("no implicit zero for missing
evidence") is thereby satisfied without inventing a neutral value at the domain layer.

`reviewValue` is declared `readonly reviewValue?: number | null` on `PlannerCandidate`, so
*absent* and *incomputable* land on the same path. A caller that has not been updated keeps
working and is scored on the four remaining features — no crash, no silent fake input.

### 4.3 `reasonCode: memory_risk`

The reason code is already "the feature that contributed most". `reviewValue` joins that list as
`memory_risk`, and is excluded from it when null (a card cannot be picked for a reason we could
not compute). Rendered as "잊기 직전" / "at risk of forgetting" — the phrase has to say *why now*,
because "due" is what v1 said for the same row and would now be a lie for a card chosen at its
retrievability peak while a more overdue card sat below it.

### 4.4 Version bump

`DAILY_PLANNER_VERSION` becomes `daily-plan-v2`. `daily_plans.algorithm_version` exists to make
stored plans re-interpretable; a plan whose ordering came from different weights must not claim
to be v1. The value is also part of what the store sends to `save_daily_plan`, and the SQL
suites use their own literals, so nothing server-side needs changing.

The `input_fingerprint` changes for every candidate set, since candidates are serialised into it.
That is correct — the same cards genuinely produce a different plan now. Determinism is unchanged
and still asserted.

## 5. Mapper changes

`buildCandidatesFromCards` calls `estimateMemory({ intervalDays: card.interval_days,
lastReviewedAt: card.last_reviewed_at, now })` and passes `reviewValue` through. No new query:
`CARD_COLUMNS` in `learning-store.ts` already selects `interval_days` and `last_reviewed_at`.

Consequence worth stating, because it is the visible behaviour change: the store fetches only
the **due** set (`next_review_at <= now OR IS NULL`). For a due card, elapsed ≥ interval, so
`R ≤ 0.9` and it sits on the at-risk side. A card that just came due lands at the peak
(value ≈ 1); a card overdue by many multiples of its interval lands near the 0.6 floor. So
**the ordering within a backlog inverts** compared to v1: the planner now works the freshly-due
edge first instead of the oldest debt first. That is the intended outcome — it is where a review
buys the most stability — and it is why the version had to change.

## 6. Zero-defect audit notes

- **Clock skew.** `last_reviewed_at` in the future gives `elapsedDays < 0`; `retrievability`
  returns 1 (not a value > 1 and not null), so the card is treated as just-reviewed and
  deprioritised. Bounded and harmless.
- **`interval_days = 0`.** Learning-step cards can carry 0; `stabilityFromInterval` returns
  null for `≤ 0` rather than dividing by zero. Such a card is scored without the feature.
- **Range.** `retrievability` is clamped to `[0,1]` and `reviewValue` to `[0,1]`; the planner
  clamps again in `scoreCandidate`, so a future caller supplying garbage cannot inflate a score.
  `target` is clamped to `[0.01, 0.99]` so a misconfigured target cannot divide by zero.
- **Denominator.** The renormalising divisor is a sum of positive constants with `dueUrgency`
  always present, so it can never be 0.
- **No new I/O, no new grant, no new PII.** The module is arithmetic over columns the store
  already reads under the owner-only RLS policies from mig 165.

## 7. Testing

| Layer | What is pinned | Where |
|---|---|---|
| Memory model | `R(S) = 0.9` exactly (the FSRS identity); monotone decay in `t`; null for new/undated/zero-interval cards; peak of `reviewValue` at the target; over-learned side reaching 0 at `R = 1`; the 0.6 at-risk floor; clamped target | `packages/web/src/lib/__tests__/learning-memory.test.ts` (new) |
| Planner | a card at the retrievability peak outranks a more-overdue certain one; a null `reviewValue` is renormalised (not zeroed, not faked) and stays comparable; `memory_risk` appears as a reason code and never for a null feature; determinism and budget behaviour unchanged | `learning-daily-planner.test.ts` (extended) |
| Mapper | `reviewValue` derived from `interval_days`/`last_reviewed_at`; null for a never-reviewed card; unchanged features elsewhere | `learning-candidates.test.ts` (extended) |
| Store | `p_algorithm_version` is `daily-plan-v2` | `learning-store.test.ts` (updated) |
| Reason-code chain | every code the planner can emit is mapped on BOTH screens and resolves in all 8 locales on both platforms — the code list is read from the planner source, so adding a feature without a phrase fails | `learning-reason-codes.test.ts` (new) |
| i18n | `today.reason.memoryRisk` present in all 8 locales on both platforms | above, plus the existing mobile `i18n.test.ts` (family list extended) |

Each new assertion is mutation-tested: the behaviour it claims to pin is reverted locally and
the test must go red.

## 8. Rollout

No flag, no migration, no production dependency. The next plan a user generates is a v2 plan;
plans already stored keep their `daily-plan-v1` version and render exactly as before (the reason
codes they contain are all still mapped). Rollback is reverting this PR — nothing persisted
depends on v2 beyond a version string in rows created after it.
