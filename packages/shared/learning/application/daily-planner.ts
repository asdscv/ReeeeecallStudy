import { validationError } from '../domain/errors.ts'
import type { ActivityType, PlannedItem, PlannerCandidate, PlannerInput, PlannerOutput } from '../domain/types.ts'

export const DAILY_PLANNER_VERSION = 'daily-plan-v2'
const DEFAULT_MIX: Readonly<Record<string, number>> = { recall: 0.6, practice: 0.25, produce: 0.15 }

/**
 * Feature weights, summing to 1.
 *
 * v2 moved 0.25 out of `dueUrgency` (0.35 → 0.10) into `reviewValue`. Raw lateness is a poor
 * objective — 8 days and 30 days overdue are the same number to it, and lateness only means
 * something relative to the memory's stability. `reviewValue` (application/memory.ts) says how
 * much a review is worth right now instead. `dueUrgency` is kept because it is the only feature
 * that speaks for a card with no forgetting curve yet (never reviewed → 1).
 */
const WEIGHTS = {
  reviewValue: 0.25,
  recentFailure: 0.25,
  goalRelevance: 0.2,
  dueUrgency: 0.1,
  responseTimePenalty: 0.1,
  contentImportance: 0.1,
}

const clamp01 = (value: number, fallback = 0.5): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback

/**
 * A feature that may legitimately be unknown.
 *
 * Unlike the always-present features — where a non-finite value falls back to neutral 0.5 —
 * anything unusable here becomes `null`, i.e. "no evidence". Substituting 0.5 would rank a card
 * on a memory estimate nobody made, and 0 would bury every new card (design §9.2).
 */
const optionalFeature = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null

/**
 * The scored features, each with the reason code it justifies when it dominates.
 *
 * One list drives both scoring and `reasonCode`, so the reason a row shows can never disagree
 * with the arithmetic that put it there.
 */
const FEATURES: ReadonlyArray<{
  readonly code: string
  readonly weight: number
  readonly read: (candidate: PlannerCandidate) => number | null
}> = [
  { code: 'memory_risk', weight: WEIGHTS.reviewValue, read: (c) => optionalFeature(c.reviewValue) },
  { code: 'recent_failure', weight: WEIGHTS.recentFailure, read: (c) => clamp01(c.recentFailure) },
  { code: 'goal_relevance', weight: WEIGHTS.goalRelevance, read: (c) => clamp01(c.goalRelevance) },
  { code: 'due', weight: WEIGHTS.dueUrgency, read: (c) => clamp01(c.dueUrgency) },
  { code: 'slow_response', weight: WEIGHTS.responseTimePenalty, read: (c) => clamp01(c.responseTimePenalty) },
  { code: 'importance', weight: WEIGHTS.contentImportance, read: (c) => clamp01(c.contentImportance) },
]

function normalizeMix(input?: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const source = input && Object.keys(input).length ? input : DEFAULT_MIX
  const entries = Object.entries(source).filter(([id, weight]) => id.trim() && Number.isFinite(weight) && weight > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) throw validationError('activityMix must contain a positive finite weight')
  return Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]))
}

/**
 * Priority in 0..1, computed over the features this candidate actually has.
 *
 * The divisor is the weight that was USED, not the full 1.0: a candidate without a memory
 * estimate is scored on the remaining 0.75 and rescaled, so it stays comparable to one that has
 * it. Renormalising is the only option that neither fabricates a memory estimate nor punishes a
 * card for not having one.
 */
export function scoreCandidate(candidate: PlannerCandidate): number {
  let weighted = 0
  let used = 0
  for (const feature of FEATURES) {
    const value = feature.read(candidate)
    if (value === null) continue
    weighted += value * feature.weight
    used += feature.weight
  }
  return used > 0 ? weighted / used : 0
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

function fingerprint(value: unknown): string {
  const text = stableSerialize(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * The single feature that contributed most to this candidate's score.
 *
 * A feature that could not be computed is not a reason — `memory_risk` never appears for a card
 * whose retrievability is unknown. `balanced` remains the fallback for a candidate with no
 * usable feature at all.
 */
function reasonCode(candidate: PlannerCandidate): string {
  const features = FEATURES
    .map((feature) => {
      const value = feature.read(candidate)
      return value === null ? null : ([feature.code, value * feature.weight] as [string, number])
    })
    .filter((entry): entry is [string, number] => entry !== null)
  features.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return features[0]?.[0] ?? 'balanced'
}

interface PlannerOptions {
  readonly supportedActivityTypes?: readonly string[]
}

export function buildDailyPlan(input: PlannerInput, options: PlannerOptions = {}): PlannerOutput {
  if (!Number.isFinite(input.budgetMinutes) || input.budgetMinutes <= 0) {
    throw validationError('budgetMinutes must be positive')
  }
  if (!input.algorithmVersion.trim() || !input.timezone.trim() || Number.isNaN(Date.parse(input.now))) {
    throw validationError('algorithmVersion, timezone, and a valid now timestamp are required')
  }

  const mix = normalizeMix(input.activityMix)
  const supported = new Set(options.supportedActivityTypes ?? Object.keys(mix))
  const unique = new Map<string, PlannerCandidate>()
  let excludedUnsupported = 0
  for (const candidate of input.candidates) {
    if (!supported.has(candidate.activityType)) { excludedUnsupported += 1; continue }
    if (!Number.isFinite(candidate.estimatedMinutes) || candidate.estimatedMinutes <= 0) continue
    const existing = unique.get(candidate.candidateId)
    if (!existing || scoreCandidate(candidate) > scoreCandidate(existing)) unique.set(candidate.candidateId, candidate)
  }

  const ranked = [...unique.values()].sort((a, b) =>
    scoreCandidate(b) - scoreCandidate(a) || a.candidateId.localeCompare(b.candidateId))
  const selected: PlannerCandidate[] = []
  const selectedIds = new Set<string>()
  let remaining = input.budgetMinutes

  /**
   * Reviews first, new cards with what is left.
   *
   * Not a preference — an ordering the schedule depends on. A new card scores `dueUrgency = 1`,
   * the maximum, because "never seen" is the most overdue a card can be; on raw score it
   * therefore OUTRANKS a review that is genuinely late. Selecting on score alone let intake win
   * the budget while owed reviews slipped, and every review that slips comes back tomorrow
   * alongside the intake that displaced it. That compounds, and the learner has no way to see
   * why their backlog only grows.
   *
   * Splitting the passes makes the failure mode benign instead: when reviews fill the day, the
   * new-card pass simply finds no budget and intake pauses until the learner is caught up.
   */
  const reviews = ranked.filter((candidate) => !candidate.isNew)
  const fresh = ranked.filter((candidate) => candidate.isNew)

  const takeWithinMix = (pool: readonly PlannerCandidate[], cap: number): void => {
    let taken = 0
    for (const [activityType, ratio] of Object.entries(mix)) {
      let classBudget = input.budgetMinutes * ratio
      const candidates = pool.filter((candidate) => candidate.activityType === activityType)
      for (const candidate of candidates) {
        if (taken >= cap) return
        if (selectedIds.has(candidate.candidateId)) continue
        const fitsClass = candidate.estimatedMinutes <= classBudget
        const allowSmallest = !selected.some((item) => item.activityType === activityType) && candidate.estimatedMinutes <= remaining
        if ((fitsClass || allowSmallest) && candidate.estimatedMinutes <= remaining) {
          selected.push(candidate); selectedIds.add(candidate.candidateId); taken += 1
          classBudget -= candidate.estimatedMinutes; remaining -= candidate.estimatedMinutes
        }
      }
    }
    // Leftover pass: a class that could not spend its share must not strand the budget.
    for (const candidate of pool) {
      if (taken >= cap) return
      if (!selectedIds.has(candidate.candidateId) && candidate.estimatedMinutes <= remaining) {
        selected.push(candidate); selectedIds.add(candidate.candidateId); taken += 1
        remaining -= candidate.estimatedMinutes
      }
    }
  }

  // Reviews are never capped by the intake limit: they are work already owed, and refusing to
  // show them would not make them go away.
  takeWithinMix(reviews, Number.POSITIVE_INFINITY)

  const newCardCap = Number.isFinite(input.newCardsPerDay ?? Number.POSITIVE_INFINITY)
    ? Math.max(0, Math.floor(input.newCardsPerDay as number))
    : Number.POSITIVE_INFINITY
  takeWithinMix(fresh, newCardCap)

  selected.sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.candidateId.localeCompare(b.candidateId))
  const items: PlannedItem[] = selected.map((candidate, position) => ({
    candidateId: candidate.candidateId,
    activityId: candidate.activityId,
    cardId: candidate.cardId,
    conceptId: candidate.conceptId,
    activityType: candidate.activityType as ActivityType,
    priority: scoreCandidate(candidate),
    estimatedMinutes: candidate.estimatedMinutes,
    reasonCode: reasonCode(candidate),
    position,
  }))
  const reasonCodes: Record<string, number> = {}
  for (const item of items) reasonCodes[item.reasonCode] = (reasonCodes[item.reasonCode] ?? 0) + 1

  return {
    items,
    algorithmVersion: input.algorithmVersion,
    inputFingerprint: fingerprint({
      goalId: input.goal.id, now: input.now, timezone: input.timezone,
      budgetMinutes: input.budgetMinutes, mix, candidates: ranked,
    }),
    totalMinutes: items.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    mixUsed: mix,
    diagnostics: { candidateCount: input.candidates.length, selectedCount: items.length, excludedUnsupported, reasonCodes },
  }
}
