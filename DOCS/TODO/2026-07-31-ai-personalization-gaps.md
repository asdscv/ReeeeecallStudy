# AI Personalization — What Is Wired, What Is Not

- **Status:** TODO / audit record. No code in this document has been written yet.
- **Audited:** 2026-07-31 against `feat/learning-engine-memory-model` (base `origin/develop` `eb0411d`).
- **Related:** [learning-product-ui-design](./2026-07-31-learning-product-ui-design.md) (Phases 1–5b, shipped),
  [learning-memory-model-design](./2026-07-31-learning-memory-model-design.md) (`daily-plan-v2`),
  [modular-learning-engine-design](../DONE/LEARNING-ENGINE/2026-07-29-modular-learning-engine-design.md).

> **왜 이 문서가 있나.** "AI로 고객별 학습을 강화했나?"에 대한 답이 예/아니오가 아니라 "한 축만"이다.
> 어디까지 되어 있고 어디가 비었는지를 코드 근거와 함께 남긴다. 다음 사람이 "AI 개인화는 이미 있다"
> 또는 "전혀 없다" 중 아무거나 믿고 시작하는 것을 막는 것이 이 문서의 목적이다.

---

## 1. What AI actually does today: paid remediation, one action deep

| Piece | Where |
|---|---|
| Edge path `kind:'remediation'`, actions `explain / compare / hint / generate / evaluate / recommend` | `supabase/functions/_shared/ai-remediation.ts:1`, `supabase/functions/ai-generate/index.ts:397` |
| Metering: reserve → generate → persist; `P0002` insufficient credits, `23514` daily cap | `reserve_ai_remediation` / `persist_ai_remediation` (mig 168) |
| Grounding enforcement: `labor-law` (or any request carrying sources) is refused without a valid citation, and citation source ids are whitelisted against the loaded sources | `ai-remediation.ts:48` (`requireGrounding`), `:64` (`validateRemediationResult`) |
| Result is a preview the learner keeps or discards | `set_user_enrichment_status`, `learning_enrichments` (owner-only RLS, mig 165) |
| Provenance recorded per row: `model_version`, `provider`, `prompt_version='remediation-v1'` | `ai-generate/index.ts` persist call |

So there IS a per-customer AI surface, and it is the right kind of surface: explicit intent, priced,
audited, and refusable. It is not a chat box bolted onto a flashcard app.

## 2. The gap: the client asks a shallower question than the server can answer

`buildRemediationPrompt` receives `{ goal, activity, attempt, cards, concepts, sources }`, and the
edge function already loads **the learner's own attempt** — `answer_attempts.response`,
`normalized_score`, `evaluator_result`, `feedback` — filtered by `user_id`
(`ai-generate/index.ts:424`). `parseRemediationRefs` accepts `attemptId`
(`ai-remediation.ts:8`).

The UI never sends it:

```
packages/shared/stores/learning-store.ts:832   requestEnrichment({ action, goalId, cardId, uiLang })
packages/web/src/pages/learning/LearningTodayPage.tsx:320    action: 'explain', goalId, cardId
packages/mobile/src/screens/LearningTodayScreen.tsx:355       action: 'explain', goalId, cardId
```

Consequences, stated plainly:

- The model explains **the card in the goal's context**. It cannot say "you answered X, here is why
  that is wrong", because it is never shown what the learner answered.
- `attempt` is dead weight in the prompt contract — a field the server assembles and nothing fills.
- Five of the six actions are unreachable from the product: both platforms hard-code `'explain'`.
  `compare` / `hint` / `evaluate` are exactly the actions that need an attempt to be worth paying for.

**This is not a one-line wiring fix.** The entry point has to be a failed attempt (or the attempt
history of a card), which means an affordance in the study/attempt path, not another button on the
plan row — and a decision about what the learner is charged for at that moment.

> **2026-07-31, later the same day:** the server half of this is now written on
> `feat/attempt-grounded-remediation` (migration 175 + edge function + shared store + a pure
> attempt-selection rule, verified against a local DB). The two client call sites quoted above are
> **still unchanged** — they change in that workstream's PR B. When PR B lands, this section
> describes history, not the current state; check the linked design doc's §10 before trusting it.

## 3. Also not wired: AI evaluation of free-text answers

`AiEvaluatorAdapter` exists (`packages/shared/learning/evaluators/evaluators.ts:98`) and is
referenced by nothing outside its own file. Legacy cards project to `self_rate`
(design §5.2), so no product path produces a free-text response for it to grade. Until curated
activities with `expected_response`/`rubric` exist, this adapter has no input — it is scaffolding
for content that has not been authored, not a defect.

## 4. Deliberately NOT AI (do not "fix" this by accident)

| Surface | Implementation | Why it stays deterministic |
|---|---|---|
| Today's plan ordering | `daily-plan-v2` — weights + FSRS retrievability, pure | Plans must be reproducible (`input_fingerprint`, design §9.4) and a per-plan LLM call would bill every user every day |
| Recommendations | `weak-card-v1`, `provider='algorithm'` (`learning-store.ts:228`, `:994`), derived from `insights.weakCards` (`lib/learning-insights.ts:111`) | Versioned + explainable; mig 174 records `provider`/`algorithm_version` precisely so an AI producer can be ADDED next to it rather than replacing it |
| Insights / diagnostics | pure aggregation over `answer_attempts` + `daily_plans` | "No data" must not render as zero, and that is easier to guarantee once, in a pure function |
| SRS scheduling | SM-2 via `apply_study_rating` | Replacing it is migration-heavy and orthogonal to personalization |

## 5. Prioritized next steps

**① Attempt-grounded remediation** *(**DONE** — #377/#378; design +
progress in [attempt-grounded-remediation](./2026-07-31-attempt-grounded-remediation-design.md))*
Send `attemptId` and let the learner request `explain` / `hint` **from a failed attempt**.
Server side is already built and metered; the work is the product surface and the pricing moment.
- Scope: attempt-history entry point (web + mobile), action picker, `requestEnrichment` signature,
  cost-before-call copy per action.
- Risk: each action is a paid call — the UI must show cost and must not make a second call cheap by
  accident. Reuse the existing `AI_INSUFFICIENT_CREDITS` / `AI_RATE_CAP` / `AI_GROUNDING_REQUIRED`
  distinct messages; do not add a generic failure path.
- Test: an attempt-scoped request must be refused when the attempt is not the caller's
  (`reserve_ai_remediation` already checks; pin it in SQL), and the prompt must carry the attempt.
- **Correction found while implementing.** This entry originally listed `compare` as one of the
  actions to unlock. It was not reachable then: an attempt stored `{ self_rated: score }` and no
  learner text, so there was nothing to compare against. Only `explain` and `hint` became
  reachable in #377/#378.
- **Superseded 2026-08-01.** #392 added typed answers and #394 shipped `compare` on top of them,
  grounded in the template's *declared* answer field (`resolveCardAnswerFaces`) and refusing —
  never degrading — when either half is missing. `compare` no longer waits on anything;
  `evaluate` still does, for the reasons in ② and in
  [compare-evaluate-feasibility](./2026-08-01-compare-evaluate-feasibility.md) §2.
- **Third finding, 2026-08-01.** The constraint this entry describes was never ENFORCED: it lived
  in a client type alias, while `parseRemediationRefs` and both SQL allowlists accepted all six
  actions. A hand-rolled `compare` reserved, charged, and returned an invented comparison.
  `SERVED_REMEDIATION_ACTIONS` (#383) is now the authority. A TypeScript union is not access
  control.
- **Second finding.** `user_enrichments` has no `attempt_id` and `persist_ai_remediation` had no
  parameter for one, so a grounded answer could not record which failure it was about
  (`request_fingerprint` is a 128-char truncation, not provenance). Migration 175 closes that in
  the same workstream.

**② AI evaluation for free-text responses** *(still blocked, and typed answers did NOT unblock it)*
Blocked on curated activities (`expected_response` / `rubric`). Wiring it before that content exists
would produce an evaluator with nothing to evaluate. Revisit with concept authoring.

Worth stating precisely, because #392 makes it tempting: free text was necessary for `evaluate`
but nowhere near sufficient. It must return a GRADE, and there is still no grader wired
(`AiEvaluatorAdapter` has no `RemediationProvider` implementation), nothing ever writes
`learning_activities.rubric`, and `validateRemediationResult` does not require a score — so it
would validate and charge for prose with no grade in it. Its output would also feed
`normalized_score`, which steers the next day's plan: a decision about who owns the curriculum,
not a prompt change.

**③ An AI recommendation producer, ALONGSIDE `weak-card-v1`**
mig 174 already stores `provider` + `algorithm_version`, so add `provider='ai'` rows rather than
swapping the deterministic producer out. Requires a cost story (who pays for a recommendation the
learner did not ask for) — that is a business decision, not an engineering one, and until it is made
this stays deferred.

## 6. Out of scope for all three

Nothing here needs new tables, new grants, or a service-role key in the client.

Production migration of the learning chain was owner-gated when this was written; it is **done**
— 165–179 are applied and verified on prod (2026-08-01), including mig 178's attempt provenance.

## 7. Closed out — 2026-08-01

① is shipped. ② is correctly still blocked, on content rather than on code. ③ is correctly still
deferred, on a pricing decision rather than on engineering.

What this document could not have known, and what the same pass found instead: the RANKER those
features feed was inert in production. `recentFailure` was a dead constant (#387), `reviewValue`
was constant or inverted (#388), and the planner read the publisher's schedule instead of the
learner's on the decks holding 99.7% of all cards (#389). Personalising the AI on top of a
ranking that returned one score for every card would have been decorating a broken foundation.
Evidence and measurements: [learning-logic-sellability](./2026-08-01-learning-logic-sellability.md).
