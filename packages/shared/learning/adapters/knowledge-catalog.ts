// ─── The one line to change when "학습 완료" should mean something else ────────
//
// The owner asked for this explicitly: the completion rule will change, and changing it must not
// mean grepping for a constant across screens, a SQL migration, and two platforms. It is
// ACTIVE_CRITERION_ID below, and everything else reads through `activeKnowledgeCriterion()`.
//
// Mirrors `domain-catalog.ts`, which is the pattern that worked: one composition root, callers
// hold no local copies. The lesson that produced it is worth restating, because it applies here
// with more force — a registry nothing imports is not extensibility, it is dead weight (#400),
// and a declared capability nothing reads is indistinguishable from one that lies (#402). So
// every criterion registered below has a real caller: `retention` is what the app now uses,
// `interval` is what the dashboard is being moved off, and `ease-above-default` is what the
// achievements migration is being moved off — the last two exist so those replacements can name
// what they are replacing, and so the tests can prove the swap actually changes the numbers.
import {
  easeAboveDefaultCriterion, intervalCriterion, retentionCriterion, type KnowledgeCriterion,
} from '../application/knowledge.ts'
import { KnowledgeCriterionRegistry } from '../registry/knowledge-registry.ts'

/**
 * Anki's young/mature line, and the rule this app's dashboard has been using.
 *
 * Kept as a named constant rather than an inline 21 so the number is greppable and so the
 * comment travels with it: Anki's author calls it arbitrary — "there's nothing special about 21
 * days in particular" — and it is retained only as a legacy comparison, never as a goal.
 */
export const LEGACY_MATURE_INTERVAL_DAYS = 21

export function createDefaultKnowledgeRegistry(): KnowledgeCriterionRegistry {
  return new KnowledgeCriterionRegistry()
    .register(retentionCriterion())
    .register(intervalCriterion(LEGACY_MATURE_INTERVAL_DAYS))
    .register(easeAboveDefaultCriterion())
}

/**
 * ★ CHANGE THIS to change what the whole app means by "learned". ★
 *
 * `retention` — will the card be recalled on the day that matters. The default because it is the
 * only registered rule whose progress bar can actually reach 100%: an interval threshold is a
 * state lapses knock cards out of every day, and a simulation of this app's own scheduler puts
 * the ceiling at ~99% for 21 days and lower for anything stricter.
 */
const ACTIVE_CRITERION_ID = 'retention'

const REGISTRY = createDefaultKnowledgeRegistry()

/** The rule every surface must use. Screens never construct a criterion themselves. */
export function activeKnowledgeCriterion(): KnowledgeCriterion {
  return REGISTRY.get(ACTIVE_CRITERION_ID)
}

/** Criteria this build ships. */
export function availableCriterionIds(): readonly string[] {
  return REGISTRY.ids()
}

/**
 * A specific rule by id, or null when this build does not ship it.
 *
 * Null rather than throwing, for the same reason `domainAdapterFor` returns null: an id can
 * arrive from stored config or a newer client, and a reporting screen must degrade to the active
 * rule rather than fail to render. The seam is deliberate — when the criterion moves into a
 * settings row (the `card_limit_settings` precedent), that row supplies an id and nothing else
 * in this file has to change.
 */
export function knowledgeCriterionFor(id: string | null | undefined): KnowledgeCriterion | null {
  if (!id || !REGISTRY.has(id)) return null
  return REGISTRY.get(id)
}
