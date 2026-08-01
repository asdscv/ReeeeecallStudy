/**
 * The protocol vocabulary — every action name the SQL allowlists accept
 * (`reserve_ai_remediation`, `persist_ai_remediation`). NOT the list this server will run.
 */
export const REMEDIATION_ACTIONS = ['explain', 'compare', 'hint', 'generate', 'evaluate', 'recommend'] as const
export type RemediationAction = typeof REMEDIATION_ACTIONS[number]

/**
 * The actions this server will actually perform. Anything else is refused before a wallet is
 * touched.
 *
 * This list exists because the constraint it enforces was previously written down in a CLIENT
 * type alias (`RemediationAction = 'explain' | 'hint'` in the shared store) and nowhere else.
 * A TypeScript union constrains our own UI and nothing about the request an authenticated
 * caller can POST — so `action: 'compare'` reserved against the learner's wallet, called the
 * model, and returned a comparison of the learner's answer against the expected one. Attempts
 * store `{ self_rated: score }`: there IS no learner answer, so that comparison was invented,
 * and the learner paid for it.
 *
 * `compare` and `evaluate` are absent deliberately, not accidentally:
 *   - `compare` needs the learner's own words plus a reference answer that is genuinely the
 *     expected one. Neither exists yet — no surface captures typed text, and picking a card
 *     field by position guesses (and for the official word templates guesses INVERTED).
 *   - `evaluate` must return a grade. There is no grader wired (`AiEvaluatorAdapter` has no
 *     provider), no rubric is ever written, and `validateRemediationResult` does not require a
 *     score — so it would validate and charge for prose with no grade in it. Its output would
 *     also feed `normalized_score`, which steers tomorrow's plan.
 * `generate` is content authoring, and `recommend` duplicates the free `weak-card-v1` path.
 *
 * Widen this ONLY together with the thing that makes the action honest.
 */
export const SERVED_REMEDIATION_ACTIONS = ['explain', 'hint'] as const

export interface RemediationRefs {
  action: RemediationAction
  goalId: string | null
  activityId: string | null
  attemptId: string | null
  cardIds: string[]
  conceptIds: string[]
  uiLang: string
}

export interface RemediationContextPayload {
  goal: unknown
  activity: unknown
  attempt: unknown
  cards: unknown[]
  concepts: unknown[]
  sources: Array<{ id: string; title: string; citation: string | null; metadata?: unknown }>
  /**
   * Up to 5 most recent attempts on the SAME card, newest first — scores and timestamps only.
   *
   * This is what turns one failure into a pattern the model can speak to ("4 of the last 5 were
   * misses"), and it is the whole point of grounding a request in an attempt. Deliberately no
   * responses and no feedback text: the extra tokens buy nothing for `explain`/`hint`, and a
   * learner's own words do not need to travel further than the request that produced them.
   */
  attemptHistory?: Array<{ normalized_score: number | null; created_at: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const asUuid = (value: unknown): string | null => typeof value === 'string' && UUID.test(value) ? value : null
const asUuidList = (value: unknown): string[] | null => {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 50) return null
  const parsed = value.map(asUuid)
  return parsed.every(Boolean) ? [...new Set(parsed as string[])] : null
}

export function parseRemediationRefs(body: Record<string, unknown>): RemediationRefs | null {
  // Checked against what this server SERVES, not the protocol vocabulary. Refused here, before
  // `reserve_ai_remediation` runs, so an unserved action cannot reach the wallet at all.
  if (!(SERVED_REMEDIATION_ACTIONS as readonly string[]).includes(body.action as string)) return null
  const goalId = body.goalId == null ? null : asUuid(body.goalId)
  const activityId = body.activityId == null ? null : asUuid(body.activityId)
  const attemptId = body.attemptId == null ? null : asUuid(body.attemptId)
  const cardIds = asUuidList(body.cardIds)
  const conceptIds = asUuidList(body.conceptIds)
  if ((body.goalId != null && !goalId) || (body.activityId != null && !activityId) ||
      (body.attemptId != null && !attemptId) || !cardIds || !conceptIds) return null
  if (!goalId && !activityId && !attemptId && cardIds.length === 0 && conceptIds.length === 0) return null
  const uiLang = typeof body.uiLang === 'string' && body.uiLang.length <= 20 ? body.uiLang : 'en'
  return { action: body.action as RemediationAction, goalId, activityId, attemptId, cardIds, conceptIds, uiLang }
}

export function buildRemediationPrompt(refs: RemediationRefs, context: RemediationContextPayload): { systemPrompt: string; userPrompt: string; requireGrounding: boolean } {
  const domainId = context.goal && typeof context.goal === 'object' ? (context.goal as Record<string, unknown>).domain_id : null
  const requireGrounding = domainId === 'labor-law' || context.sources.length > 0
  // An attempt is EVIDENCE, and the model has to be told what kind. Without this line it treats
  // the attempt as decoration and produces the same generic explanation it would have produced
  // for the card alone — which is what the learner already paid for once.
  const attempt = (context.attempt ?? null) as Record<string, unknown> | null
  const attemptGrounded = attempt !== null
  // `hints_used` and `duration_ms` are NOT NULL DEFAULT 0 (mig 165:223) and NO shipping caller
  // populates either — neither web's nor mobile's rating button passes a duration, and nothing
  // passes a hint count at all. So every attempt that exists today carries 0 for both.
  //
  // `duration_ms: 0` is not an absent signal the model can discount; it is the assertion
  // "answered in 0 ms", and `hints_used: 0` is actively false once a learner has bought a hint
  // (the `hint` action never increments it). So the zero case is STRIPPED from the payload
  // rather than explained away in an instruction: a model cannot misread a field it was never
  // given, and a negative instruction is the weaker of the two guarantees.
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const EFFORT_FIELDS = ['hints_used', 'duration_ms']
  const hasEffortSignal = attemptGrounded && EFFORT_FIELDS.some((field) => num(attempt[field]) > 0)
  const promptAttempt = attemptGrounded && !hasEffortSignal
    ? Object.fromEntries(Object.entries(attempt).filter(([key]) => !EFFORT_FIELDS.includes(key)))
    : attempt
  const systemPrompt = [
    'You are a learning remediation engine, not a general chat assistant.',
    `Perform only the structured action "${refs.action}" for the supplied learning records.`,
    'Return JSON only with: action, summary, blocks, citations, confidence, warnings.',
    'blocks must be a non-empty array of {type, content}. citations must be {sourceId, locator}.',
    'Never invent source IDs. Never claim legal, medical, or financial professional advice.',
    ...(attemptGrounded ? [
      'The learner has attempted this item. Use attempt.normalized_score (0 = missed, 1 = recalled)'
      + ' and attemptHistory to target the answer at THIS learner\'s difficulty: address the'
      + ' repeated failure pattern when attemptHistory shows one.',
      ...(hasEffortSignal ? [
        'attempt.hints_used and attempt.duration_ms are populated for this attempt; treat them as'
        + ' effort signals alongside the score.',
      ] : [
        // Belt and braces: the fields are already absent from the payload, and this says why so
        // the model does not treat the omission itself as meaningful.
        'Timing and hint counts were not recorded for this attempt and are therefore absent.'
        + ' Never describe how fast the learner answered or how much help they used.',
      ]),
      'attempt.response may contain only a self-rating and no written answer. In that case do NOT'
      + " claim to know what the learner wrote, and do not evaluate or compare a non-existent answer;"
      + ' say what is likely being confused and why, based on the item itself.',
    ] : []),
    requireGrounding
      ? 'Ground all substantive claims in the supplied sources and include at least one valid citation. If sources are insufficient, say so in warnings.'
      : 'Use only supplied learning context; state uncertainty in warnings.',
    `Write learner-facing text in locale ${refs.uiLang}.`,
  ].join('\n')
  const safeContext = JSON.stringify({ refs, context: { ...context, attempt: promptAttempt } }).slice(0, 64 * 1024)
  return { systemPrompt, userPrompt: `Structured learning context:\n${safeContext}`, requireGrounding }
}

export function validateRemediationResult(
  value: Record<string, unknown>, refs: RemediationRefs, allowedSourceIds: readonly string[], requireGrounding: boolean,
): { valid: true; content: Record<string, unknown>; sourceIds: string[] } | { valid: false; reason: string } {
  if (value.action !== refs.action || typeof value.summary !== 'string' || !value.summary.trim()) return { valid: false, reason: 'invalid action or summary' }
  if (!Array.isArray(value.blocks) || value.blocks.length === 0 || value.blocks.length > 50) return { valid: false, reason: 'invalid blocks' }
  for (const block of value.blocks) {
    if (!block || typeof block !== 'object' || typeof (block as Record<string, unknown>).type !== 'string' || !('content' in (block as object))) {
      return { valid: false, reason: 'invalid block' }
    }
  }
  if (!Array.isArray(value.citations) || value.citations.length > 100) return { valid: false, reason: 'invalid citations' }
  const sourceIds: string[] = []
  for (const citation of value.citations) {
    if (!citation || typeof citation !== 'object') return { valid: false, reason: 'invalid citation' }
    const sourceId = (citation as Record<string, unknown>).sourceId
    if (typeof sourceId !== 'string' || !allowedSourceIds.includes(sourceId)) return { valid: false, reason: 'unknown citation source' }
    sourceIds.push(sourceId)
  }
  if (requireGrounding && sourceIds.length === 0) return { valid: false, reason: 'source grounding required' }
  if (value.confidence != null && (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)) return { valid: false, reason: 'invalid confidence' }
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== 'string')) return { valid: false, reason: 'invalid warnings' }
  return { valid: true, content: value, sourceIds: [...new Set(sourceIds)] }
}
