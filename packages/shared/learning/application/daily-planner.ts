import { validationError } from '../domain/errors.ts'
import type { ActivityType, PlannedItem, PlannerCandidate, PlannerInput, PlannerOutput } from '../domain/types.ts'

export const DAILY_PLANNER_VERSION = 'daily-plan-v1'
const DEFAULT_MIX: Readonly<Record<string, number>> = { recall: 0.6, practice: 0.25, produce: 0.15 }
const WEIGHTS = { dueUrgency: 0.35, recentFailure: 0.25, responseTimePenalty: 0.1, goalRelevance: 0.2, contentImportance: 0.1 }

const clamp01 = (value: number, fallback = 0.5): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback

function normalizeMix(input?: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const source = input && Object.keys(input).length ? input : DEFAULT_MIX
  const entries = Object.entries(source).filter(([id, weight]) => id.trim() && Number.isFinite(weight) && weight > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) throw validationError('activityMix must contain a positive finite weight')
  return Object.fromEntries(entries.map(([id, weight]) => [id, weight / total]))
}

export function scoreCandidate(candidate: PlannerCandidate): number {
  return clamp01(candidate.dueUrgency) * WEIGHTS.dueUrgency
    + clamp01(candidate.recentFailure) * WEIGHTS.recentFailure
    + clamp01(candidate.responseTimePenalty) * WEIGHTS.responseTimePenalty
    + clamp01(candidate.goalRelevance) * WEIGHTS.goalRelevance
    + clamp01(candidate.contentImportance) * WEIGHTS.contentImportance
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

function reasonCode(candidate: PlannerCandidate): string {
  const features: Array<[string, number]> = [
    ['due', clamp01(candidate.dueUrgency) * WEIGHTS.dueUrgency],
    ['recent_failure', clamp01(candidate.recentFailure) * WEIGHTS.recentFailure],
    ['slow_response', clamp01(candidate.responseTimePenalty) * WEIGHTS.responseTimePenalty],
    ['goal_relevance', clamp01(candidate.goalRelevance) * WEIGHTS.goalRelevance],
    ['importance', clamp01(candidate.contentImportance) * WEIGHTS.contentImportance],
  ]
  features.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return features[0]?.[0] ?? 'balanced'
}

export interface PlannerOptions {
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

  for (const [activityType, ratio] of Object.entries(mix)) {
    let classBudget = input.budgetMinutes * ratio
    const candidates = ranked.filter((candidate) => candidate.activityType === activityType)
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.candidateId)) continue
      const fitsClass = candidate.estimatedMinutes <= classBudget
      const allowSmallest = !selected.some((item) => item.activityType === activityType) && candidate.estimatedMinutes <= remaining
      if ((fitsClass || allowSmallest) && candidate.estimatedMinutes <= remaining) {
        selected.push(candidate); selectedIds.add(candidate.candidateId)
        classBudget -= candidate.estimatedMinutes; remaining -= candidate.estimatedMinutes
      }
    }
  }

  for (const candidate of ranked) {
    if (!selectedIds.has(candidate.candidateId) && candidate.estimatedMinutes <= remaining) {
      selected.push(candidate); selectedIds.add(candidate.candidateId); remaining -= candidate.estimatedMinutes
    }
  }

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
