/**
 * The AI 학습 catalogue, and the two claims it is not allowed to get wrong.
 *
 * The first is ordering. `Registry.ids()` sorts alphabetically, which for these three ids is
 * generate, learning_plan, quiz — a menu order nobody chose. The menu reads from `aiHubEntries()`
 * instead, which sorts by an explicit `order`, and this file pins that so a later refactor cannot
 * quietly swap one call for the other.
 *
 * The second is the badge. The learning plan is deterministic SM-2 scheduling: no model call, no
 * charge. `LearningTodayPage.tsx` and `LearningTodayScreen.tsx` both carry the note that the paid
 * remediation was removed on purpose. It lives in a menu named "AI 학습" because that is where a
 * learner looks for it, which makes an "AI" badge on that specific tile the easiest false claim
 * in the product to ship by accident. `isAiBadgeEligible` is derived from `poweredBy` so it
 * cannot be set by hand, and the test states the consequence rather than the mechanism.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_HUB_GENERATE,
  AI_HUB_LEARNING_PLAN,
  AI_HUB_QUIZ,
  aiHubEntries,
  aiHubEntryFor,
  createDefaultAiHubRegistry,
} from '@reeeeecall/shared/lib/ai/hub/catalog'
import { isAiBadgeEligible } from '@reeeeecall/shared/lib/ai/hub/types'
import { aiHubAnalyticsEvent } from '@reeeeecall/shared/lib/ai/hub/events'
import type { AiHubAnalyticsEvent, AiHubEvent } from '@reeeeecall/shared/lib/ai/hub/events'

const REPO_ROOT = join(__dirname, '../../../../..')

/** The eight locales both platforms ship. */
const LOCALES = ['en', 'ko', 'zh', 'ja', 'es', 'vi', 'th', 'id'] as const

const LOCALE_ROOTS = [
  { platform: 'web', dir: 'packages/web/public/locales' },
  { platform: 'mobile', dir: 'packages/mobile/src/i18n/locales' },
] as const

function leaf(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

function localeFile(dir: string, locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, dir, locale, `${ns}.json`), 'utf-8'))
}

describe('AI hub catalogue', () => {
  it('registers the three features the menu is for', () => {
    const ids = aiHubEntries().map((e) => e.id)
    expect(ids).toContain(AI_HUB_LEARNING_PLAN)
    expect(ids).toContain(AI_HUB_QUIZ)
    expect(ids).toContain(AI_HUB_GENERATE)
    expect([...aiHubEntries()].map((e) => e.id).sort()).toEqual([...createDefaultAiHubRegistry().ids()])
  })

  it('lists them in the order a learner should meet them, not alphabetically', () => {
    // Alphabetical would be generate, learning_plan, quiz. Plan first is the point: deciding what
    // to study comes before generating more of it.
    expect(aiHubEntries().map((e) => e.id)).toEqual([AI_HUB_LEARNING_PLAN, AI_HUB_QUIZ, AI_HUB_GENERATE])
  })

  it('breaks an order tie deterministically', () => {
    const orders = aiHubEntries().map((e) => e.order)
    expect(new Set(orders).size).toBe(orders.length)
    expect([...orders]).toEqual([...orders].sort((x, y) => x - y))
  })

  it('never claims the learning plan is AI', () => {
    const plan = aiHubEntryFor(AI_HUB_LEARNING_PLAN)
    expect(plan).not.toBeNull()
    expect(plan && isAiBadgeEligible(plan)).toBe(false)
  })

  it('does badge what actually calls a model', () => {
    for (const id of [AI_HUB_QUIZ, AI_HUB_GENERATE]) {
      const entry = aiHubEntryFor(id)
      expect(entry, id).not.toBeNull()
      expect(entry && isAiBadgeEligible(entry), id).toBe(true)
    }
  })

  it('returns null for an id this build does not ship', () => {
    // A menu id can arrive from a deep link or a persisted preference written by another build.
    expect(aiHubEntryFor('not_a_feature')).toBeNull()
  })

  it('gives every entry a route on both platforms', () => {
    for (const entry of aiHubEntries()) {
      expect(entry.webPath, entry.id).toMatch(/^\//)
      expect(entry.mobileStack, entry.id).toMatch(/^(AITab|QuizTab)$/)
      expect(entry.mobileScreen.length, entry.id).toBeGreaterThan(0)
    }
  })

  it('routes every entry to a mobile screen that exists', async () => {
    // `aiHubRoutes.ts` pins the catalog's route strings against the real mobile param lists. It
    // imports no React Native, so the web suite can run it — which turns a dev-only console
    // warning into a build gate. Without this, renaming a screen leaves a menu row that taps
    // to nothing, and nothing anywhere says so.
    const { aiHubRouteIssues } = await import('../../../../mobile/src/screens/ai/aiHubRoutes')
    expect(aiHubRouteIssues()).toEqual([])
  })

  it('routes every entry to a web route that exists', () => {
    // The descriptor is the only place a path is written down now, so a typo would produce a menu
    // item that lands on the catch-all redirect with nothing failing anywhere.
    const app = readFileSync(join(REPO_ROOT, 'packages/web/src/App.tsx'), 'utf-8')
    for (const entry of aiHubEntries()) {
      expect(app, entry.id).toContain(`path="${entry.webPath}"`)
    }
  })

  it('has a title and a description in all 8 locales on both platforms', () => {
    // The hub renders both. A missing leaf falls back to English silently in seven languages.
    for (const { platform, dir } of LOCALE_ROOTS) {
      for (const locale of LOCALES) {
        const ns = localeFile(dir, locale, 'ai-generate')
        for (const entry of aiHubEntries()) {
          for (const key of [entry.titleKey, entry.descKey]) {
            const value = leaf(ns, key)
            expect(typeof value, `${platform}/${locale} ${key}`).toBe('string')
            expect((value as string).trim().length, `${platform}/${locale} ${key}`).toBeGreaterThan(0)
          }
        }
        for (const key of ['hub.title', 'hub.subtitle', 'hub.badge.ai', 'hub.openAction']) {
          expect(typeof leaf(ns, key), `${platform}/${locale} ${key}`).toBe('string')
        }
        // The credit notice's line, one key per allowance a catalog entry can declare. A
        // feature registered with `spends: 'quiz_generate'` renders `wallet.freeQuizOnly`, and
        // a missing leaf there falls back to English on a screen that is otherwise translated.
        for (const key of ['wallet.freeOnly', 'wallet.freeQuizOnly', 'wallet.balance',
                           'wallet.needsCredits', 'wallet.unknown']) {
          const value = leaf(ns, key)
          expect(typeof value, `${platform}/${locale} ${key}`).toBe('string')
          expect((value as string).trim().length, `${platform}/${locale} ${key}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('names the menu itself in all 8 locales on both platforms', () => {
    for (const { platform, dir } of LOCALE_ROOTS) {
      for (const locale of LOCALES) {
        const value = leaf(localeFile(dir, locale, 'common'), 'nav.aiHub')
        expect(typeof value, `${platform}/${locale} nav.aiHub`).toBe('string')
      }
    }
  })
})

describe('AI hub events', () => {
  it('reports every event under one category, so the funnel is one report', () => {
    // Typed as the real union, so a new variant cannot be added without this list noticing.
    const events: AiHubEvent[] = [
      { type: 'ai_hub.opened', source: 'nav' },
      { type: 'ai_hub.entry_opened', entryId: AI_HUB_GENERATE, source: 'hub' },
      { type: 'ai_hub.generate_requested', mode: 'cards_only', source: 'card_create' },
    ]

    const mapped: AiHubAnalyticsEvent[] = events.map(aiHubAnalyticsEvent)
    expect(new Set(mapped.map((e) => e.category))).toEqual(new Set(['ai_hub']))
    expect(new Set(mapped.map((e) => e.action)).size).toBe(events.length)
  })

  it('keeps the entry point in the label, because that is the question being asked', () => {
    // "Did anyone use the new button inside deck creation?" is only answerable if the source
    // survives into analytics — the same event fired from the nav would otherwise be identical.
    expect(
      aiHubAnalyticsEvent({ type: 'ai_hub.generate_requested', mode: 'full', source: 'deck_create' }).label,
    ).toContain('deck_create')
    expect(
      aiHubAnalyticsEvent({ type: 'ai_hub.entry_opened', entryId: AI_HUB_QUIZ, source: 'nav' }).label,
    ).toContain(AI_HUB_QUIZ)
  })
})
