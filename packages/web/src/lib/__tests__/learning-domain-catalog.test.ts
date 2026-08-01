/**
 * Domains must be pluggable — that was the whole point of `LearningDomainRegistry`, and it had
 * no importers.
 *
 * Every consumer hard-coded the list instead: `const DOMAINS = ['language','labor-law']` in the
 * web goal form AND again in the mobile goal screen, plus `domainId === 'labor-law'` compiled
 * into the remediation prompt. Shipping a new subject meant editing three files in two runtimes,
 * in an app that already ships in eight languages.
 *
 * These tests pin the property that makes that impossible to regress: adding a domain is ONE
 * registration, and everything else reads from it.
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultDomainRegistry, availableDomainIds, domainAdapterFor,
  domainRequiresSourceGrounding, languageDomainAdapter, generalDomainAdapter, laborLawDomainAdapter,
  activityMixForDomain, supportedActivityTypesForDomain,
  buildDailyPlan, createLaborLawExampleGoal,
} from '@reeeeecall/shared/learning'
import { domainRequiresSourceGrounding as serverPolicy } from '../../../../../supabase/functions/_shared/domain-policy.ts'

const NOW = '2026-08-01T00:00:00.000Z'

describe('domain catalog', () => {
  it('registers every adapter that exists', () => {
    // The invariant is "an adapter you wrote is an adapter learners can pick" — writing one and
    // forgetting the registration is the same silent gap as hard-coding the list. Stated over
    // the adapters themselves rather than a literal id list, so adding a NEW domain still costs
    // exactly one registration and no test edit.
    for (const adapter of [languageDomainAdapter, generalDomainAdapter, laborLawDomainAdapter]) {
      expect(availableDomainIds(), adapter.id).toContain(adapter.id)
    }
    expect([...availableDomainIds()]).toEqual([...createDefaultDomainRegistry().ids()])
  })

  it('offers a home for subjects that are neither a language nor one country\'s exam', () => {
    // Without this the app shipped two domains — vocabulary, and a single national labor-law
    // qualification — to a marketplace of arbitrary decks in eight locales. A learner studying
    // pharmacology had to file it under "Language", or under an exam that would demand they
    // cite a statute.
    expect(availableDomainIds()).toContain('general')
    expect(domainRequiresSourceGrounding('general')).toBe(false)
    expect(domainAdapterFor('general')?.supportedActivityTypes).toContain('recall')
  })

  it('a newly registered domain needs no change anywhere else', () => {
    // The property the hard-coded arrays destroyed. A fresh registry with one extra adapter
    // surfaces it immediately — no screen edit, no server edit, no migration.
    const registry = createDefaultDomainRegistry().register({
      ...languageDomainAdapter,
      id: 'pharmacology',
      version: 'pharmacology-v1',
    })

    expect(registry.ids()).toContain('pharmacology')
    expect(registry.has('pharmacology')).toBe(true)
    expect(registry.get('pharmacology').supportedActivityTypes).toEqual(
      languageDomainAdapter.supportedActivityTypes,
    )
  })

  it('returns null for a domain this build does not ship, rather than throwing', () => {
    // A goal row can name any non-empty string — `learning_goals.domain_id` is
    // `text NOT NULL CHECK (domain_id <> '')`, deliberately open. A client reading a goal
    // created by a newer build must degrade, not crash.
    expect(domainAdapterFor('not-shipped-yet')).toBeNull()
    expect(domainAdapterFor(null)).toBeNull()
    expect(domainAdapterFor('')).toBeNull()
  })
})

describe('plan shape comes from the domain', () => {
  it('each domain supplies its own activity mix', () => {
    // labor-law weights production far higher than vocabulary drilling does. Both used to be
    // ignored: the planner got no mix at all and fell back to DEFAULT_MIX for everyone.
    expect(activityMixForDomain('labor-law')).toEqual({ recall: 0.35, practice: 0.35, produce: 0.3 })
    expect(activityMixForDomain('language')).toEqual({ recall: 0.6, practice: 0.25, produce: 0.15 })
    expect(activityMixForDomain('labor-law')).not.toEqual(activityMixForDomain('language'))
  })

  it('the mix actually reaches the plan', () => {
    const plan = buildDailyPlan({
      goal: createLaborLawExampleGoal('user-1', NOW),
      candidates: [],
      budgetMinutes: 30,
      activityMix: activityMixForDomain('labor-law'),
      now: NOW,
      timezone: 'UTC',
      algorithmVersion: 'test',
    })
    expect(plan.mixUsed).toEqual({ recall: 0.35, practice: 0.35, produce: 0.3 })
  })

  it('an unknown domain gets the planner defaults, not an empty plan', () => {
    // `undefined` is what `buildDailyPlan` reads as "use the defaults". Returning `{}` or a
    // narrowed list would let a goal written by a newer build plan nothing at all.
    expect(activityMixForDomain('pharmacology')).toBeUndefined()
    expect(supportedActivityTypesForDomain('pharmacology')).toBeUndefined()
    expect(activityMixForDomain(null)).toBeUndefined()

    const plan = buildDailyPlan({
      goal: { ...createLaborLawExampleGoal('user-1', NOW), domainId: 'pharmacology' },
      candidates: [], budgetMinutes: 30,
      activityMix: activityMixForDomain('pharmacology'),
      now: NOW, timezone: 'UTC', algorithmVersion: 'test',
    })
    expect(plan.mixUsed).toEqual({ recall: 0.6, practice: 0.25, produce: 0.15 })
  })

  it('every shipped domain can plan recall — the only candidate type built from cards', () => {
    // `buildCandidatesFromCards` emits recall and nothing else. A domain that omitted recall
    // from `supportedActivityTypes` would have every candidate excluded and produce an empty
    // plan for its learners.
    for (const id of availableDomainIds()) {
      expect(supportedActivityTypesForDomain(id), id).toContain('recall')
    }
  })
})

describe('source-grounding policy', () => {
  it('comes from the adapter, not from a hard-coded domain name', () => {
    expect(domainRequiresSourceGrounding('labor-law')).toBe(true)
    expect(domainRequiresSourceGrounding('language')).toBe(false)
    // ...and it really is the adapter's own declaration that decides.
    expect(domainAdapterFor('labor-law')?.promptPolicy?.requireSourceGrounding).toBe(true)
  })

  it('defaults an unknown domain to NOT requiring citations', () => {
    // The honest direction. Requiring citations from a domain nobody configured would refuse
    // every request in it; false still lets the caller demand grounding when sources exist.
    expect(domainRequiresSourceGrounding('pharmacology')).toBe(false)
    expect(domainRequiresSourceGrounding(null)).toBe(false)
  })

  it('the edge copy agrees with every registered adapter', () => {
    // `supabase/functions/_shared/domain-policy.ts` is duplicated, not imported, because
    // `supabase/functions/` is what gets deployed. Divergence would mean the server demands
    // citations the client never warned about — or skips them where the domain requires them.
    for (const id of availableDomainIds()) {
      expect(serverPolicy(id), id).toBe(domainRequiresSourceGrounding(id))
    }
    for (const unknown of ['pharmacology', '', 'LABOR-LAW']) {
      expect(serverPolicy(unknown), unknown).toBe(domainRequiresSourceGrounding(unknown))
    }
  })
})
