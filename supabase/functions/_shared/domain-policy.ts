// Per-domain prompt policy — edge-runtime copy.
//
// The remediation prompt used to decide source grounding with `domainId === 'labor-law'`: one
// vertical's name, compiled into the server. Adding a subject that also needs citations meant
// editing this file, and adding one that does not still meant reasoning about a law exam.
//
// The policy is a property of the domain and already exists as `promptPolicy.requireSourceGrounding`
// on each `LearningDomainAdapter` (packages/shared/learning/adapters/domain-adapters.ts). This is
// that same data, in the shape the edge runtime can read.
//
// Duplicated rather than imported, like `ai-prompts.ts` and `card-answer.ts`: `supabase/functions/`
// is what gets deployed and must not depend on `packages/`. A vitest sync-guard
// (`packages/web/src/lib/__tests__/server-domain-policy-parity.test.ts`) asserts this agrees with
// every registered adapter, so a new domain cannot get a different answer on the server than the
// planner gives on the client. Pure TS, no imports.

/** Domains whose answers must cite a supplied source. */
const REQUIRE_SOURCE_GROUNDING: ReadonlySet<string> = new Set([
  'labor-law',
])

/**
 * Must an answer in this domain cite a supplied source?
 *
 * UNKNOWN domains return false — the safe default in the honest direction. Requiring citations
 * from a domain nobody configured would refuse every request in it; returning false still lets
 * the caller demand grounding whenever sources are actually present, which is the existing
 * `context.sources.length > 0` rule.
 */
export function domainRequiresSourceGrounding(domainId: unknown): boolean {
  return typeof domainId === 'string' && REQUIRE_SOURCE_GROUNDING.has(domainId)
}
