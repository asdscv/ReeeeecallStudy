# Modular General-Purpose Learning Engine

- **Status:** Proposed for implementation
- **Date:** 2026-07-29
- **Branch:** `feat/modular-learning-engine-foundation`
- **Base:** `origin/develop` at `af38ad8`
- **Architecture standard:** [`DOCS/STANDARD/ARCHITECTURE.md`](../STANDARD/ARCHITECTURE.md)

## 1. Decision summary

ReeeeecallStudy will evolve additively from a card/SRS application into a modular learning engine with this universal loop:

```text
Goal → Concept → Activity → Attempt → Feedback → Plan
```

The engine recognizes three initial activity classes:

```text
recall | practice | produce
```

These classes are not aliases for existing `StudyMode` values. A recall activity may use an SRS card, a practice activity may be a choice or worked problem, and a production activity may be a written answer or interview response. Domain adapters decide which activities and evaluators are appropriate; the core does not hard-code language, mathematics, law, or career-learning rules.

The first implementation is additive:

1. Preserve `cards`, `user_card_progress`, `study_logs`, existing queues, official decks, marketplace acquisition, and all existing `StudyMode` behavior.
2. Add generic goals, concepts, activities, attempts, daily plans, recommendations, sources, and user-specific enrichments.
3. Introduce a framework-independent shared domain with ports, registries, deterministic planning, and evaluators.
4. Replace the current split SRS-progress/log write with an atomic `rate_card_and_log` RPC in both web and shared/mobile study stores.
5. Extend the existing structured server-side AI endpoint with verified, ownership-checked remediation requests rather than a raw-prompt proxy.
6. Ship without a new end-user UI. The new API remains a dark-launched foundation until a later UI workstream consumes it. No new `system_flags` column is needed for dormant code/data.
7. Leave explicit media and evaluator extension points for future listening and speaking, but do not implement capture, STT, pronunciation scoring, or audio exercises now.

## 2. Why this change

The existing system has mature card authoring, SRS, official decks, marketplace distribution, study history, and metered AI generation. It does not yet model goals, concepts, non-card activities, structured answer attempts, evaluator results, or personalized plans. `PersonalAnalyticsPage` currently redirects to `/history`, and its dormant calculations are deck-level heuristics rather than a personalization product.

The immediate reliability gap is more fundamental: in both `packages/shared/stores/study-store.ts` and `packages/web/src/stores/study-store.ts`, an SRS progress update and `insert_study_log` are separate fire-and-forget writes collected by `Promise.all`. Either write can succeed alone. Reliable planning and adaptation cannot be built on review history that can diverge from SRS state.

The engine therefore starts with reliable atomic recording, deterministic planning, and explicit contracts. AI augments those contracts; it does not own the plan or become a prerequisite for studying.

## 3. Goals and non-goals

### 3.1 Goals

- Represent a user's learning goal independently of a deck.
- Represent concepts independently of any particular activity or presentation.
- Support reusable activities that may optionally bridge to a legacy card.
- Record structured attempts and normalized evaluator output.
- Build a deterministic daily plan from due urgency, failure history, response time, goal relevance, and content importance.
- Support recall, practice/application, and production/expression without forcing them into flashcard semantics.
- Provide evaluator and domain-adapter registries so new domains and activity/evaluator types can be added without editing the core planner.
- Preserve all existing language/SRS flows and official deck immutability.
- Provide a concrete non-language adapter/example for Korean certified labor-attorney written-answer preparation.
- Reuse the existing AI authentication, operations gate, provider registry, reservation, actual-cost charge, and failure-release infrastructure.
- Make source provenance, algorithm versions, prompt versions, and model versions observable.
- Create explicit future seams for audio stimulus, audio response, speech recognition, and pronunciation evaluation.

### 3.2 Non-goals

- Replacing the current customized SM-2-like SRS algorithm with FSRS.
- Backfilling every existing card into a concept/activity taxonomy.
- Replacing `cards` or migrating official content to a new content system.
- Building the final goal/planner/remediation UI.
- Automatically mutating official decks or accepting AI output without preview.
- Implementing audio capture, STT, pronunciation feedback, listening, or speaking sessions.
- Adding arbitrary client-supplied prompts to the AI endpoint.
- Implementing institution/classroom features or a domain-authoring CMS.
- Deploying migrations or application code from this worktree.

## 4. Vocabulary and invariants

### 4.1 Universal vocabulary

- **Goal:** A user-owned desired outcome, optional target date, daily time budget, domain, and configurable target.
- **Concept:** A unit of knowledge or skill such as an English phrasal verb, integration by parts, unfair-dismissal requirements, or behavioral-interview structuring.
- **Activity:** A reusable learning task attached to a concept. It may reference a legacy card but does not have to.
- **Attempt:** One user response to an activity/card, including duration, hints, response payload, evaluator version, normalized score, and structured feedback.
- **Feedback:** Evaluator output. It is evidence attached to an attempt, not a mutation of canonical content.
- **Plan:** A dated, versioned, reproducible ordered set of activities/cards selected for a goal.
- **Recommendation:** A deterministic or AI-assisted proposed next action, separately accept/reject-able.
- **Enrichment:** User-specific AI content such as an explanation, comparison, hint, variant, evaluation, or recommendation.

### 4.2 Activity and transport vocabulary

Initial activity classes:

```text
recall | practice | produce
```

Extensible media/evaluation fields are strings validated by application registries, not PostgreSQL enum types:

```text
stimulus_type:  text | image | audio | video | <future>
response_type:  self_rate | choice | text | audio | <future>
evaluator_type: self_rate | exact | choice | rubric | ai | speech | <future>
```

Initial runtime support:

- stimulus: `text`, `image`
- response: `self_rate`, `choice`, `text`
- evaluator: `self_rate`, `exact`, `choice`, `rubric`, `ai`

Reserved but not implemented:

- stimulus: `audio`, `video`
- response: `audio`
- evaluator: `speech`

Unsupported registered values fail explicitly with a typed `UNSUPPORTED_CAPABILITY` result; they must not silently degrade to self-rating.

### 4.3 Invariants

1. `ActivityType` is independent from `StudyMode`.
2. Official source content is immutable through user-facing learning RPCs.
3. AI output is stored as user-specific enrichment and requires preview/acceptance before becoming a saved activity or recommendation.
4. The deterministic planner can run with AI disabled or unavailable.
5. Every persisted attempt records evaluator and algorithm versions.
6. Every generated plan records planner version and an input fingerprint.
7. A legacy SRS rating updates progress and inserts its study log in one database transaction.
8. New client writes use `SECURITY DEFINER` RPCs; clients receive no direct INSERT/UPDATE/DELETE grant on new tables.
9. New public definer functions pin `search_path = public`, authenticate with `auth.uid()`, and explicitly revoke `PUBLIC, anon` execution.
10. Domain adapters are configuration and policy; repositories, Supabase, React, and Zustand are outside the domain core.

## 5. Current-state compatibility boundary

### 5.1 Existing state retained as authoritative

- Owned-card SRS remains embedded in `cards`.
- Subscribed/official-card SRS remains in `user_card_progress`.
- Existing study history remains in `study_logs` and `study_sessions`.
- Existing queue modes remain:
  `srs`, `sequential_review`, `random`, `sequential`, `by_date`, `cramming`.
- Existing marketplace `deck_shares` entitlement and `is_subscribed_deck_active()` limits remain authoritative.
- Existing official deck manifests and content import remain unchanged.

### 5.2 Compatibility bridge

A `learning_activity` may have `card_id` set. This is an additive metadata overlay over the legacy card; it does not copy card fields or SRS state. Existing cards without a learning activity are synthesized as default recall candidates by the legacy adapter:

```text
activity_type = recall
stimulus_type = text or image (derived from template fields)
response_type = self_rate
evaluator_type = self_rate
concept = deck:<deck_id> until curated metadata exists
```

This fallback permits planning over current decks without a full backfill. Curated domain metadata can later replace the fallback one card or official content release at a time.

### 5.3 Existing store duplication

Mobile imports `@reeeeecall/shared/stores/study-store`; web has an exceptional duplicate at `packages/web/src/stores/study-store.ts`. This workstream changes the atomic rating call in both copies and adds a parity test/guard. Store unification is a separate refactor because changing the web import boundary while changing persistence semantics would multiply regression risk.

## 6. Module architecture

```text
packages/shared/
  learning/
    domain/       # value objects, entities, errors, result types
    application/  # planner, use-case services; depends only on domain + ports
    ports/        # repository, evaluator, enrichment, clock/media contracts
    registry/     # evaluator/activity/domain adapter registration
    adapters/     # legacy-card, language, labor-law examples; no Supabase
    evaluators/   # deterministic evaluator implementations
  adapters/
    supabase-learning-repository.ts  # infrastructure adapter; added after domain
```

Dependency rule:

```text
UI/store → application → domain/ports
                 ↑
infrastructure adapter implements ports
```

The core under `packages/shared/learning` must not import Supabase, Zustand, React, React Native, browser APIs, or Expo. Infrastructure may import core contracts.

### 6.1 Domain types

Core types use validated strings rather than closed database enums:

```ts
type ActivityType = 'recall' | 'practice' | 'produce' | (string & {})
type StimulusType = 'text' | 'image' | 'audio' | 'video' | (string & {})
type ResponseType = 'self_rate' | 'choice' | 'text' | 'audio' | (string & {})
type EvaluatorType = 'self_rate' | 'exact' | 'choice' | 'rubric' | 'ai' | 'speech' | (string & {})
```

Runtime registries, not TypeScript unions alone, determine support.

### 6.2 Ports

- `LearningGoalRepository`
- `LearningContentRepository`
- `LearningHistoryRepository`
- `DailyPlanRepository`
- `AnswerAttemptRepository`
- `RecommendationRepository`
- `EnrichmentRepository`
- `Evaluator`
- `RemediationProvider`
- `Clock`
- `SpeechRecognitionPort` (future, contract only)
- `AudioResponsePort` (future, contract only)

Ports return domain values and typed errors. They do not leak Supabase response shapes.

### 6.3 Registries

- `EvaluatorRegistry`: evaluator type → implementation factory.
- `ActivityRegistry`: activity type → supported stimulus/response/evaluator combinations and validation.
- `LearningDomainRegistry`: domain id → domain adapter.

Registration rejects duplicate ids. Lookup is deterministic and explicit. A domain adapter may extend core support but cannot replace another adapter's registration silently.

### 6.4 Domain adapter contract

```ts
interface LearningDomainAdapter {
  id: string
  version: string
  supportedActivityTypes: readonly string[]
  defaultPlanMix: Readonly<Record<string, number>>
  validateActivity(activity: LearningActivity): ValidationResult
  scoreGoalRelevance(context: GoalRelevanceContext): number
  contentValidators?: readonly ContentValidator[]
  promptPolicy?: PromptPolicy
}
```

The core planner owns universal mechanics; adapters supply weights, constraints, and content policy.

## 7. Data model (expand migrations 160–163)

The expand work is split so schema, atomic legacy recording, learning RPCs, and AI metering can be reviewed and tested independently:

- `160_learning_engine_schema.sql` — tables, indexes, RLS, read policies, direct-write revokes.
- `161_atomic_study_recording.sql` — `rate_card_and_log`, idempotency support, legacy RPC grant hardening.
- `162_learning_engine_rpcs.sql` — goal, plan, attempt, and enrichment-status write RPCs.
- `163_ai_remediation_metering.sql` — remediation reservation/job classification and service-only enrichment persistence.

No existing applied migration is edited. All new tables use UUID primary keys, timestamps, indexes for user/date and concept queries, RLS, and no client write policies.

### 7.1 `learning_goals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | owner, auth FK |
| `domain_id` | text | adapter id, e.g. `language`, `labor-law` |
| `title` | text | non-empty, bounded |
| `target_date` | date nullable | user-local target date |
| `daily_minutes` | integer | 1..1440 |
| `status` | text | active/paused/completed/archived, check allowed lifecycle only |
| `target` | jsonb | domain-specific target contract |
| `settings` | jsonb | planner mix/constraints |
| `created_at`, `updated_at` | timestamptz | audit |

A goal may reference zero or more decks and concepts through joins.

### 7.2 `content_sources`

Stores provenance without embedding credentials or copyrighted full documents:

- `owner_user_id` nullable (`NULL` means curated/shared)
- `domain_id`, `source_type`, `title`
- `source_uri`, `citation`, `metadata`
- timestamps

For legal/medical/high-stakes enrichment, source references are required by adapter prompt policy. Source rows are not modified by ordinary learners.

### 7.3 `learning_concepts`

- `owner_user_id` nullable for curated concepts
- `domain_id`
- `concept_key` stable within owner/domain scope
- `title`, `description`
- optional `source_id`
- `metadata`, timestamps

Partial unique indexes separate shared (`owner_user_id IS NULL`) and private concepts. Concepts do not contain mutable user mastery; mastery is derived from attempts/history.

### 7.4 `learning_activities`

- `owner_user_id` nullable for shared/curated content
- `concept_id` nullable for uncategorized imports
- `card_id` nullable bridge to existing cards
- `source_id` nullable
- `activity_type`, `stimulus_type`, `response_type`, `evaluator_type` as text
- `title`, `instructions`
- `stimulus`, `expected_response`, `rubric`, `config` JSONB
- `difficulty` numeric 0..1 nullable
- `content_version`, timestamps

At least one of `card_id` or a non-empty `stimulus` must exist. A card may have multiple activity variants. User-facing creation can only reference owned cards; service/admin import may create shared activities. Official cards are never updated by this table.

### 7.5 Goal joins

`learning_goal_decks(goal_id, deck_id, importance)` and
`learning_goal_concepts(goal_id, concept_id, importance)`.

RPCs verify goal ownership and deck entitlement. `importance` is bounded 0..1 and becomes one planner feature; it is not a mastery score.

### 7.6 `answer_attempts`

- `id`, `user_id`
- nullable `goal_id`, `activity_id`, `card_id`, `plan_item_id`
- `client_attempt_id` UUID supplied by client, unique per user for idempotency
- snapshot strings: `activity_type`, `response_type`, `evaluator_type`
- `response` JSONB
- `normalized_score` numeric 0..1 nullable
- `evaluator_result`, `feedback` JSONB
- `hints_used`, `duration_ms`
- `evaluator_version`, `created_at`

At least one of activity/card must be present. User ownership/entitlement is validated in the RPC. The stored snapshot protects analytics from future activity edits.

### 7.7 `daily_plans` and `daily_plan_items`

`daily_plans`:

- user, goal, `plan_date`
- `timezone`
- `algorithm_version`
- `input_fingerprint`
- lifecycle status
- budget and completion metrics
- unique `(user_id, goal_id, plan_date)`

`daily_plan_items`:

- plan FK, position
- optional activity/card/concept FKs
- activity snapshot and reason code
- numeric priority and estimated minutes
- status, completion attempt, payload
- unique `(plan_id, position)`

Items are normalized rather than stored as a mutable JSON array. This enables safe per-item completion, FK validation, analytics, and concurrency control.

### 7.8 `study_recommendations`

Stores deterministic or AI recommendations separately from canonical content:

- user/goal/concept/card/activity references
- action type (`review`, `explain`, `compare`, `practice`, `produce`, etc.)
- provider (`planner`, `ai`), reason, payload
- algorithm/model/prompt version
- status (`pending`, `accepted`, `dismissed`, `expired`)
- timestamps/expiry

### 7.9 `user_enrichments`

Stores user-specific AI results:

- user and optional goal/concept/card/activity references
- action (`explain`, `compare`, `hint`, `generate`, `evaluate`, `recommend`)
- request fingerprint for idempotency/deduplication
- structured `content`
- source references, model/provider/prompt version
- status (`preview`, `accepted`, `rejected`, `deleted`)
- created/accepted timestamps

No RPC writes enrichment into `cards`, official manifests, or shared activities automatically.

### 7.10 RLS and grants

- All tables: RLS enabled.
- Owner-scoped SELECT policies may expose only the caller's goals/plans/attempts/recommendations/enrichments.
- Shared concepts/activities/sources are readable only through explicit safe SELECT policies or read RPCs.
- Direct INSERT/UPDATE/DELETE is revoked from `anon` and `authenticated` for new tables.
- All writes occur through definer RPCs.
- Service role retains maintenance/import capability.

## 8. Database RPC contracts

### 8.1 Atomic legacy rating: `rate_card_and_log`

Purpose: atomically persist an SRS state transition and its study log.

Inputs include:

- card/deck id, study mode, rating
- previous SRS snapshot (`status`, interval, ease, repetitions)
- new SRS snapshot for SRS mode
- duration and optional `client_rating_id` for idempotency

Transaction:

1. Require authenticated caller and validate mode/rating against current study-log constraints.
2. Lock card row.
3. Verify card belongs to deck.
4. Verify either caller owns the deck/card, or caller has an active `subscribe` share and `is_subscribed_deck_active(deck_id)` is true.
5. Choose progress source by deck/card ownership, matching `getSrsSource`: owned updates `cards`; non-owned upserts caller's `user_card_progress`.
6. Lock/read current authoritative progress and compare the supplied previous snapshot. Reject stale transitions with a conflict code rather than overwriting newer progress.
7. Validate new SRS bounds/status and update progress only for SRS mode.
8. Insert `study_logs` using the authoritative previous state and supplied new state.
9. Return the stored state/log id/source.
10. Commit together or roll back together.

For non-SRS modes, no SRS state changes; the log insert remains atomic by itself. Duplicate `client_rating_id` returns the prior result without a second log.

The old `insert_study_log` function remains temporarily for compatibility but receives explicit revoke/grant hardening. Once both supported clients use `rate_card_and_log`, later contract cleanup can remove it in a separate migration.

### 8.2 Goal RPCs

- `create_learning_goal(...)`
- `update_learning_goal(...)`
- `archive_learning_goal(p_goal_id)`

All derive user from `auth.uid()`. Deck/concept joins are validated transactionally.

### 8.3 Plan RPC

`save_daily_plan(p_goal_id, p_plan_date, p_timezone, p_algorithm_version, p_input_fingerprint, p_budget_minutes, p_items jsonb)`:

- verifies goal ownership
- validates bounded item count and JSON schema
- verifies every referenced card/activity/concept is accessible
- upserts the dated plan under a row lock
- replaces pending items atomically but refuses to overwrite a completed plan
- returns the saved normalized plan

`complete_daily_plan_item(...)` links a recorded attempt and updates completion aggregates in one transaction.

### 8.4 Attempt RPC

`record_answer_attempt(...)`:

- verifies goal and plan ownership
- verifies activity/card access
- validates score/duration/hints bounds and payload size
- enforces idempotent `client_attempt_id`
- inserts attempt and optionally completes the plan item atomically
- never trusts a client-supplied `user_id`

Evaluation occurs in the application before the RPC for deterministic evaluators; AI evaluation is produced server-side and persisted with model/prompt provenance.

### 8.5 Enrichment RPCs

- internal/service `create_user_enrichment(...)` called by the edge function
- authenticated `set_user_enrichment_status(p_id, accepted|rejected|deleted)`

The service function requires `service_role`; the user function verifies ownership. Acceptance does not mutate official/shared content.

### 8.6 Function security checklist

Every new function:

```sql
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
```

and:

```sql
REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ... TO authenticated;
```

Internal/service functions additionally revoke `authenticated` and grant only `service_role`. SQL tests check `has_function_privilege('anon', ..., 'EXECUTE') = false` for each non-public function.

## 9. Deterministic daily planner

### 9.1 Inputs

```ts
interface PlannerInput {
  goal: LearningGoal
  candidates: readonly PlannerCandidate[]
  budgetMinutes: number
  activityMix?: Record<string, number>
  now: string
  timezone: string
  algorithmVersion: string
}
```

A candidate contains due time, recent attempt outcomes, response-time baseline, goal importance, content importance, difficulty, estimated duration, and supported activity class. The planner receives normalized candidates from repositories/adapters; it does not query Supabase.

### 9.2 Priority

Initial version `daily-plan-v1`:

```text
priority =
  0.35 * dueUrgency
+ 0.25 * recentFailure
+ 0.10 * responseTimePenalty
+ 0.20 * goalRelevance
+ 0.10 * contentImportance
```

Each feature is normalized to `[0, 1]`. Missing evidence uses explicit neutral/default values, not `NaN` or implicit zero. Adapter-configured weights are validated to non-negative values and normalized before use.

### 9.3 Selection

1. Validate and normalize mix weights.
2. Deduplicate candidates by activity/card identity.
3. Sort stably by priority descending, due date ascending, stable id ascending.
4. Allocate budget across activity classes with adapter/goal mix.
5. Fill each class budget without exceeding total minutes, allowing one smallest item when a non-zero class would otherwise be empty.
6. Reallocate unused class budget across remaining highest-priority candidates.
7. Return ordered items plus transparent reason codes and a deterministic input fingerprint.

Default mix:

```text
recall 0.60, practice 0.25, produce 0.15
```

This is a default, not a global invariant. A labor-law goal near an essay exam may prefer production; a new vocabulary goal may prefer recall.

### 9.4 Determinism and timezone

The caller supplies an ISO timestamp and IANA timezone. The planner uses the supplied clock only; tests use a fake clock. Identical normalized inputs, algorithm version, and timezone produce identical output and fingerprint.

### 9.5 Planner safety

- Zero/negative budgets are rejected.
- Oversized candidate lists are bounded at the repository/application boundary.
- Unsupported activity types are excluded with a diagnostic, not coerced.
- Empty candidates return an empty successful plan with reason `no_candidates`.
- AI is not called during planning.

## 10. Evaluators and attempts

### 10.1 Common contract

```ts
interface Evaluator {
  readonly type: string
  readonly version: string
  evaluate(input: EvaluationInput): Promise<EvaluationResult> | EvaluationResult
}

interface EvaluationResult {
  normalizedScore: number | null
  outcome: 'correct' | 'partial' | 'incorrect' | 'unscored'
  feedback: StructuredFeedback
  rubricResult?: RubricResult
  evaluatorType: string
  evaluatorVersion: string
}
```

### 10.2 Initial evaluators

- **Self-rate:** maps known rating values through adapter configuration; remains appropriate for current card reveal flows.
- **Exact:** Unicode-normalized, trim/case options, accepted-answer list; no hidden locale assumptions.
- **Choice:** verifies selected choice ids against configured correct ids, supporting single and multiple choice.
- **Rubric:** deterministic weighted criteria. Each criterion has id, weight, max score, optional required evidence. It returns per-criterion detail and normalized total.
- **AI:** an adapter over `RemediationProvider.evaluate`; core only knows the port. Result schema is validated before persistence.

### 10.3 Rubric limits

- Weights must be finite and positive.
- Scores are clamped/rejected according to strict configuration; default is reject invalid evaluator output.
- Empty rubrics are invalid.
- AI may propose criterion scores, but source-grounded/high-stakes adapters can require user review and mark the result advisory.

## 11. AI remediation and enrichment

### 11.1 Universal actions

```text
explain | compare | hint | generate | evaluate | recommend
```

### 11.2 Client request

The existing `ai-generate` endpoint gains a structured `kind: 'remediation'` request:

```ts
{
  kind: 'remediation',
  action: 'explain' | 'compare' | 'hint' | 'generate' | 'evaluate' | 'recommend',
  goalId?: string,
  activityId?: string,
  cardIds?: string[],
  conceptIds?: string[],
  attemptId?: string,
  count?: number,
  uiLang: string
}
```

Clients do not send raw study logs, canonical source passages, arbitrary system instructions, or a raw prompt.

### 11.3 Server flow

1. Verify Supabase JWT.
2. Apply existing CORS allowlist, operations gate, ban check, and rate limit.
3. Validate ids, action, count, language, and payload bounds.
4. Fetch referenced goal/activity/cards/concepts/attempt using the authenticated user's ownership/entitlement.
5. Reject locked subscribed decks.
6. Fetch trusted source references when adapter policy requires grounding.
7. Build a server-side prompt using the registered action/domain prompt policy.
8. Reserve through existing text-generation metering.
9. Generate structured JSON via configured provider/model.
10. Validate action-specific result schema and source requirements.
11. On empty/invalid/provider failure, release the reservation.
12. On success, charge actual token cost using the existing idempotent job reference.
13. Persist a `preview` `user_enrichment` using a service-only RPC with model/provider/prompt version and source refs.
14. Return the enrichment id/content for review.

The endpoint must not expose other users' attempts or official/private data through prompt construction.

### 11.4 Structured results

All actions return an envelope:

```ts
{
  action: string,
  summary: string,
  blocks: Array<{ type: string; content: unknown }>,
  citations: Array<{ sourceId: string; locator?: string }>,
  confidence?: number,
  warnings?: string[]
}
```

Action-specific validators enforce allowed block shapes. High-stakes adapters add an educational-use warning and reject ungrounded factual claims when sources are mandatory.

### 11.5 Measurement

Record:

- requested action and target ids
- accepted/rejected/deleted status
- user edit where later supported
- prompt/provider/model version
- token cost through existing ledger
- next comparable attempt/review change (derived later)

The paid value is remediation quality and learning improvement, not simply generated card count.

## 12. Domain examples

### 12.1 Existing language compatibility adapter

Adapter id: `language`; initial version `language-v1`.

- Existing card → recall/self-rate fallback.
- Optional practice: choice/cloze/sentence transformation.
- Optional produce: free-text translation, sentence generation, short response.
- Default mix biased toward recall for new vocabulary.
- Language adapter validates locale/language tags but does not assume every deck is language content.
- Existing official decks remain free and immutable; user-specific explanations/examples are enrichments.

### 12.2 Certified labor-attorney adapter (non-language example)

Adapter id: `labor-law`; initial version `labor-law-v1`.

Concept examples:

- statutory elements
- precedent holding and rationale
- requirement/effect relationships
- compare/distinguish doctrine
- issue spotting
- written answer structure

Activities:

- recall: statute requirements, precedent holdings
- practice: fill-in statute, classify issue, compare two doctrines, case variant
- produce: issue outline, IRAC-style paragraph, timed answer skeleton

Rubric example for a production answer:

```text
issue identification      0.20
rule/statutory basis      0.25
application to facts      0.30
counterargument           0.10
conclusion and structure  0.15
```

Prompt policy requires references to verified source records for statute/precedent facts and includes an educational-content warning. AI feedback is advisory and stored per user; it never edits the official source activity.

This adapter is a real executable configuration/example with validation tests, not a second hard-coded planner.

## 13. Future listening and speaking seams

No audio feature is implemented, but the architecture reserves:

```ts
interface SpeechRecognitionPort {
  transcribe(input: AudioResponse, options: SpeechRecognitionOptions): Promise<TranscriptResult>
}

interface PronunciationEvaluator extends Evaluator {
  evaluatePronunciation(input: PronunciationInput): Promise<PronunciationResult>
}
```

A future audio activity will use:

- `stimulus_type = audio`
- `response_type = audio`
- `evaluator_type = speech`
- storage object reference in response payload, not raw audio in attempt JSON
- explicit consent, retention, deletion, provider, language, and confidence metadata

The existing shared `ITTSAdapter`/`IAudioAdapter` remain playback seams. Recording/STT are separate because playback and biometric-like voice processing have different permissions, privacy, and provider semantics.

## 14. Security and privacy

### 14.1 Authorization

- No caller-supplied user id on user-facing new RPCs.
- Goals, plans, attempts, recommendations, and enrichments are owner-only.
- Activity/card access checks reuse owner or active subscribe-share semantics and enforce `is_subscribed_deck_active`.
- Shared/official content can be read but not changed by learners.
- Service-only enrichment/source import functions explicitly reject authenticated users.

### 14.2 Input safety

- Bound text, array, JSON payload, rubric, candidate, and AI count sizes.
- Validate finite numeric values and score ranges.
- Validate supported registry ids in TypeScript and allowed initial values at RPC boundaries without closed DB enums that block future extension.
- Treat source text and model output as untrusted data.
- AI prompts delimit source/content data and never execute instructions embedded in source text.

### 14.3 Privacy

- Do not send full private study history when only aggregates/recent attempts are needed.
- Edge function fetches the minimum referenced records server-side.
- Do not log responses, source bodies, tokens, or personally identifying content.
- Store request fingerprints, ids, versions, and cost metadata for diagnostics.
- Future audio requires a separate privacy review and retention contract.

## 15. Observability

Structured diagnostics include:

- atomic rating success/conflict/error by SRS source (no response text)
- planner algorithm version, candidate count, selected mix, budget, reason-code counts
- evaluator type/version and aggregate outcome
- plan completion and skip rates
- enrichment action/status, validation failures, provider/model/prompt version
- existing AI cost ledger for actual token cost

No new external telemetry provider is required. Logging must redact response and source content. Database rows support later aggregate admin RPCs; this workstream does not add dashboards.

## 16. Rollout, migration, and rollback

### 16.1 Expand-first rollout

1. Add migration 160 tables/RPCs and security tests. No existing table is removed.
2. Add shared core and tests; no UI calls it yet.
3. Move both study stores to `rate_card_and_log`. Keep the old RPC temporarily.
4. Add planner/evaluators/adapters and repository adapter.
5. Add remediation endpoint kind behind explicit request use; no UI exposes it.
6. Validate web/mobile/shared and SQL tests.
7. A later UI release can expose goals/plans under its own product flag if required.

### 16.2 Failure isolation

- If planner/remediation code fails, existing study setup and queues still work.
- If remediation provider is unavailable, deterministic planning/evaluation still work.
- If atomic rating returns a conflict/error, the client must report/log it and invalidate/refetch progress; it must not silently issue the old split writes.
- Official content is unaffected because all enrichment is separate.

### 16.3 Rollback

Rollback artifacts under `supabase/rollbacks/160_*.down.sql` through `163_*.down.sql` may drop only newly introduced functions/tables after first disabling consumers. The atomic-recording rollback must restore/harden the prior `insert_study_log` grant if `rate_card_and_log` is removed. Rollbacks do not revert unrelated existing data tables or older applied migrations.

Once real goal/attempt data exists, production rollback should disable consumers and retain tables rather than destructively drop user data. Destructive production rollback requires an explicit backup and operator decision.

### 16.4 Kill strategy

No `system_flags.learning_engine_enabled` column is added in this foundation because there is no user-facing route/store invoking the new engine by default. Existing `ai_generation_enabled` already kills remediation because it shares the AI operations gate. A later UI workstream may add a product exposure flag if needed.

## 17. Testing strategy

### 17.1 Shared unit tests

- type/runtime validation for all core values
- registry duplicate/unknown handling
- exact, choice, self-rate, rubric, and AI-port evaluators
- planner determinism, weighting, mix allocation, budget edges, deduplication, unsupported capabilities
- language legacy-card mapping
- labor-law activity and rubric validation
- future audio capability fails explicitly without an adapter

### 17.2 Store compatibility tests

- web/shared study stores call `rate_card_and_log` once per rating
- no direct card/progress update or `insert_study_log` call remains in `rateCard`
- error/conflict handling invalidates/refetches rather than silently succeeding
- existing sequential/cramming/session behavior remains green
- parity guard prevents the dual stores from drifting in atomic payload semantics

### 17.3 SQL tests

Transaction + `ASSERT` + `ROLLBACK` tests cover:

- anon cannot execute write RPCs
- user cannot read/write another user's goal/plan/attempt/enrichment
- owner vs subscribed progress source
- inactive/locked/mismatched deck rejection
- stale SRS transition rollback (no progress or log change)
- injected failure rollback (no progress-only/log-only state)
- duplicate client rating/attempt idempotency
- plan ownership/item validation and completed-plan protection
- service-only enrichment persistence
- direct write grants absent

### 17.4 AI tests

- remediation request validator bounds/action ids
- ownership/entitlement fetching
- raw prompt fields ignored/rejected
- action-specific output validator
- reserve → charge on valid success
- release on provider, empty, or validation failure
- source-required labor-law requests reject missing grounding
- prompt parity/snapshot guard where appropriate

### 17.5 Validation commands

Use the repository's installed toolchain and report unavailable infrastructure explicitly:

```text
pnpm --filter @reeeeecall/web test -- <target suites>
pnpm --filter @reeeeecall/web build
pnpm exec tsc -p packages/shared/tsconfig.json --noEmit
pnpm exec tsc -p packages/mobile/tsconfig.json --noEmit
# SQL tests against local Supabase/Postgres when available
```

Run existing i18n parity even if no strings are added, and run the architecture guard if present.

## 18. Implementation phases and acceptance criteria

### Phase A — Domain and schema foundation

Deliver:

- core domain types/errors/validators
- repository/media/enrichment ports
- registries
- migration 160 and rollback artifact
- database type additions

Accept when:

- core imports no framework/infrastructure package
- migration is expand-only and SQL security assertions pass
- existing card/SRS schema is unchanged

### Phase B — Reliable recording and planning

Deliver:

- atomic rating RPC and both-store integration
- deterministic planner
- goal/plan/attempt repository adapter and write RPCs

Accept when:

- progress/log cannot diverge under tested failure/conflict cases
- identical planner inputs produce identical output
- planner works on legacy cards without metadata backfill

### Phase C — Activities and evaluators

Deliver:

- activity registry
- self-rate, exact, choice, rubric, AI-port evaluators
- structured attempt recording

Accept when:

- recall/practice/produce all have valid examples
- non-card text production attempt is supported
- unsupported audio/speech fails explicitly

### Phase D — AI remediation

Deliver:

- remediation port/client types
- edge request/data fetch/prompt/output validator
- existing metering lifecycle integration
- user enrichment preview persistence

Accept when:

- no raw prompt proxy exists
- ownership and source grounding tests pass
- invalid/empty/failed generation releases reservation
- official content remains untouched

### Phase E — Compatibility and domain examples

Deliver:

- language legacy adapter
- labor-law adapter/config/examples
- compatibility/parity tests

Accept when:

- existing SRS tests and web/mobile type checks pass
- a language card and a labor-law written response run through the same core contracts
- no language/law special case is added to the planner core

### Phase F — Zero-defect audit

1. **Deep Dive:** implementation vs this design, domain logic and root causes.
2. **Double-Check:** concurrency, idempotency, compatibility, side effects, cost accounting.
3. **Lockdown:** RLS/grants/IDOR, payload bounds, error paths, unsupported capabilities.

Accept when all discovered blockers are fixed or explicitly reported with failing evidence. Do not move this document to `DOCS/DONE` until merge; this session will not commit or merge unless requested.

## 19. Deferred work

- Product/UI flow for goal creation, diagnostics, daily plan, attempt review, and enrichment acceptance.
- Curated concept/activity authoring and official content metadata pipeline.
- Data backfill and analytics dashboards.
- FSRS shadow scoring after reliable review history is sufficient.
- Listening and speaking implementation/privacy review.
- Shared/web study-store unification.
- Contract cleanup of legacy direct-write policies and `insert_study_log` after supported clients migrate.
- External labor-law source acquisition, legal citation review, and official content QA.

## 20. Final architecture decisions

| Decision | Rationale |
|---|---|
| Additive learning tables, existing cards retained | Preserves proven SRS/marketplace behavior and supports gradual metadata adoption |
| Standalone activity with optional card bridge | Supports non-card practice/production without abandoning legacy content |
| Activity class independent of StudyMode | Avoids semantic coupling such as incorrectly equating production with cramming |
| Normalized plan items | Safe completion, FK validation, concurrency, and analytics |
| Derived mastery, not mutable concept score | Prevents stale aggregate truth and permits algorithm evolution |
| Pure deterministic planner | Testable, explainable, available without AI |
| Runtime string registries | Extensible without locking DB enums too early |
| Atomic SRS rating/log RPC | Reliable evidence is prerequisite to personalization |
| Structured remediation request with server fetch | Prevents raw-prompt proxy abuse and cross-user data leakage |
| User-specific enrichment | Protects official/shared content and supports preview/acceptance metrics |
| No new product flag in dormant foundation | Avoids expanding the five-argument system flag RPC for code no UI invokes |
| Audio contracts only | Preserves future seam without premature permissions/provider/privacy complexity |

## 21. Pre-implementation review resolutions

An independent design review found no critical issue and approved requirement coverage, with three high-priority ambiguities and several medium/low details. The following decisions are normative and supersede any less-specific wording above.

### 21.1 Atomic conflict and persistence UX

`rateCard` will not advance the in-memory queue before `rate_card_and_log` succeeds. The client may retain the current 120ms press animation, but it awaits the RPC while `isRating=true`.

- Success: apply the precomputed local SRS result and advance normally.
- PostgreSQL serialization/stale-state conflict: invalidate card/progress caches, refetch/reinitialize the current session from authoritative state, keep the user on an active session, and expose a typed retryable persistence error. Do not write through the legacy split path.
- Network/other persistence error: leave the current card unadvanced, reset `isRating=false`, expose a retryable error, and allow the same rating to be retried with the same `client_rating_id`.
- Duplicate response after a lost acknowledgement: the RPC returns the idempotently stored result and the client advances once.

Both stores add identical tests for success, stale conflict/refetch, transport failure/no-advance, and duplicate idempotent success.

### 21.2 Operational hard caps (not product entitlements)

This dark-launched foundation does not define paid/free product entitlements. It does enforce RPC-level anti-abuse bounds, independently of future subscription packaging:

- at most 100 non-archived goals per user;
- at most 500 items per plan;
- at most 50 plan saves/regenerations per UTC day;
- at most 5,000 structured answer attempts per UTC day;
- bounded JSON/text payload sizes (64 KiB per response/result payload, lower action-specific limits where possible);
- bounded referenced ids and AI-generated item count.

These are safety ceilings, not marketed limits. Future tier entitlements must be configuration-backed and introduced in an expand migration rather than scattering literals through clients.

### 21.3 Remediation metering policy

Remediation is a paid AI capability from the first implementation and does **not** consume or inflate the existing “free generated cards per day” count.

Migration 163 adds explicit remediation job classification/billable-fraction metadata to the existing AI job ledger and a new authenticated `reserve_ai_remediation(p_action)` RPC. The RPC:

1. validates the universal action;
2. uses the existing per-day request abuse counter;
3. requires a positive wallet balance before provider work;
4. creates a job with kind `remediation` and billable fraction `1.0`;
5. returns the same idempotent job reference consumed by `charge_ai_generation` and `release_ai_job`.

`charge_ai_generation` is redefined to use the explicit billable fraction when present and to preserve the legacy free/paid-card calculation for old jobs. Existing template/deck/card/image accounting remains unchanged. `release_ai_job` remains idempotent and marks the failed remediation job released without wallet movement. The AI cost ledger therefore records remediation actual token cost and price without pretending an explanation is a generated card or image.

### 21.4 Candidate identity and legacy fallback

Candidate identity is `(activity_id)` for persisted activities and `legacy:<card_id>:recall` for synthesized fallback recall. If a persisted `recall` activity references a card, its synthesized fallback is suppressed. Distinct `practice` and `produce` activities referencing the same card may coexist, while duplicate `(card_id, activity_type, equivalent config fingerprint)` candidates collapse to the highest-priority candidate. Plan selection may also apply adapter-configured per-concept caps to prevent one card/concept from consuming the day.

### 21.5 Plan ownership invariant

Every `daily_plan` belongs to exactly one non-null learning goal. Goal-less study remains supported by existing study modes and ad-hoc `answer_attempts`, but a personalized daily plan requires a goal. This makes `(user_id, goal_id, plan_date)` a meaningful unique key.

### 21.6 Deletion and FK policy

User-owned goals, private concepts/activities/sources, plans, attempts, recommendations, and enrichments reference `auth.users` with `ON DELETE CASCADE`. Shared curated rows have `owner_user_id IS NULL` and survive user deletion. Optional source/content references use `ON DELETE SET NULL` where deleting a source must not destroy user attempt history; join/plan child rows cascade with their owned parent. Production deletion/export behavior remains subject to the existing account privacy workflow.

### 21.7 Schema and type details

- `duration_ms >= 0`, `hints_used >= 0`, and normalized scores/importance/difficulty in `[0,1]` receive DB constraints plus RPC validation.
- Future media ports include compilable stub value types (`AudioResponseRef`, recognition options/result, pronunciation input/result). They perform no device or network work.
- `packages/shared/tsconfig.json` includes `learning/**/*` so core code is covered by shared type checking.
- Each migration has a matching focused SQL test block and rollback artifact; no single 800+ line foundation migration is used.

### 21.8 Empty-plan persistence boundary

The deterministic planner may successfully return an empty plan when no supported, eligible work exists. That result means “no work today” and is consumed directly by the application; it is not persisted. `save_daily_plan` intentionally requires at least one item, so persisted plans always have a meaningful aggregate/status lifecycle. A future product requirement to retain no-work days should use a separate explicit completion/observation record rather than weakening the plan-item invariant.
