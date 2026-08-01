// ─── The one place a learning domain is registered ───────────────────────────
//
// `LearningDomainRegistry` (../registry/domain-registry.ts) was built to make domains
// pluggable — `register()`, `has()`, `ids()` — and then **nothing imported it**. Every consumer
// hard-coded the domain list instead:
//
//   packages/web/src/pages/learning/GoalFormModal.tsx      const DOMAINS = ['language','labor-law']
//   packages/mobile/src/screens/LearningGoalsScreen.tsx    const DOMAINS = ['language','labor-law']
//   supabase/functions/_shared/ai-remediation.ts           domainId === 'labor-law'
//
// So adding a subject — certification prep, medicine, programming, anything — meant editing two
// screens and a server file, and the registry that exists to prevent exactly that sat unused.
// For an app that ships in eight languages, having its SUBJECTS pinned to two (one of them a
// single national exam) is the wrong axis of extensibility.
//
// This module is the composition root that closes that gap. It mirrors
// `createDefaultEvaluatorRegistry()`. Adding a domain is now ONE entry here — both clients and
// the planner pick it up with no further edits.
//
// What a new domain still owes, deliberately:
//   - a `LearningDomainAdapter` (what activities it supports, how it scores relevance, whether
//     its answers must cite a source). That is behaviour and cannot be data.
//   - a `form.domainName.<id>` string per locale. Absent, the UI shows the raw id rather than a
//     missing-key placeholder — a new domain must be usable before it is pretty.
// It does NOT owe a database migration: `learning_goals.domain_id` is
// `text NOT NULL CHECK (domain_id <> '')` (mig 165), already open by design.
import { LearningDomainRegistry } from '../registry/domain-registry.ts'
import { languageDomainAdapter, generalDomainAdapter, laborLawDomainAdapter } from './domain-adapters.ts'
import type { LearningDomainAdapter } from '../domain/types.ts'

/**
 * Every domain this build ships, in registration order — which is also the order the goal form
 * lists them, and the first entry is what a new goal opens on.
 *
 * `language` stays first on evidence, not habit: 376,095 of the 377,031 official cards are
 * vocabulary. `general` is second because "some other subject" is the honest home for everything
 * the marketplace actually carries. `labor-law` is last: it is one country's professional exam,
 * and the narrowest thing here.
 */
export function createDefaultDomainRegistry(): LearningDomainRegistry {
  return new LearningDomainRegistry()
    .register(languageDomainAdapter)
    .register(generalDomainAdapter)
    .register(laborLawDomainAdapter)
}

/** Shared instance for read-only callers (screens, planners). Registration is build-time. */
const DEFAULT_REGISTRY = createDefaultDomainRegistry()

/** Domain ids this build can plan for. The clients render exactly this — never a local list. */
export function availableDomainIds(): readonly string[] {
  return DEFAULT_REGISTRY.ids()
}

/** The adapter for a domain, or null when this build does not ship it. */
export function domainAdapterFor(domainId: string | null | undefined): LearningDomainAdapter | null {
  if (!domainId || !DEFAULT_REGISTRY.has(domainId)) return null
  return DEFAULT_REGISTRY.get(domainId)
}

/**
 * Must an answer in this domain cite a supplied source?
 *
 * Read from the domain's own `promptPolicy` instead of comparing against a hard-coded id. An
 * UNKNOWN domain returns false, which is the safe default in the honest direction: requiring
 * citations from a domain nobody configured would refuse every request in it, while `false`
 * still lets the caller demand grounding whenever sources are actually present.
 */
export function domainRequiresSourceGrounding(domainId: string | null | undefined): boolean {
  return domainAdapterFor(domainId)?.promptPolicy?.requireSourceGrounding ?? false
}

/**
 * How a domain wants its daily minutes split across activity types.
 *
 * `undefined` for an unknown domain, which is exactly what `buildDailyPlan` treats as "use the
 * default mix" — an unrecognised domain gets the generic plan rather than an empty one.
 *
 * Until this existed, `defaultPlanMix` had NO production caller: every learner got `DEFAULT_MIX`
 * no matter what they said they were studying, so registering a domain changed nothing about
 * what the app actually did. Declaring a mix and never reading it is the same bug as hard-coding
 * the list, one layer down.
 */
export function activityMixForDomain(domainId: string | null | undefined): Readonly<Record<string, number>> | undefined {
  return domainAdapterFor(domainId)?.defaultPlanMix
}

/**
 * The activity types a domain can actually plan.
 *
 * `undefined` (unknown domain) leaves the planner deriving support from the mix, so nothing is
 * silently excluded. A domain that omits a type here has its candidates dropped and counted in
 * `diagnostics.excludedUnsupported` — visible, not silent.
 */
export function supportedActivityTypesForDomain(domainId: string | null | undefined): readonly string[] | undefined {
  return domainAdapterFor(domainId)?.supportedActivityTypes
}
