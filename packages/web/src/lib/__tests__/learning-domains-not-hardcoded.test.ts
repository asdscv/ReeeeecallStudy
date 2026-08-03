/**
 * No screen may carry its own copy of the domain list.
 *
 * This is a SOURCE-level guard, in the same shape as `learning-reason-codes.test.ts`, because
 * the defect it prevents is invisible to a behavioural test: both goal screens shipped
 * `const DOMAINS = ['language', 'labor-law']` and rendered perfectly. Everything passed. Adding
 * a subject just silently required editing two runtimes, and `LearningDomainRegistry` — which
 * exists to prevent exactly that — had zero importers.
 *
 * A unit test of the registry cannot catch a screen that ignores the registry. Only reading the
 * screens can.
 *
 * The locale-coverage half of this file is GONE, deliberately. It required every registered
 * domain to be named in all 8 locales x 2 platforms, which was right while the goal form showed
 * a subject picker. Neither screen shows one now — the two shipped adapters are identical apart
 * from their id, so the control changed nothing and the subject is already on the deck — and a
 * test demanding translations for strings no screen renders is exactly the dead weight the rest
 * of this session was spent removing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { availableDomainIds } from '@reeeeecall/shared/learning'

const REPO_ROOT = join(__dirname, '../../../../..')

const SCREENS = [
  'packages/web/src/pages/learning/GoalFormModal.tsx',
  'packages/mobile/src/screens/LearningGoalsScreen.tsx',
]

/**
 * Files that must never name a domain id, screens included.
 *
 * `domain-catalog.ts` is on this list for a reason that no behavioural test can reach: writing
 * `requireSourceGrounding` as `domainId === 'labor-law'` there produces IDENTICAL results for
 * every domain this build ships. The two answers only diverge on a domain that does not exist
 * yet — which is the entire point. Reading the source is the only way to catch it before then.
 */
const NO_DOMAIN_LITERALS = [
  ...SCREENS,
  'supabase/functions/_shared/ai-remediation.ts',
  'packages/shared/learning/adapters/domain-catalog.ts',
]

/** Strip block and line comments — the history is explained in prose and must not trip this. */
function code(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('domain list is not duplicated into screens', () => {
  it.each(SCREENS)('%s reads the shared registry', (path) => {
    expect(code(path)).toContain('availableDomainIds')
  })

  it.each(NO_DOMAIN_LITERALS)('%s does not name a domain id in its own code', (path) => {
    // Any shipped domain appearing as a literal means someone re-created the hard-coded list.
    // Registration is the only place a domain id belongs.
    const source = code(path)
    for (const id of availableDomainIds()) {
      expect(source, `${path} hard-codes the domain id "${id}"`).not.toContain(`'${id}'`)
      expect(source, `${path} hard-codes the domain id "${id}"`).not.toContain(`"${id}"`)
    }
  })

  it('the server grounds on the sources it was given, not on a domain name', () => {
    // `requireGrounding = domainId === 'labor-law' || ...` compiled a single national exam into
    // the remediation prompt, and demanded a citation from an allowed-source list that is always
    // empty — so every request in that domain failed before the model was called. Grounding is
    // now a fact about the payload, which cannot be wrong about itself.
    const server = code('supabase/functions/_shared/ai-remediation.ts')
    expect(server).toContain('const requireGrounding = context.sources.length > 0')
  })

  it('the planner call site asks the domain for its plan shape', () => {
    // Registering a domain has to CHANGE something. `buildDailyPlan` was called with neither
    // `activityMix` nor `supportedActivityTypes`, so `DEFAULT_MIX` applied to every learner and
    // the adapters' declarations had no production caller — a domain was a label on a row.
    //
    // Source-level because the store reaches Supabase before it reaches the planner, and a mix
    // that is declared-but-unread is invisible to any test of the planner itself.
    //
    // Matching the CALL, not the identifier: an earlier version of this test looked for the bare
    // name and passed happily after the call site was deleted, because the import line at the top
    // of the file still contained it.
    const store = code('packages/shared/stores/learning-store.ts')
      .split('\n').filter((line) => !line.trimStart().startsWith('import ')).join('\n')
    expect(store).toContain('activityMix: activityMixForDomain(goal.domain_id)')
    expect(store).toContain('supportedActivityTypes: supportedActivityTypesForDomain(goal.domain_id)')
  })
})
