# Attempt-Grounded `compare` / `evaluate` — Synthesized Verdict and Staged Plan

> **Status:** research + verdict only. **Stage 0 is DONE** (shipped with this doc); Stages 1-4
> are NOT started. Companion to [attempt-grounded-remediation](./2026-07-31-attempt-grounded-remediation-design.md).
>
> Every claim here was verified by reading the file at `origin/develop` (`cc43d9f`); line numbers
> are that revision's. Nothing below was taken on trust from a summary.

---

## 1. Is `compare` honestly shippable?

**Yes — but not today, not by widening a type, and only for a subset that the app can name from data it already has.** The honest version is roughly three small PRs, not one.

### 1a. What is already true (verified, no work needed)

| Claim | Evidence |
|---|---|
| Server accepts all six actions | `supabase/functions/_shared/ai-remediation.ts:1` (`REMEDIATION_ACTIONS`), validated at `:42`; `supabase/migrations/168_ai_remediation_metering.sql:43` (`reserve_ai_remediation`); `supabase/migrations/178_enrichment_attempt_provenance.sql:62` (`persist_ai_remediation`) |
| A typed answer needs **no migration** to store | `answer_attempts.response jsonb NOT NULL DEFAULT '{}'` (`165_learning_engine_schema.sql:219`); `response_type text NOT NULL CHECK (<> '')` (`:217`) — no enum; `record_answer_attempt(p_response jsonb DEFAULT '{}')` (`167_learning_engine_rpcs.sql:648`) with only a 64 KiB cap (`:705-707`) |
| CI already writes exactly that shape | `supabase/tests/learning_engine_test.sql:325-331` — `record_answer_attempt(..., 'produce', 'text', 'exact', '{"answer":"A"}'::jsonb, ...)` against a plan item snapshotted `'text'/'exact'` (`:284-293`), and asserts insert + idempotency |
| The edge function already forwards the learner's response | `ai-generate/index.ts:424` selects `response, response_type, evaluator_type, evaluator_result, feedback`; placed in context at `:474` |
| `response` is **not** part of the plan-item snapshot check | `167:810-817` compares goal/activity/card/`activity_type`/`response_type`/`evaluator_type` only. `p_response` appears only in the *idempotency* comparison (`:740`) |
| Plan items already carry a free-form `payload` | `165:299` `payload jsonb`; `save_daily_plan` writes it (`167:612, 627`, `COALESCE(NULLIF(v_item->'payload','null'::jsonb),'{}')`). **The store sends none today** (`learning-store.ts:746-757`) — this column is unused and free |

**The only thing gating `compare` is client-side**: `packages/shared/stores/learning-store.ts:239` (`export type RemediationAction = 'explain' | 'hint'`) plus two hard-coded arrays (`LearningTodayPage.tsx:45-48`, `LearningTodayScreen.tsx:69-72`). A hand-rolled `action:'compare'` request from any authenticated client succeeds, reserves, charges, and returns a fabricated comparison **right now**. §11.5 of the design doc describes a property that is enforced nowhere on the server.

### 1b. The two things that genuinely do not exist

**(i) Nowhere to type.** I re-grepped rather than trusting the investigators. `packages/web/src/lib/study-input-settings.ts` looked like a hit for "answer input mode" — it is not: it is button-vs-swipe (`:8` `export type AnswerInputMode = 'button' | 'swipe'`). No `<textarea>`/`<input>` in `packages/web/src/pages/learning/*` outside `GoalFormModal`, no `TextInput` in `packages/mobile/src/screens/Learning*.tsx` outside `LearningGoalsScreen`. Both platforms are three self-rating buttons: `LearningTodayPage.tsx:51-55, 121-138`; `LearningTodayScreen.tsx:39-43, 411-442`.

**(ii) A reference answer.** Three candidate sources; only one is honest.

**❌ `activitiesForLegacyCard`'s `expectedResponse` — must never be used.**
`packages/shared/learning/adapters/domain-adapters.ts:16-20, 27-28, 42`:

```ts
16  function pickFields(values, keys, fallbackIndex) {
17    const available = Object.keys(values)
18    const selected = keys?.length ? keys : available[fallbackIndex] ? [available[fallbackIndex]] : available.slice(0, 1)
...
27    const front = pickFields(input.card.field_values, input.frontFieldKeys, 0)
28    const back  = pickFields(input.card.field_values, input.backFieldKeys, 1)
...
42    expectedResponse: { fields: Object.keys(back).length ? back : front },
```

Both production callers pass no field keys (`packages/shared/lib/learning-candidates.ts:159` and `:199`), so the index fallback always fires. jsonb returns keys shortest-then-bytewise — documented in-repo at `packages/shared/lib/card-prompt.ts:6-11` ("*A card written as `{ front, back }` comes back as `{ back, front }`, so 'first value' is the ANSWER*"). Official word templates use exactly `front, back, example_front, example_back` (`089_official_template_orientation_tts.sql:33-38`), which orders `back`(4) → `front`(5). **So for every official word card this function takes the answer as the stimulus and the prompt as the expected answer.** And line 42 silently makes the expected answer *equal the question* on a one-field card. *(I could not execute Postgres here to confirm the key ordering — the repo asserts it, and `card-prompt.ts` exists solely because of it.)*

This is currently harmless only because nothing reads `expectedResponse`: `legacyCardItemShape` (`learning-candidates.ts:158-166`) pulls the four type strings and discards the rest.

**⚠️ `learning_activities.expected_response` — the designed carrier, and unbuilt.**
Column exists (`165:137`). Writer exists, validates ownership, and is granted to `authenticated` (`167:313-327` params, `:396-406` insert, `:415-417` grant). **Zero TypeScript callers** — `git grep create_private_activity origin/develop -- 'packages/**'` returns nothing; the only hits repo-wide are migration 167, its rollback, and three SQL test files. Consequently `activity_id` is `null` on every real attempt (`learning-candidates.ts:212`: *"legacy cards plan by card_id; no activity row is created"*).

**A hard limit neither investigation flagged:** `create_private_activity` requires `cards.user_id = auth.uid()` (`167:368-374`). It **cannot attach an activity to a subscribed or official card.** So this path can never cover official decks, which is most of what the app ships.

**✅ `card_templates.back_layout` — a declaration by the template author, not a guess.**
This is the piece both investigations dismissed too fast.

- `card_templates.back_layout JSONB NOT NULL DEFAULT '[]'` (`001_initial_schema.sql:53`); `cards.template_id UUID NOT NULL` (`001:138`).
- Seeded templates declare it correctly: `'기본 (앞/뒤)'` → `back_layout = [{field_key:'field_2',style:'primary'}]` (`001:75`); `'중국어 단어'` → `[field_2 primary, field_3 hint, field_4 detail, field_5 media]` (`001:86`) where `field_2` = 뜻 = the answer.
- **Official templates declare it correctly in both directions**: forward word template `1111` → `back_layout = [{back, primary}, {example_back, detail}]` (`089:43-46`); reverse template `3333` → same shape (`089:85-88`). The exact case where the index heuristic is inverted, `back_layout` gets right.
- It is already the app's own answer-face renderer: `resolveCardFaceContent` filters `back_layout` to items with non-empty values (`packages/shared/lib/card-face-resolver.ts:61-69`), consumed by `StudyCard.tsx:6`.

So the reference answer is not a guess **when the template declares it**. It is a guess when it does not — and the whole design of this feature is that absence must disable it, not trigger a fallback.

### 1c. The subset, defined exactly

**An item is compare-eligible iff, at plan-generation time, its card's template resolves both faces unambiguously:**

1. the template row is readable and `front_layout` yields ≥1 key present and non-empty in `card.field_values` → the **prompt keys**;
2. `back_layout` yields ≥1 such key → the **reference keys**;
3. the reference key(s) have `fields[].type === 'text'` (excludes the audio field the 중국어 template puts in `back_layout`, `001:86`);
4. prompt keys and reference keys are **disjoint**;
5. …and at answer time, the learner actually typed non-empty text.

Anything else — empty `back_layout` (the column default), keys that don't match the card's `field_values` (pinned by `packages/web/src/lib/__tests__/card-face-resolver.test.ts:117-128`), overlapping faces, image/audio answers — is **out**.

**One more exclusion nobody flagged:** a subscriber can read a shared template **only when it is the deck's `default_template_id`** (`009_sharing_marketplace.sql:122-131`). A card on a subscribed deck using a non-default template is invisible to the client and falls out of the subset. That is fail-closed and correct; it just means the subset is smaller than "all cards with templates."

**How the UI knows** — from data it already has:

- **Plan row:** `item.response_type === 'text'`. Already selected (`learning-store.ts:595`), already on `DailyPlanItemRow` (`:73-74`), and **ignored by both screens** (the only grep hit for `response_type` in either screen is a comment, `LearningTodayPage.tsx:50`). Web must thread it into `PlanItemRow`, whose props (`LearningTodayPage.tsx:57-71`) do not include it and whose call site (`:443-486`) passes no `item`; mobile already has `item` in scope (`:365`).
- **Attempt-history row:** `AttemptRow` (`learning-store.ts:165-177`) and the `fetchAttempts` select (`:839`) carry neither `response` nor `response_type`. Both must be added. The gate becomes `attemptNeedsRemediation(attempt) && attempt.card_id && attempt.response_type === 'text' && (attempt.response?.text ?? '').trim() !== ''`.

**What the UI does for items outside the subset: exactly what it does today.** Three rating buttons, `explain` + `hint` only. No new copy, no greyed-out `compare`, no "unavailable for this card" message — advertising a capability the learner cannot reach on their own decks is its own small dishonesty.

---

## 2. Is `evaluate` honestly shippable?

**No. Not yet — and it should not ride along with `compare`.** Four independent blockers, each verified:

**(a) There is no grader.** `createDefaultEvaluatorRegistry()` registers `self_rate / exact / choice / rubric` (`packages/shared/learning/evaluators/evaluators.ts:119-125`). `AiEvaluatorAdapter` (`:98-117`) is fully implemented but **not registered, called nowhere, and tested nowhere** — repo-wide grep finds it only at its own definition. Its constructor needs a `RemediationProvider` (`:101-103`), a port with **zero implementations** (`ports/remediation-provider.ts:83-95`; grep finds it only at its definition and in `evaluators.ts`).

**(b) There is no rubric to grade against.** `learning_activities.rubric` exists (`165:138`) and `create_private_activity` accepts it (`167:325`) — and nothing writes it (§1b(ii)). Worse, `DeterministicRubricEvaluator` **does not read text**: it aggregates a caller-supplied `input.response.scores` object of per-criterion numbers (`evaluators.ts:79-89`). It is a weighting function, not a grader. And a card is field values, not criteria — there is no rubric source for card-based items even in principle.

**(c) The server has no result contract for it.** `validateRemediationResult` mentions the action exactly once, as an echo check: `if (value.action !== refs.action || …)` (`ai-remediation.ts:113`). Everything after (`:114-131`) is action-agnostic. It requires no `evaluation` block and no `normalizedScore` — while `AiEvaluatorAdapter` demands `blocks.find(b => b.type === 'evaluation').content.normalizedScore ∈ [0,1]` (`:110-113`). **So an `evaluate` request today validates, persists, and charges while returning prose with no grade in it** — the textbook case of "charging for something that silently degrades to a generic explanation."

**(d) A model-produced score would move tomorrow's study plan.** `answer_attempts.normalized_score` → `summarizeLearning` (`packages/shared/lib/learning-insights.ts:79, 95, 107-111`) → `weakCards` → `set_study_recommendations` (`learning-store.ts:1064`) → an accepted row → `acceptedCardIds` (`learning-store.ts:708-717`) → `buildCandidatesFromCards`. That is a product decision about who controls the curriculum, not a prompt change.

**The honest sentence for the PR: "`evaluate` needs curated rubrics that do not exist, and an AI evaluator with no provider. Not yet."** If `compare` ships, that is **three of six** actions reachable — say three.

---

## 3. The staged plan

Four stages. Each is independently shippable, independently valuable, and independently revertible. Nothing user-visible until Stage 2; nothing paid until Stage 3.

### Stage 0 — Make the stated constraint true on the server *(no feature; ~1 file)*

Today "compare is blocked" lives only in a client type union. Move the served-action list into `parseRemediationRefs` so the server, not a TypeScript alias, is the authority.

- `supabase/functions/_shared/ai-remediation.ts` — add a `SERVED_ACTIONS` subset (initially `['explain','hint']`) checked at `:42`, distinct from `REMEDIATION_ACTIONS` at `:1` (which stays the protocol vocabulary the SQL allowlists mirror).
- Same PR, cheap and important: make `domain-adapters.ts:42` **refuse** instead of falling back to the front, so no future change can build on `expectedResponse === stimulus`.
- Tests: `packages/web/src/lib/__tests__/learning-domain-adapters.test.ts` (which today asserts `stimulus` at `:15-19` and **never asserts `expectedResponse` at all**).

**Value alone:** §11.5's claim becomes enforceable rather than aspirational, and a hand-rolled `compare` stops charging the wallet. **Not in scope:** the SQL allowlists (`168:43`, `178:62`) — leave them wide; they are the protocol layer, and narrowing them costs a migration for no additional guarantee once the edge function refuses.

### Stage 1 — A tested answer-field resolver that refuses *(no user-visible change)*

- **New** `packages/shared/lib/card-answer.ts` — `resolveCardFaces(template, card): { promptKeys, referenceKeys } | null`, implementing §1c rules 1-4. It must **return `null`**, never fall back. Deliberately *not* reusing `resolveCardFaceContent`: its index fallback (`card-face-resolver.ts:72-83`) is right for rendering and wrong for grading.
- **New** test file covering: the official forward template (`089:33-46`), the official reverse template (`089:85-88`), the seeded 중국어 template's audio-in-back-layout case (`001:86`), the key-mismatch case (`card-face-resolver.test.ts:117-128`), and empty `back_layout`.
- Watch the drift trap: `packages/shared/lib/card-face-resolver.ts` and `packages/web/src/lib/card-face-resolver.ts` are **byte-identical** and only the web copy is imported (`StudyCard.tsx:6`). Do not add a third copy — put the new helper in `packages/shared/lib/` and import it from there.

**Value alone:** the repo gains its first honest, tested "which field is the answer" function. **Not in scope:** using it.

### Stage 2 — Typed answers exist and are stored *(real study feature, no AI, no charge)*

- `packages/shared/lib/learning-candidates.ts:158-166` — `legacyCardItemShape` takes the template; when `resolveCardFaces` is non-null, emit `responseType: 'text'` and keep `evaluatorType: 'self_rate'`. That pairing is precise, not a hedge: the response *is* text and the learner *is* the evaluator. Both strings are already in `SUPPORTED_RESPONSE_TYPES` / `SUPPORTED_EVALUATOR_TYPES` (`learning/domain/validators.ts:51, 54-60`), and `save_daily_plan` only requires non-empty (`167:558-563`).
- `packages/shared/stores/learning-store.ts:678-684` — `generatePlan` loads cards but no templates. Add a `card_templates` fetch selecting `id, fields, front_layout, back_layout`; the pattern already exists at `:620-636` (where `fetchPlan` selects only `id, fields`, so **that select must widen too**).
- Write the resolved keys into `daily_plan_items.payload` at `:746-757`. **No migration** — the column (`165:299`) and the writer (`167:627`) exist and are unused. This is what makes the plan row's decision auditable after the fact.
- UI, gated on `item.response_type === 'text'`: a text field *plus* the existing three rating buttons. Web: thread the prop through `PlanItemRow` (`LearningTodayPage.tsx:57-71`, call site `:443-486`). Mobile: `LearningTodayScreen.tsx:365-447`.
- `AttemptInput` (`learning-store.ts:187-194`) gains `text?: string`; `recordAttempt` (`:800-831`) sends `p_response: text ? { self_rated: score, text } : { self_rated: score }` at `:811`. **Build the response object before minting `clientAttemptId`** — `p_response` is in the idempotency comparison (`167:740`), so a retry with different text raises `P0007`.
- Read-back: add `response` and `response_type` to `AttemptRow` (`:165-177`) and to the `fetchAttempts` select (`:839`); render "you wrote: …" on the history row (`LearningTodayPage.tsx:225-280`, `LearningTodayScreen.tsx:553-631`). **This is the honesty check** — the learner sees exactly what the model will be shown.
- i18n: input label / placeholder / "you wrote" × **16 files** (`packages/web/public/locales/{en,es,id,ja,ko,th,vi,zh}/learning.json` at 138 keys each; `packages/mobile/src/i18n/locales/<same 8>/learning.json` at 127 keys each — verified in parity).

**Value alone:** typed recall (production, not recognition) is a genuinely better study mode and ships with no AI, no charge, and no new action. **Not in scope:** auto-grading. `ExactEvaluator` would mark a correct paraphrase wrong, and that score feeds insights (§2d). The evaluator stays `self_rate`.

### Stage 3 — `compare` becomes reachable, server-grounded

- `supabase/functions/ai-generate/index.ts:425` — add `template_id` to the cards select and load `card_templates`; resolve the reference with the same rule as Stage 1 and put an explicit `expectedAnswer: { key, value }` into the context at `:471-479`. The service-role client bypasses the subscriber-template RLS limit (`009:122-131`), so the server can resolve where the client could not. **Do not** hand the model `field_values` and let it pick.
- **Refuse, do not degrade.** If `refs.action === 'compare'` and either the attempt's `response.text` is empty or the reference does not resolve, throw *inside* the existing `try` so `releaseJob` (`:511`) runs, with its own code (e.g. `AI_COMPARE_UNGROUNDED` → 400) rather than `AI_PROVIDER_ERROR`. The reserve happens first at `:402`, so this ordering is load-bearing.
- `supabase/functions/_shared/ai-remediation.ts:97-99` — the "do NOT claim to know what the learner wrote / do not evaluate or compare a non-existent answer" block currently fires on `attemptGrounded` (`:84`). Re-key it on the response actually lacking text, and add a `compare` section naming `expectedAnswer` as the reference. Bump `p_prompt_version` at `index.ts:499` from `'remediation-v2'` to `'remediation-v3'`.
- `packages/shared/stores/learning-store.ts:239` — widen to `'explain' | 'hint' | 'compare'`, with the comment rewritten to state the subset.
- `LearningTodayPage.tsx:45-48, 247` and `LearningTodayScreen.tsx:69-72, 598` — add the entry, but the row currently maps every action with one shared condition. `compare` needs a **per-action** predicate; that refactor is part of this stage, not an afterthought.
- i18n: `enrichment.action.compare` × 16 files; `packages/mobile/src/i18n/i18n.test.ts:171` FAMILIES → `['explain','hint','compare']`, and its comment at `:168-170` rewritten (it currently states the old constraint as fact).
- **Tests that will go red and must be consciously updated, not silenced:** `packages/web/src/lib/__tests__/ai-remediation.test.ts:39-45` (pins the exact sentence at `:44-45`); `packages/web/src/pages/learning/__tests__/learning-pages.test.tsx:294-295` (exactly 2 explain + 2 hint); `packages/web/src/stores/__tests__/learning-store.test.ts` payload-shape tests.

**Value alone:** the third of six actions, and the first that uses the learner's own words. **Not in scope:** `evaluate`, `generate`, `recommend`.

### Stage 4 — *(optional, only on demand)* First caller for `create_private_activity`

Not needed for `compare`. This is the road to `exact` auto-grading and eventually `evaluate`, and it needs an authoring surface plus a decision about the `cards.user_id = auth.uid()` limit (`167:368-374`) that excludes official and subscribed decks.

---

## 4. What must NOT happen

The concrete dishonest ships, in rough order of likelihood:

1. **Widening `learning-store.ts:239` (or the two UI arrays) without Stages 1-3.** It compiles, it type-checks, it reserves credit, it calls the model, it persists a preview, and it charges — and it returns a comparison against an answer that does not exist. Nothing else is in the way. This is a one-line change that costs the learner money for a fabrication.
2. **Deriving the answer from `Object.keys(field_values)` order** (`domain-adapters.ts:16-20, 27-28`). Inverted for every official word card (`089:33-38`), per the repo's own documentation of jsonb key ordering (`card-prompt.ts:6-11`). A `compare` on this tells the learner the correct answer was the question they were just shown.
3. **Keeping the `back → front` fallback at `domain-adapters.ts:42`.** On a one-field card the expected answer silently becomes the stimulus. Kill it in Stage 0.
4. **Reusing `resolveCardFaceContent`'s index fallback** (`card-face-resolver.ts:72-83`) as the answer resolver. It is right for rendering (something beats a blank row) and wrong for grading (a confidently wrong reference is worse than none).
5. **Sending the whole card and letting the model infer the direction.** `index.ts:425` selects `id, field_values, tags` — no template, no ordering the model can trust. That is guessing the reference answer, relocated into the prompt where it cannot be tested, versioned, or audited.
6. **Leaving `ai-remediation.ts:97-99` unconditional while offering `compare`.** The system prompt would instruct the model to refuse the action line `:80` just instructed it to perform. The likely output is a generic explanation — which the learner paid the compare price for.
7. **Charging for a refused compare.** Reserve happens at `index.ts:402`, before context load. Any precondition failure must throw inside the `try` so `releaseJob` (`:511`) fires, and must carry a distinct error code so the UI can say *why* rather than "AI provider error."
8. **Telling the model anything about effort.** `hints_used` / `duration_ms` are `NOT NULL DEFAULT 0` (`165:223-224`), nothing sends a hint count, and `:818` sends `input.durationMs ?? 0` with no caller supplying one. The strip at `ai-remediation.ts:72-77` must stay until a caller genuinely populates them — a typed-answer surface is the natural place to start, but only once it actually measures.
9. **Claiming more actions than are wired.** If Stage 3 ships it is **three of six**, and `explain`/`hint` remain the only ones available on cards outside the subset.
10. **Reusing `'remediation-v2'`** (`index.ts:499`) for a changed prompt. That column is the only record of which prompt produced a stored, accepted answer.
11. **Adding locale keys to `en` only, or to mobile only.** Web has a real blind spot here: `packages/web/src/lib/__tests__/i18n-key-usage.test.ts` scans `t('literal')` calls and standalone `'ns:dotted.key'` literals (`:121-124`) — but the web action labels are bare `labelKey: 'enrichment.action.explain'` values consumed as `t(labelKey)`, matching **neither** pattern. A missing web key renders the literal string `enrichment.action.compare` as the modal's heading *and* `aria-label` (`EnrichmentModal.tsx:61, 66`). Only `translation-keys.test.ts` (8-locale parity vs `en`) catches it, and only if `en` has it. Mobile is covered — but only via the hand-maintained FAMILIES table (`i18n.test.ts:160-175`), which is now a genuine CI step (`.github/workflows/ci.yml:109-111`).
12. **Editing one `card-face-resolver.ts` and not the other.** Two byte-identical copies (`packages/shared/lib/`, `packages/web/src/lib/`); only the web one is imported. Same class of trap as the dual study-store in MEMORY.md.

---

## 5. Migration needs

**Stages 0-3 as scoped need zero migrations.** Everything they use already exists and is already CI-exercised:

| Need | Already there |
|---|---|
| Store learner text | `answer_attempts.response` (`165:219`), `record_answer_attempt(p_response)` (`167:648`), no cross-check against `response_type` (only the size cap at `167:705-707` and the idempotency compare at `:740`) |
| A `text` plan item | `save_daily_plan` requires only non-empty (`167:558-563`); `answer_attempts.response_type` has no enum (`165:217`) |
| Record what was shown | `daily_plan_items.payload` (`165:299`), written by `save_daily_plan` (`167:627`), currently always `{}` |
| Allow `compare` end to end | `168:43`, `178:62` already list all six |
| Attempt provenance | mig 178 `user_enrichments.attempt_id` + owner check (`:80-82`) + card-pair check (`:94-97`) |

**One optional migration**, only if Stage 0's enforcement is done in SQL instead of the edge function: narrowing `reserve_ai_remediation`'s allowlist (`168:43`). `CREATE OR REPLACE` is safe there (same signature). Note `persist_ai_remediation` was **DROPped and recreated** in 178 (`:37-53`) — it now has exactly one 13-arg signature, so a future replace must match it or you get two candidates for PostgREST, the failure mode mig 178's own comment warns about (`:32-36`).

**Numbering — and a correction to both investigations:**

- **`origin/develop`'s highest migration is `179_public_plan_limits.sql`, not 178.** Both investigations assumed 178. Next free number is **180**.
- `origin/main` is at **174**.
- Numbers **163, 164, 166 are gaps** — do not fill them. 163 in particular is a live example of the rule: the local `develop` worktree still carries an untracked `supabase/migrations/163_ai_remediation_metering.sql` that shipped as `168_ai_remediation_metering.sql`.
- Other open branches are already at 179 (`origin/fix/mobile-paywall-server-values`, `origin/docs/ops-followup-2026-08-01`), so **179 is contested**. Re-check immediately before pushing, per the repo rule:

  ```
  git fetch origin --prune
  git ls-tree -r --name-only origin/develop -- supabase/migrations | sed 's/.*\///' | cut -d_ -f1 | sort -n | tail -3
  for b in $(git branch -r | grep -v HEAD); do echo "$(git ls-tree -r --name-only $b -- supabase/migrations 2>/dev/null | sed 's/.*\///' | cut -d_ -f1 | sort -n | tail -1) $b"; done | sort -rn | head
  ```
- If a migration lands, mirror it in `supabase/rollbacks/` (the convention is live — e.g. `167_learning_engine_rpcs.down.sql`), and remember CI applies every migration in order under `ON_ERROR_STOP=1` (`.github/workflows/ci.yml:273-275`), so one failure hides every suite after it.

**Verify prod state before planning any of this — the docs disagree.** `DOCS/TODO/2026-07-31-attempt-grounded-remediation-design.md:179` says *"Production still lacks the learning chain (165–178)"*. `DOCS/TODO/AI-MONETIZATION-REMAINING.md:171-181` says prod is migrated **through 173**, verified against the database on the same day with `supabase migration list --linked`, and explicitly calls the "deliberately unrun" claim stale. 174-179 are unstated by either. Run `supabase migration list --linked` rather than trusting either document.

---

## Corrections to the three investigations

Worth carrying forward, because each of these would have mis-scoped the work:

- **Highest migration is 179, not 178** (all three assumed 178). Free-gap numbers 163/164/166 exist and must not be reused.
- **`daily_plan_items.payload` exists and is free** (`165:299`, written at `167:627`, never sent by the store). No investigation mentioned it. It is the natural, migration-free home for "which key was the prompt, which was the reference," decided at plan time.
- **`create_private_activity` cannot serve official or subscribed cards** — `167:368-374` requires `cards.user_id = auth.uid()`. The "curated expected answer" path is structurally limited to owned cards. Both investigations presented it as the clean option without this caveat.
- **`card_templates.back_layout` is a correct, existing declaration for the official templates** (`089:43-46`, `089:85-88`) and the seeded ones (`001:75, :86`) — the data-path investigation dismissed it as "not generic" without noting that the decks the app ships get it right, and that its failure modes are *detectable* (empty / mismatched / non-text / overlapping) rather than silent.
- **Subscriber template RLS is narrower than assumed**: `009:122-131` grants read only when the template is the deck's `default_template_id`. That shrinks the client-side subset and is the reason the edge function (service-role) should be the authority on the reference.
- **`packages/web/src/lib/study-input-settings.ts`** exists and matches a "typed answer" grep — it is button-vs-swipe (`:8`), not text entry. The "no typed-answer UI anywhere" conclusion survives, but the grep needs the follow-through.
- **`save_daily_plan` *can* overwrite a non-completed plan** (`167:509-530`) — one investigation said regeneration was impossible. It is possible but destructive (deletes items, resets `completed_items`), so it should still not be used to retrofit today's plans.
- **`card-face-resolver.ts` exists twice, byte-identical** (`packages/shared/lib/` and `packages/web/src/lib/`); only the web copy is imported. Cited as a single file by one investigation.