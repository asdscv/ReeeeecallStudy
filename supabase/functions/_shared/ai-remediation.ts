export const REMEDIATION_ACTIONS = ['explain', 'compare', 'hint', 'generate', 'evaluate', 'recommend'] as const
export type RemediationAction = typeof REMEDIATION_ACTIONS[number]

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
  if (!REMEDIATION_ACTIONS.includes(body.action as RemediationAction)) return null
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
  const systemPrompt = [
    'You are a learning remediation engine, not a general chat assistant.',
    `Perform only the structured action "${refs.action}" for the supplied learning records.`,
    'Return JSON only with: action, summary, blocks, citations, confidence, warnings.',
    'blocks must be a non-empty array of {type, content}. citations must be {sourceId, locator}.',
    'Never invent source IDs. Never claim legal, medical, or financial professional advice.',
    requireGrounding
      ? 'Ground all substantive claims in the supplied sources and include at least one valid citation. If sources are insufficient, say so in warnings.'
      : 'Use only supplied learning context; state uncertainty in warnings.',
    `Write learner-facing text in locale ${refs.uiLang}.`,
  ].join('\n')
  const safeContext = JSON.stringify({ refs, context }).slice(0, 64 * 1024)
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
