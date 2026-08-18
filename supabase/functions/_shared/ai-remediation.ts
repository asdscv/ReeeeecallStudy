/**
 * The protocol vocabulary — every action name the SQL allowlists accept
 * (`reserve_ai_remediation`, `persist_ai_remediation`). NOT the list this server will run.
 */
export const REMEDIATION_ACTIONS = ['explain', 'compare', 'hint', 'generate', 'evaluate', 'recommend', 'diagnose'] as const
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
 * `compare` joined the list once BOTH halves of its premise existed, and not before:
 *   - the learner's own words: attempts now store `{ self_rated, text }` when the item was
 *     answered by typing (`response_type = 'text'`);
 *   - a reference that is genuinely the expected answer: `resolveCardAnswerFaces` reads the
 *     template's declared `back_layout` and returns NULL rather than guessing. Picking a card
 *     field by position is not a weaker version of this — for the official word templates it
 *     is inverted, so it would mark a correct answer wrong.
 * Either half missing is a REFUSAL, never a degrade to a generic explanation. See
 * `compareGroundingError`.
 *
 * `evaluate` is still absent, and adding typed answers did not change that: it must return a
 * GRADE. There is no grader wired (`AiEvaluatorAdapter` has no provider implementation), no
 * rubric is ever written, and `validateRemediationResult` does not require a score — so it
 * would validate and charge for prose with no grade in it. Its output would also feed
 * `normalized_score`, which steers tomorrow's plan; that is a decision about who owns the
 * curriculum, not a prompt change.
 *
 * `generate` is content authoring, and `recommend` duplicates the free `weak-card-v1` path.
 *
 * `diagnose` (mig 246) is the one that was widened, and it came with the thing that makes it
 * honest: `get_learning_diagnosis_evidence` counts labels this app has been recording since
 * mig 193 and never read back, `diagnosisGroundingError` refuses a thin window BEFORE the
 * wallet is touched, and the output is a closed set — no prose, so nothing it returns can be
 * confidently wrong about the subject. It takes its own path in `index.ts` rather than sharing
 * `buildRemediationPrompt`, whose whole contract is `blocks[]` of model-written text.
 *
 * Widen this ONLY together with the thing that makes the action honest.
 */
// 262: `hint` 를 뺐습니다. 화면에 누를 데가 한 번도 없었는데 인증된 호출자면 과금됐습니다 —
// 값이 얼마든 그건 지갑에 난 구멍이고, 모범답안이 생긴 지금 존재 이유도 겹칩니다.
export const SERVED_REMEDIATION_ACTIONS = ['explain', 'compare', 'diagnose'] as const

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
  /**
   * The expected answer, as the card's TEMPLATE AUTHOR declared it.
   *
   * Present only when `resolveCardAnswerFaces` could name the answer field(s) — never a
   * positional guess, which for the official word templates is inverted and would mark a
   * correct answer wrong. Absent means `compare` is refused, not softened.
   */
  expectedAnswer?: { readonly keys: readonly string[]; readonly text: string } | null
}

/**
 * Why a `compare` request cannot be grounded, or null when it can.
 *
 * Both halves of the premise are checked BEFORE the model is called, and a missing half is a
 * refusal rather than a fallback to a generic explanation. Degrading silently would charge the
 * learner for `compare` and hand back `explain` — the failure mode this whole action was held
 * back to avoid.
 */
export function compareGroundingError(
  attempt: unknown,
  expectedAnswer: { text: string } | null | undefined,
): 'NO_LEARNER_ANSWER' | 'NO_REFERENCE_ANSWER' | null {
  const response = (attempt as { response?: { text?: unknown } } | null)?.response
  const typed = typeof response?.text === 'string' ? response.text.trim() : ''
  if (typed === '') return 'NO_LEARNER_ANSWER'
  if (!expectedAnswer || expectedAnswer.text.trim() === '') return 'NO_REFERENCE_ANSWER'
  return null
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
  // Ground on the sources that are actually present, and on nothing else.
  //
  // This used to be OR'd with a per-domain policy flag, which exactly one domain set. That
  // combination was unsatisfiable: the flag made the prompt demand a citation, while
  // `validateRemediationResult` only accepts a citation whose `sourceId` is in
  // `allowedSourceIds` — built from `content_sources`, a table whose three writer RPCs
  // (`create_private_source` / `_concept` / `_activity`) have no callers and which holds no
  // rows in production. Every request in that domain failed before the model was even called.
  //
  // Sources-only is the honest rule: when a caller starts supplying sources, grounding turns
  // itself on, and until then nothing promises a citation it cannot produce.
  const requireGrounding = context.sources.length > 0
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
  // Whether the learner actually wrote something, rather than whether an attempt exists. The
  // old wording fired on "there is an attempt", which is a different question and told the
  // model to disclaim an answer it HAD been given once typed answers started arriving.
  const typedAnswer = attemptGrounded && typeof (attempt.response as { text?: unknown } | null)?.text === 'string'
    ? ((attempt.response as { text: string }).text).trim()
    : ''
  const expected = context.expectedAnswer ?? null
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
      ...(typedAnswer === '' ? [
        'attempt.response contains ONLY a self-rating — the learner wrote nothing. Do NOT claim to'
        + ' know what they wrote, and do not evaluate or compare a non-existent answer; say what is'
        + ' likely being confused and why, based on the item itself.',
      ] : [
        'attempt.response.text is what the learner actually wrote. Quote it when useful. It is'
        + ' their words, not a paraphrase, and not something to correct for spelling unless the'
        + ' spelling is the point of the item.',
      ]),
    ] : []),
    ...(refs.action === 'compare' && expected ? [
      'Compare attempt.response.text with expectedAnswer.text, which is the answer THIS CARD'
      + " declares — not your own idea of a good answer. Say what matches, what is missing, and"
      + ' what is wrong, in that order.',
      'A different wording that means the same thing is CORRECT. Say so plainly rather than'
      + ' listing it as a difference; the learner is being tested on recall, not on phrasing.',
      'Do not invent a third answer. If expectedAnswer.text is itself incomplete, say that'
      + ' instead of filling the gap from your own knowledge.',
    ] : []),
    requireGrounding
      ? 'Ground all substantive claims in the supplied sources and include at least one valid citation. If sources are insufficient, say so in warnings.'
      // No sources were supplied, so there is nothing a citation could point AT. Said
      // explicitly because the schema line above still names a `citations` field, and a model
      // that helpfully fills it in cites an id that does not exist — which
      // `validateRemediationResult` used to reject, turning a paid request the learner had
      // already been charged the provider tokens for into a 502.
      : 'No sources were supplied: citations MUST be an empty array. Use only the supplied'
        + ' learning context.',
    // `warnings` is rendered to the learner, under the explanation they paid for. Saying so is
    // load-bearing: the first live call came back with "No sources were supplied, so citations
    // are empty." — the model dutifully reporting on the request format, to someone who did not
    // write the request and cannot do anything about it.
    'warnings is shown to the LEARNER. Use it only for limits on the ANSWER — what you could'
    + ' not work out about their mistake, and what they should not take on faith. Never mention'
    + ' sources, citations, context, JSON, or how this request was assembled; none of that is'
    + ' theirs to act on. If nothing limits the answer, return an empty array.',
    // The locale line used to say "learner-facing text", and the model read that as the prose
    // and not the caveats: a Korean learner got a Korean explanation under English warnings.
    `Write EVERY learner-facing string — summary, every block's content, and every warning —`
    + ` in locale ${refs.uiLang}, whatever language the learning material itself is in.`,
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
    if (typeof sourceId !== 'string' || !allowedSourceIds.includes(sourceId)) {
      // When the answer had to be grounded, an unknown citation is the failure this validator
      // exists for: the model claimed a source it was not given.
      if (requireGrounding) return { valid: false, reason: 'unknown citation source' }
      // When it did NOT, there were no sources at all, so a volunteered citation points at
      // nothing renderable — and failing the whole request over a field the learner never sees
      // is worse than dropping it. The prompt above now says to omit them; this is what
      // happens when a model ignores that.
      continue
    }
    sourceIds.push(sourceId)
  }
  if (requireGrounding && sourceIds.length === 0) return { valid: false, reason: 'source grounding required' }
  if (value.confidence != null && (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)) return { valid: false, reason: 'invalid confidence' }
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== 'string')) return { valid: false, reason: 'invalid warnings' }
  return { valid: true, content: value, sourceIds: [...new Set(sourceIds)] }
}
