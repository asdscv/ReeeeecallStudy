/**
 * Domains must be pluggable — that was the whole point of `LearningDomainRegistry`, and it had
 * no importers.
 *
 * Every consumer hard-coded the list instead: a private `DOMAINS` array in the web goal form AND
 * again in the mobile goal screen, plus one vertical's id compiled into the remediation prompt.
 * Shipping a new subject meant editing three files in two runtimes, in an app that already ships
 * in eight languages.
 *
 * These tests pin the property that makes that impossible to regress: adding a domain is ONE
 * registration, and everything else reads from it.
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultDomainRegistry, availableDomainIds, domainAdapterFor,
  languageDomainAdapter, generalDomainAdapter,
  activityMixForDomain, supportedActivityTypesForDomain, buildDailyPlan,
} from '@reeeeecall/shared/learning'

const NOW = '2026-08-01T00:00:00.000Z'

const goal = {
  id: 'goal-1', userId: 'user-1', domainId: 'language', title: 'JLPT N2',
  targetDate: null, dailyMinutes: 30, status: 'active' as const,
  target: {}, settings: {}, createdAt: NOW, updatedAt: NOW,
}

describe('domain catalog', () => {
  it('registers every adapter that exists', () => {
    // The invariant is "an adapter you wrote is an adapter learners can pick" — writing one and
    // forgetting the registration is the same silent gap as hard-coding the list. Stated over
    // the adapters themselves rather than a literal id list, so adding a NEW domain still costs
    // exactly one registration and no test edit.
    for (const adapter of [languageDomainAdapter, generalDomainAdapter]) {
      expect(availableDomainIds(), adapter.id).toContain(adapter.id)
    }
    expect([...availableDomainIds()]).toEqual([...createDefaultDomainRegistry().ids()])
  })

  it('offers a home for subjects that are not a language', () => {
    // Without this the app shipped vocabulary and one country's professional exam to a
    // marketplace of arbitrary decks in eight locales. A learner studying pharmacology had to
    // file it under "Language".
    expect(availableDomainIds()).toContain('general')
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
    // created by a newer build — or one whose domain has since been RETIRED, as `labor-law`
    // now has — must degrade, not crash.
    expect(domainAdapterFor('not-shipped-yet')).toBeNull()
    expect(domainAdapterFor('labor-law')).toBeNull()
    expect(domainAdapterFor(null)).toBeNull()
    expect(domainAdapterFor('')).toBeNull()
  })
})

describe('plan shape comes from the domain', () => {
  it('hands the planner each adapter\'s own declaration, not a copy', () => {
    // Identity against the adapter, not equality against a literal: a helper returning a
    // hard-coded mix that happens to match today's adapters would pass an equality check and
    // then diverge silently the first time a domain declared something different.
    for (const adapter of [languageDomainAdapter, generalDomainAdapter]) {
      expect(activityMixForDomain(adapter.id), adapter.id).toBe(adapter.defaultPlanMix)
      expect(supportedActivityTypesForDomain(adapter.id), adapter.id).toBe(adapter.supportedActivityTypes)
    }
  })

  it('the mix actually reaches the plan', () => {
    const mix = { recall: 0.35, practice: 0.35, produce: 0.3 }
    const plan = buildDailyPlan({
      goal, candidates: [], budgetMinutes: 30, activityMix: mix,
      now: NOW, timezone: 'UTC', algorithmVersion: 'test',
    })
    expect(plan.mixUsed).toEqual(mix)
  })

  it('an unknown domain gets the planner defaults, not an empty plan', () => {
    // `undefined` is what `buildDailyPlan` reads as "use the defaults". Returning `{}` or a
    // narrowed list would let a goal written by a newer build plan nothing at all.
    expect(activityMixForDomain('pharmacology')).toBeUndefined()
    expect(supportedActivityTypesForDomain('pharmacology')).toBeUndefined()
    expect(activityMixForDomain(null)).toBeUndefined()

    const plan = buildDailyPlan({
      goal: { ...goal, domainId: 'pharmacology' },
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

describe('the adapter declares only what something reads', () => {
  it('carries no capability without a production caller', () => {
    // `validateActivity` and `contentValidators` validated a `LearningActivity` that is never
    // persisted; `scoreGoalRelevance` was shadowed by `learning_goal_decks.importance`, which is
    // what the ranker actually reads; and `promptPolicy.requireSourceGrounding` made one
    // domain's remediation unsatisfiable. Four members declared, none read, every one of them
    // reading from the outside like a working feature.
    //
    // Pinned as a property of the shipped adapters, so re-adding a member is a deliberate act
    // that fails here first — with the caller that justifies it named in the same diff.
    const READ_BY_PRODUCTION = ['defaultPlanMix', 'id', 'supportedActivityTypes', 'version']
    for (const adapter of [languageDomainAdapter, generalDomainAdapter]) {
      expect(Object.keys(adapter).sort(), adapter.id).toEqual(READ_BY_PRODUCTION)
    }
  })
})
