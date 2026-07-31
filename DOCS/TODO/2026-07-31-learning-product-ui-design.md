# Learning Engine — Product UI Design

- **Status:** Proposed. Implements design §19's first deferred item ("Product/UI flow for goal
  creation, diagnostics, daily plan, attempt review, and enrichment acceptance").
- **Builds on:** [modular-learning-engine-design](../DONE/LEARNING-ENGINE/2026-07-29-modular-learning-engine-design.md)
  (merged as `ac74b45`, PR #337), migrations 165/167/168/169, `packages/shared/learning/`.
- **Base:** `origin/develop` `06fd167`.

---

## 1. Decision summary

1. **Web first, mobile after.** The engine has no product surface on either platform. Web is
   where deck authoring, study setup, and the admin surfaces already live, and it ships on
   merge to `main` (mobile needs a store release). Mobile parity is Phase 5.
2. **Four shipping phases, one PR each.** Phase 1 makes the engine reachable (goals + today's
   plan). Phase 2 closes the loop (attempts). Phase 3 adds paid enrichment. Phase 4 adds
   diagnostics/recommendations. Nothing in a later phase is a prerequisite of an earlier one.
3. **The planner stays pure.** `buildDailyPlan` does not query Supabase (design §9.1). A new
   pure mapper turns legacy cards + recent study logs into `PlannerCandidate[]`, and a store
   does the I/O. This keeps the scoring unit-testable without a database.
4. **Reads go through RLS, writes go through RPCs.** Every learning table grants `SELECT` to
   the owner only and has no client write path (mig 165). The UI must never reach for a
   service-role key; anything the RPCs do not expose is a gap to close in SQL, not to work
   around in the client.
5. **One new migration in Phase 1 (172).** `learning_goal_decks` and
   `learning_goal_concepts` have **no writer** — see §3. Without it a goal cannot be
   attached to anything, so the planner has no candidate scope and `goalRelevance` is
   unreachable.

---

## 2. Current state, verified

Merged and live in `develop`:

| Piece | Where |
|---|---|
| Schema: goals, joins, concepts, activities, attempts, plans, plan items, recommendations, enrichments, sources | migs 165/167/168/169 |
| RPCs: `create_learning_goal`, `update_learning_goal`, `archive_learning_goal`, `save_daily_plan`, `record_answer_attempt`, `set_user_enrichment_status`, `create_private_{source,concept,activity}` | mig 167 |
| Paid remediation metering: `reserve_ai_remediation` / `persist_ai_remediation`, `kind:'remediation'` in `ai-generate` | mig 168 |
| Domain module: types, ports, registries, adapters, evaluators, `buildDailyPlan` | `packages/shared/learning/` (22 files) |
| Tests: `learning_engine_test`, `ai_remediation_test`, `learning_smoke_test`, `learning_net_zero_test`, dry-run | CI `ai-credit-tests` |

Missing, which is what this document is about:

```
$ grep -rn "create_learning_goal|save_daily_plan|record_answer_attempt|learning_goals" \
    packages/web/src packages/mobile/src packages/shared --include=*.ts --include=*.tsx | grep -v __tests__
(no results)

$ grep -rn "shared/learning" packages/ --include=*.ts --include=*.tsx | grep -v node_modules
packages/web/src/lib/__tests__/learning-domain-adapters.test.ts
packages/web/src/lib/__tests__/learning-daily-planner.test.ts
packages/web/src/lib/__tests__/learning-evaluators.test.ts
```

The module is imported by **tests only** and no product code calls a single learning RPC.
`NextGoalsWidget` / `NextGoalsCard` are a different, older feature (`get_next_goals`) and are
not part of this engine.

Migrations 165–169 are **not applied to production** (deliberate, owner-gated). This
workstream does not change that; every phase is verified against a local database.

---

## 3. Gap found: the goal↔deck join has no writer

`learning_goal_decks(goal_id, deck_id, importance)` and `learning_goal_concepts(...)` were
created with owner-`SELECT` RLS and `REVOKE ALL ... FROM authenticated`, but mig 167 ships no
RPC that writes them, and nothing else in the repo does either:

```
$ grep -rn "learning_goal_decks" supabase/migrations/*.sql
165: CREATE TABLE / ENABLE RLS / SELECT policy / REVOKE / GRANT SELECT / GRANT ALL service_role
168: (read-only access checks in reserve_ai_remediation)
```

So today a user can create a goal and can never attach a deck to it. Consequences:

- the planner has no scope — candidates would have to be "every card the user owns";
- `goalRelevance` (0.20 of the priority weight) has no input;
- `importance` (design §7.5, bounded 0..1) is unreachable.

**Phase 1 adds mig 172** with one RPC per join, replacing the whole set for a goal so the
client never has to diff:

```sql
set_learning_goal_decks(p_goal_id uuid, p_decks jsonb)      -- [{deck_id, importance}]
set_learning_goal_concepts(p_goal_id uuid, p_concepts jsonb)
```

Contract, matching mig 167's idioms exactly (`auth.uid()`, `P000x` errcodes, bounded payloads):

- goal must exist, be owned by `auth.uid()`, and not be `archived`;
- every `deck_id` must be **readable by the caller** — reuse the same entitlement predicate the
  card/deck RPCs use rather than inventing a second notion of deck access, so a shared or
  marketplace deck the user lost access to cannot stay attached;
- `importance` out of 0..1 is **rejected** (`P0002`), not clamped: the column already has
  `CHECK (importance >= 0 AND importance <= 1)`, and clamping would hide a client that is
  computing importance wrongly. Omitted `importance` defaults to the neutral 0.5.
  Duplicate `deck_id` is rejected too (not silently collapsed — a duplicate means the
  caller is confused about its own state);
- at most 50 decks and 200 concepts per goal, payload ≤ 16 KiB;
- replace-all semantics inside one transaction: `DELETE` then `INSERT`, so a partial failure
  leaves the previous set intact;
- passing `[]` detaches everything, which is legal and meaningful (a goal with no decks plans
  nothing and the UI says so).

`set_learning_goal_concepts` ships in the same migration even though Phase 1's UI only calls
the deck one: the two tables are symmetric, mig 168's remediation access check already reads
`learning_goal_concepts`, and leaving one half writer-less is how this gap happened.

---

## 4. Where the code goes

```
packages/shared/lib/learning-candidates.ts     NEW  pure: legacy cards + study logs → PlannerCandidate[]
packages/shared/stores/learning-store.ts       NEW  zustand: goals, plan, I/O (supabase reads + RPCs)
packages/web/src/pages/learning/
  LearningTodayPage.tsx                        NEW  today's plan for the active goal
  LearningGoalsPage.tsx                        NEW  goal list + create/edit/archive
  GoalFormModal.tsx                            NEW  create/edit form incl. deck attachment
packages/web/public/locales/<8>/learning.json  NEW  namespace `learning`
supabase/migrations/172_learning_goal_links.sql NEW  the two join writers
supabase/tests/learning_goal_links_test.sql    NEW  CI-wired
```

Deliberate boundaries:

- **`packages/shared/learning/` is not touched.** It is the domain module the design froze; the
  candidate mapper is app-layer glue (it knows about `cards` rows and SRS columns) and belongs
  in `shared/lib`, next to the other legacy-facing helpers.
- **No new AI code in Phase 1.** Remediation already exists server-side; wiring it is Phase 3.
- **No study-flow changes in Phase 1.** A plan item deep-links into the existing study screen;
  writing attempts back is Phase 2, where the coupling can be designed on its own.

### 4.1 Candidate mapping (`learning-candidates.ts`)

Pure function, no imports from supabase:

```ts
buildCandidatesFromCards(input: {
  cards: readonly LegacyCardRow[]        // id, deck_id, srs_status, next_review_at, interval_days,
                                          // repetitions, ease_factor, last_reviewed_at, field_values
  recentLogs: readonly StudyLogRow[]     // card_id, rating, review_duration_ms, studied_at
  deckImportance: Readonly<Record<string, number>>   // from learning_goal_decks
  now: string
  medianDurationMs: number | null
}): readonly PlannerCandidate[]
```

Feature derivation — each one states its neutral value, because the design forbids implicit
zero for missing evidence (§9.2):

| Feature | Source | Missing → |
|---|---|---|
| `dueUrgency` | `next_review_at` vs `now`, saturating at +7d overdue; never-reviewed card = 1 | 0.5 |
| `recentFailure` | share of `rating <= 2` in that card's last 5 logs | 0.3 (unknown, mildly favoured) |
| `responseTimePenalty` | card's median `review_duration_ms` ÷ the user's median, clamped | 0.5 |
| `goalRelevance` | `deckImportance[deck_id]` | 0.5 |
| `contentImportance` | 0.5 flat until curated metadata exists (design §5.2) | 0.5 |
| `estimatedMinutes` | 0.5 min per recall item (tunable constant, not per-card guessing) | — |

`activityType` comes from `activitiesForLegacyCard` (the language adapter), so a legacy card
yields `recall / self_rate / self_rate` exactly as design §5.2 specifies. Plan items carry
`card_id`; no `learning_activities` row is created in Phase 1 (`save_daily_plan` accepts either).

### 4.2 Data flow for "today's plan"

```
open /learning
  → learning-store.loadGoals()          select learning_goals + learning_goal_decks  (RLS)
  → pick the active goal (single active goal in Phase 1; §6 covers multiple)
  → loadTodayPlan(goal)                 select daily_plans + daily_plan_items for (goal, today@tz)
      plan exists → render it (+ read the referenced cards, so a row can show what to
                    study and link to its deck — plan items store only the card id)
      no plan     → the page offers a BUTTON; on press:
                    loadCandidateInputs(goal)   select DUE cards of attached decks (cap 500)
                                                + last 30d study_logs for those decks
                    buildCandidatesFromCards(...)
                    buildDailyPlan({ goal, candidates, budgetMinutes: goal.dailyMinutes, ... })
                    save_daily_plan(...)        RPC; upsert per (user, goal, date)
                    re-read the saved plan      the DB rows are the source of truth for the UI
```

Notes that follow from the RPC's actual behaviour (read from mig 167, not assumed):

- `save_daily_plan` upserts per `(user_id, goal_id, plan_date)`, **refuses to overwrite a
  `completed` plan** (`P0007`), and is rate-limited to **50 saves/day** (`P0006`). The UI
  therefore generates a plan **only on explicit intent** — first visit of the day, or the
  user pressing "다시 만들기" — never in a `useEffect` that can re-fire. Both error codes get
  their own message; a rate-limit surfaced as a generic failure would be a support ticket.
- Plan date is computed in the **user's timezone** (`Intl.DateTimeFormat().resolvedOptions().timeZone`,
  falling back to `UTC`), and the same string is passed as `p_timezone`, so the plan the user
  sees and the row stored agree about which day it is.
- Timezone note: the mobile side is Intl-free by policy (`shared/lib/format-number`); Phase 5
  must supply the zone another way rather than importing `Intl` on Hermes.

---

## 5. Phase 1 — scope, screens, acceptance

**Goal: the engine becomes reachable and produces a plan a user can act on.**

### 5.1 `/learning/goals` — goal list + create/edit/archive

- list active/paused goals with domain, daily minutes, target date, attached deck count;
- create: domain (`language` | `labor-law`, from the domain registry — not a free-text field),
  title, daily minutes (1–1440, validated client-side to match the RPC), optional target date,
  deck multi-select from the user's decks;
- edit: same form via `update_learning_goal` + `set_learning_goal_decks`;
- archive with confirmation, stating that archived goals stop planning (`save_daily_plan`
  rejects archived goals with `P0003`);
- empty state explains what a goal does and links to deck creation when the user has no decks.

### 5.2 `/learning` — today's plan

- header: goal title, budget vs planned minutes, completed/total items;
- item rows: what to study (card front preview or activity title), `reasonCode` rendered as a
  human reason ("복습 시점", "최근 오답", "응답 지연", "목표 관련도", "중요도"), estimated minutes,
  status;
- primary action per item: open the existing study screen for that card's deck;
- "다시 만들기" regenerates (guarded by the completed-plan and rate-limit rules above);
- states: no goal → link to §5.1; goal with no decks → say so and link to edit; decks with no
  due cards → say the day is clear rather than showing an empty list.

### 5.3 Acceptance criteria

- a fresh account can create a goal, attach a deck, and get a plan whose items are that deck's
  cards, ordered by the planner's priority;
- reloading the page does **not** create a second plan or increment the save counter;
- the same inputs produce the same `input_fingerprint` (determinism, design §9.4);
- a goal with zero attached decks never calls `save_daily_plan` (it would fail item validation);
- `P0003` / `P0006` / `P0007` / `P0002` each render a distinct, actionable message;
- `tsc -b` clean, web lint clean, the new vitest suites pass, `learning_goal_links_test.sql`
  passes in the CI chain, and all 8 locales carry every new key (the i18n key-usage test
  fails otherwise).

---

## 6. Later phases

**Phase 2 — attempt recording.** Completing a plan item writes `record_answer_attempt`
(idempotent on `client_attempt_id`) and advances `daily_plan_items.status` /
`daily_plans.completed_*`. Needs a decision the study flow does not currently have: whether a
legacy SRS rating is *also* an attempt (design §8.1 converged on `apply_study_rating` for the
SRS write, so an attempt is an additional, non-authoritative record). Attempt review UI
(history of attempts per card/concept) rides along.

**Phase 3 — enrichment (paid).** `ai-generate` `kind:'remediation'` already reserves and
charges. UI: request explain/compare/hint from a card or a failed attempt, show the result with
its `source_references`, then accept/reject via `set_user_enrichment_status`. Must show the
credit cost before the call and handle `AI_INSUFFICIENT_CREDITS` / `AI_RATE_CAP` /
`AI_GROUNDING_REQUIRED` distinctly. Grounding matters: labor-law content without a citation is
refused server-side, and the UI has to explain why rather than showing a generic failure.

**Phase 4 — diagnostics.** Shipped as diagnostics only, and two things in the original
sentence were wrong:

* **`study_recommendations` has no producer.** Nothing in the repo writes it — no RPC, no
  code, only the table, its RLS SELECT policy and two indexes. A "recommended for you" feed
  would therefore be permanently empty. Writing a producer is a design decision about WHO
  recommends (a deterministic, versioned client algorithm like the planner, or the AI
  remediation path) and it is deferred rather than faked. That is **Phase 4b**, now shipped:
  mig 174 adds `set_study_recommendations` (replaces only the PENDING set, so an accept or a
  dismiss survives every regeneration) and `set_study_recommendation_status` (terminal, like
  the enrichment one). The first producer is the deterministic `weak-card-v1` algorithm, and
  an ACCEPTED recommendation raises that card's `contentImportance` in the next plan — which
  is the only reason the row is worth storing at all.
* **`PersonalAnalyticsPage` did not need resurrecting.** Analytics already lives as a tab
  inside `/history` (`PersonalAnalyticsContent`, lazy-loaded there); the page-level export is
  a redirect *because* of that, not as a placeholder. Rebuilding it would have produced a
  second answer to the same question.

What shipped instead: `/learning/insights`, derived from the engine's own records —
`answer_attempts` (30 days) and `daily_plans` (14 days) — with attempts, accuracy, typical
answer time, plan adherence per day and overall, and the cards worth another look. A
per-concept mastery view is not possible yet for the current data: legacy cards project with
`concept_id = null` (design §5.2), so there are no concepts to aggregate until curated
content exists.

**Phase 5 — mobile parity.** Shipped: `LearningTodayScreen` (plan, self-rating, enrichment)
and `LearningGoalsScreen` (list, create with deck picker, archive), reached from the drawer.
The shared store drives both platforms, so none of its rules are re-implemented natively.

Two things this phase changed outside mobile:
* `learning-plan-date` moved from the web package to `shared/lib` and was split — the DATE is
  computed from `Date`'s local getters (no ICU), while the ZONE is an `Intl` attempt that
  falls back to a real `UTC±HH:MM` offset label. Defaulting to `'UTC'` would have recorded a
  zone the user is not in; an offset says what was actually used. Web now re-exports it, so
  the two platforms cannot drift about which day it is.
* `packages/mobile/tsconfig.json` gained `allowImportingTsExtensions` (with `noEmit`), which
  `tsconfig.app.json` already had: `shared/learning/**` imports with explicit `.ts`
  extensions, and mobile only started traversing into it now.

5b (shipped): `LearningInsightsScreen` — the same diagnostics and the same recommendation
accept/dismiss loop, reached from the today screen's header. It renders the identical pure
aggregation, so "no data is not zero" holds on both platforms by construction rather than by
two implementations agreeing.

Out of scope for all phases here (unchanged from design §19): curated concept authoring, the
official content pipeline, FSRS shadow scoring, listening/speaking, and any production
migration.

---

## 7. Security and privacy

- All learning reads rely on the owner-`SELECT` policies from mig 165; the store never uses a
  service-role key, and nothing in this workstream adds a table grant.
- The new join writers are `SECURITY DEFINER` with `auth.uid()` ownership checks and a deck
  entitlement check, matching mig 167. They are granted to `authenticated` only, and
  `REVOKE ... FROM PUBLIC, anon` is explicit.
- Deck entitlement is re-checked on every `set_learning_goal_decks` call, so a revoked share
  cannot be silently kept attached by an old client.
- Enrichment content (Phase 3) is user-specific and already RLS-scoped; the UI must not cache
  it into a shared store keyed by card id alone.
- No new PII is collected. Attempt responses (Phase 2) can contain free text the user wrote;
  they inherit the existing owner-only policy and are not sent anywhere except the evaluator.

---

## 8. Testing strategy

| Layer | What | Where |
|---|---|---|
| Pure mapper | feature derivation incl. every "missing evidence" default, ordering stability, `estimatedMinutes` budget behaviour | `packages/shared/lib/__tests__/learning-candidates.test.ts` (vitest) |
| Store logic | plan generation happens once per day per goal; a completed plan is never regenerated; each RPC errcode maps to its own state | `packages/shared/stores/__tests__/learning-store.test.ts` (vitest, mocked supabase) |
| SQL | mig 172: ownership, entitlement, clamping, duplicate rejection, replace-all atomicity, `[]` detaches, non-owner 42501/P0003 | `supabase/tests/learning_goal_links_test.sql`, registered in `ci.yml` |
| Existing | `learning_engine_test` / `learning_smoke_test` / `learning_net_zero_test` / dry-run must stay green with 172 in the chain | CI |

Every new suite is mutation-tested before it is trusted: revert the behaviour it claims to pin
and confirm it goes red.

---

## 9. Rollout

Phase 1 ships behind no flag — a new route with its own empty states is inert for users who
never open it, and the engine writes nothing until a goal exists. Production still lacks
migrations 165–172, so on prod the route would fail its first read; the phase therefore lands
on `develop` and **promotion to `main` waits for the owner-gated migration run**, which is the
same gate the engine already sits behind. Rollback is deleting the route; the RPCs and tables
are additive.
